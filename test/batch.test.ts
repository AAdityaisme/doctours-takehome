import OpenAI from "openai";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { replyAll, type BatchOptions } from "../src/cli.ts";
import { HANDOFFS } from "../src/escalation.ts";
import type { Client } from "../src/respond.ts";
import { fake, final, toolCall, usage } from "./fake.ts";

// The patient text sits inside the packet user message: `"<text>"` on its second line.
const patientText = (body: ResponseCreateParamsNonStreaming): string => {
  const user = (body.input as { role?: string; content?: string }[]).find((item) => item.role === "user");
  return /^"(.*)"$/m.exec(user?.content ?? "")?.[1] ?? "";
};

const options = (client: Client, trace?: BatchOptions["trace"]): BatchOptions => ({
  client,
  mode: "baseline",
  model: "test-model",
  effort: "low",
  trace,
});

test("one reply per message, in input order, 2 in flight by default and `concurrency` when set", async () => {
  let inFlight = 0;
  let peak = 0;
  const client = fake(async (body) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    const text = patientText(body);
    await new Promise((resolve) => setTimeout(resolve, 30 - Number(text.slice(1)) * 4));
    inFlight--;
    return final({ response: `echo ${text}` });
  });
  const items = Array.from({ length: 7 }, (_, i) => ({ id: `id${i}`, text: `m${i}` }));
  const replies = await replyAll(items, options(client));
  assert.deepEqual(
    replies.map((r) => r.response),
    items.map((item) => `echo ${item.text}`),
  );
  assert.equal(peak, 2);
  peak = 0;
  await replyAll(items, { ...options(client), concurrency: 3 });
  assert.equal(peak, 3);
});

test("a failing message gets a fail-safe escalation and the rest of the batch completes", async () => {
  const traces: Record<string, unknown>[] = [];
  const client = fake(async (body) => {
    if (patientText(body) === "boom") throw new Error("upstream 500");
    return final({ response: "fine" });
  });
  const items = [{ id: "a", text: "hello" }, { id: "b", text: "boom" }, { id: "c" }, { id: "d", text: "bye" }];
  const replies = await replyAll(items, options(client, (record) => traces.push(record)));
  assert.equal(replies.length, 4);
  assert.deepEqual(
    replies.map((r) => [r.escalate, r.escalationReason]),
    [
      [false, null],
      [true, "system error"],
      [true, "system error"],
      [false, null],
    ],
  );
  assert.equal(replies[1]!.response, HANDOFFS.system_error.sentence);
  const failed = traces.find((t) => t.id === "b")!;
  assert.equal(failed.ok, false);
  assert.equal(failed.escalationCategory, "system_error");
  assert.equal(traces.find((t) => t.id === "a")!.escalationCategory, null);
  assert.match(String(failed.error), /upstream 500/);
});

test("tool loop: runs the packet tool, returns its output by call_id, keeps only tool-returned URLs", async () => {
  const paymentUrl = "https://www.doctours.com/payment/44444444-4444-4444-8444-444444444442";
  const requests: ResponseCreateParamsNonStreaming[] = [];
  const client = fake(async (body) => {
    requests.push(structuredClone(body));
    if (requests.length === 1) {
      return toolCall(
        "getPaymentLinkTool",
        { type: "payment", clinicPackageId: "44444444-4444-4444-8444-444444444442", clinicId: null },
        "call_1",
      );
    }
    return final({
      response: `Here is the Gold deposit link ${paymentUrl} whenever you're ready.`,
      attachmentUrls: [paymentUrl, "https://invented.example/x"],
    });
  });
  const traces: Record<string, unknown>[] = [];
  const [reply] = await replyAll([{ id: "pay", text: "send me the gold link" }], options(client, (r) => traces.push(r)));

  const first = requests[0]!;
  assert.equal(first.model, "test-model");
  assert.deepEqual(first.reasoning, { effort: "low" });
  assert.equal(first.tools?.length, 14);
  assert.ok(first.tools?.every((tool) => (tool as { strict?: boolean }).strict === true), "every tool strict");
  assert.deepEqual(
    { type: (first.text?.format as { type: string }).type, strict: (first.text?.format as { strict: boolean }).strict },
    { type: "json_schema", strict: true },
  );
  assert.equal((first.input as { role: string }[])[0]!.role, "developer");

  const output = (requests[1]!.input as { type?: string; call_id?: string; output?: string }[]).find(
    (item) => item.type === "function_call_output",
  );
  assert.equal(output?.call_id, "call_1");
  assert.equal(JSON.parse(output!.output!).url, paymentUrl);

  assert.deepEqual(reply!.attachmentUrls, [paymentUrl]);
  assert.equal(reply!.response.split("\n").at(-1), paymentUrl);
  assert.equal(traces[0]!.apiCalls, 2);
  assert.deepEqual(traces[0]!.tokens, { input: 200, cached: 120, cacheWrite: 0, output: 40, reasoning: 10 });
  assert.deepEqual((traces[0]!.toolCalls as { name: string }[]).map((c) => c.name), ["getPaymentLinkTool"]);
});

test("a model that never stops calling tools is cut off and fails safe", async () => {
  const client = fake(async () => toolCall("getAllClinicsTool", {}, "loop"));
  const [reply] = await replyAll([{ id: "x", text: "hi" }], options(client));
  assert.equal(reply!.escalate, true);
  assert.equal(reply!.escalationReason, "system error");
});

test("a failed message's trace keeps the tools it ran, its API calls and its tokens", async () => {
  let calls = 0;
  const client = fake(async () =>
    ++calls === 1
      ? toolCall("getClinicPackagesTool", { clinicId: null, clinicName: "Heva Clinic" }, "c1")
      : ({ ...final({}), status: "incomplete" } as Response),
  );
  const traces: Record<string, unknown>[] = [];
  const [reply] = await replyAll([{ id: "x", text: "hi" }], options(client, (r) => traces.push(r)));
  assert.equal(reply!.escalationReason, "system error");
  assert.equal(traces[0]!.ok, false);
  assert.match(String(traces[0]!.error), /incomplete/);
  assert.deepEqual(traces[0]!.toolCalls, [
    { name: "getClinicPackagesTool", arguments: '{"clinicId":null,"clinicName":"Heva Clinic"}' },
  ]);
  assert.equal(traces[0]!.apiCalls, 2);
  assert.deepEqual(traces[0]!.tokens, { input: 200, cached: 120, cacheWrite: 0, output: 40, reasoning: 10 });
});

test("a tool error goes back to the model; the message still gets a normal reply", async () => {
  const requests: ResponseCreateParamsNonStreaming[] = [];
  const client = fake(async (body) => {
    requests.push(structuredClone(body));
    if (requests.length === 1) {
      return {
        status: "completed",
        output: [{ type: "function_call", id: "fc_bad", call_id: "bad", name: "getClinicPackagesTool", arguments: "{oops", status: "completed" }],
        output_text: "",
        usage,
      } as unknown as Response;
    }
    return final({ response: "Which clinic do you mean?" });
  });
  const [reply] = await replyAll([{ id: "x", text: "prices?" }], options(client));
  assert.equal(reply!.escalate, false);
  assert.equal(reply!.response, "Which clinic do you mean?");
  const output = (requests[1]!.input as { type?: string; output?: string }[]).find((i) => i.type === "function_call_output");
  assert.match(JSON.parse(output!.output!).error, /getClinicPackagesTool failed/);
});

test("`node src/cli.ts` prints only the JSON array, reading a file, stdin or '-'", () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "doctours-cli-"));
  try {
    const file = join(dir, "input.json");
    writeFileSync(file, "[]");
    // Empty batch: no API call is made, so a dummy key is enough.
    const run = (args: string[], input?: string) =>
      execFileSync(process.execPath, [cli, ...args], { input, env: { ...process.env, OPENAI_API_KEY: "dummy" } }).toString();
    assert.equal(run([file]), "[]\n");
    assert.equal(run([], "[]"), "[]\n");
    assert.equal(run(["-"], "[]"), "[]\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI client retries 8 times, CONCURRENCY caps messages in flight, and a bad CONCURRENCY is refused", () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  // Offline: stub the Responses API in the child process, record the client's retry budget and the peak in flight.
  const stub = `
    import { Responses } from ${JSON.stringify(import.meta.resolve("openai/resources/responses/responses"))};
    let inFlight = 0, peak = 0;
    Responses.prototype.create = async function (body) {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      const route = body.text.format.name === "Route";
      const value = route
        ? { intent: "x", skills: [], escalation: null }
        : { response: JSON.stringify({ retries: this._client.maxRetries, peak }), escalate: false, escalationReason: null,
            templateId: null, intent: "x", shouldFollowUp: false, followUpTiming: null, attachmentUrls: null,
            highEngagement: false, workingMemoryUpdates: null };
      return { status: "completed", output: [], output_text: JSON.stringify(value) };
    };`;
  // The parent's own CONCURRENCY must not leak into the default case.
  const { CONCURRENCY: _inherited, ...parentEnv } = process.env;
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(stub)}`, cli], {
      input: JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, text: `m${i}` }))),
      env: { ...parentEnv, OPENAI_API_KEY: "dummy", ...env },
      encoding: "utf8",
    });
  const last = (env: Record<string, string>) => {
    const result = run(env);
    assert.equal(result.status, 0, result.stderr);
    const replies = JSON.parse(result.stdout) as { response: string }[];
    return replies.map((reply) => JSON.parse(reply.response) as { retries: number; peak: number });
  };
  const byDefault = last({});
  assert.ok(byDefault.every((r) => r.retries === 8));
  assert.equal(Math.max(...byDefault.map((r) => r.peak)), 2);
  assert.equal(Math.max(...last({ CONCURRENCY: "3" }).map((r) => r.peak)), 3);
  for (const bad of ["0", "abc", "1.5"]) {
    const result = run({ CONCURRENCY: bad });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /CONCURRENCY must be a positive integer/);
  }
});

for (const status of [400, 401, 403, 404, 429, 500]) {
  for (const stage of ["router", "reply"]) {
    test(`${status} from ${stage}: configuration errors stop the batch; transient errors hand off`, async () => {
      const error = OpenAI.APIError.generate(status, { error: { message: "test API failure" } }, undefined, new Headers());
      let calls = 0;
      const client = fake(async (body) => {
        calls++;
        if (stage === "reply" && body.text?.format?.type === "json_schema" && body.text.format.name === "Route") {
          return { ...final({}), output_text: JSON.stringify({ intent: "x", skills: [], escalation: null }) };
        }
        throw error;
      });
      const items = [{ text: "first" }, { text: "second" }];
      const settings: BatchOptions = { ...options(client), mode: "restructured", router: { model: "router", effort: "none" }, concurrency: 1 };
      if (status < 429) {
        await assert.rejects(replyAll(items, settings), (caught) => caught === error);
        assert.equal(calls, stage === "router" ? 1 : 2);
      } else {
        const replies = await replyAll(items, settings);
        assert.deepEqual(replies.map((r) => r.escalationReason), ["system error", "system error"]);
        assert.equal(calls, 4);
      }
    });
  }
}

test("a throwing trace sink preserves replies in order, including model and failure handoffs", async (t) => {
  const client = fake(async (body) => {
    const text = patientText(body);
    if (text === "fail") throw new Error("temporary failure");
    return final({ response: text, escalate: text === "human" });
  });
  const items = ["hello", "human", "fail", "bye"].map((text) => ({ text }));
  const expected = await replyAll(items, options(client));
  const errors: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args.join(" ")));
  const actual = await replyAll(items, options(client, () => { throw new Error("disk full"); }));
  assert.deepEqual(actual, expected);
  assert.equal(errors.filter((e) => e.includes("trace write failed: disk full")).length, 1);
});

test("CLI API configuration errors exit nonzero with one stderr line and empty stdout", () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  for (const status of [400, 401, 403, 404]) {
    const stub = `
      import OpenAI from ${JSON.stringify(import.meta.resolve("openai"))};
      import { Responses } from ${JSON.stringify(import.meta.resolve("openai/resources/responses/responses"))};
      Responses.prototype.create = async function () {
        throw OpenAI.APIError.generate(${status}, { error: { message: "bad configuration" } }, undefined, new Headers());
      };`;
    const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(stub)}`, cli], {
      input: '[{"text":"hello"},{"text":"bye"}]', encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: "dummy", CONCURRENCY: "1" },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim().split("\n").length, 1);
    assert.match(result.stderr, new RegExp(`OpenAI ${status}:.*bad configuration.*ROUTER_MODEL / REPLY_MODEL`));
  }
});

for (const code of ["context_length_exceeded", "invalid_prompt", "string_above_max_length", "content_policy_violation"]) {
  for (const stage of ["router", "reply"]) {
    test(`message-level 400 ${code} at ${stage} hands off one message and completes batch`, async (t) => {
      t.mock.method(console, "error", () => {});
      const error = OpenAI.APIError.generate(400, { error: { message: "message rejected", code } }, undefined, new Headers());
      const client = fake(async (body) => {
        const router = body.text?.format?.type === "json_schema" && body.text.format.name === "Route";
        if (patientText(body) === "bad" && router === (stage === "router")) throw error;
        return router ? { ...final({}), output_text: JSON.stringify({ intent: "x", skills: [], escalation: null }) } : final({ response: "fine" });
      });
      const traces: Record<string, unknown>[] = [];
      const replies = await replyAll(["good", "bad", "last"].map((text) => ({ text })), {
        ...options(client, (r) => traces.push(r)), mode: "restructured", router: { model: "r", effort: "none" }, concurrency: 1,
      });
      assert.deepEqual(replies.map((r) => r.escalationReason), [null, "system error", null]);
      assert.equal(traces[1]!.escalationCategory, "system_error");
    });
  }
}

for (const mode of ["baseline", "restructured"] as const) {
  test(`insufficient_quota is fatal in ${mode}`, async () => {
    const error = OpenAI.APIError.generate(429, { error: { message: "billing", code: "insufficient_quota" } }, undefined, new Headers());
    let calls = 0;
    const client = fake(async () => { calls++; throw error; });
    await assert.rejects(replyAll([{ text: "first" }, { text: "last" }], {
      ...options(client), mode, router: { model: "r", effort: "none" }, concurrency: 1,
    }), (caught) => caught === error);
    assert.equal(calls, 1);
  });

  test(`payment output check traces system_error in ${mode}; model handoff traces reply`, async () => {
    const client = fake(async (body) => {
      if (body.text?.format?.type === "json_schema" && body.text.format.name === "Route")
        return { ...final({}), output_text: JSON.stringify({ intent: "x", skills: [], escalation: null }) };
      return final({ response: "https://pay.doctours.com/payment/gold", escalate: patientText(body) === "human" });
    });
    const traces: Record<string, unknown>[] = [];
    await replyAll([{ text: "link" }, { text: "human" }], {
      ...options(client, (r) => traces.push(r)), mode, router: { model: "r", effort: "none" }, concurrency: 1,
    });
    assert.deepEqual(traces.map((r) => r.escalationCategory), ["system_error", "reply"]);
  });
}

test("CLI and both eval commands share one fatal diagnostic without a doubled status", () => {
  const stub = `
    import OpenAI from ${JSON.stringify(import.meta.resolve("openai"))};
    import { Responses } from ${JSON.stringify(import.meta.resolve("openai/resources/responses/responses"))};
    Responses.prototype.create = async function () {
      throw OpenAI.APIError.generate(401, { error: { message: "bad configuration" } }, undefined, new Headers());
    };`;
  const diagnostics: string[] = [];
  for (const path of ["../src/cli.ts", "../evals/run.ts", "../evals/router.ts"]) {
    const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(stub)}`, fileURLToPath(new URL(path, import.meta.url))], {
      input: '[{"text":"hello"}]', encoding: "utf8",
      env: { ...process.env, OPENAI_API_KEY: "dummy", CONCURRENCY: "1" },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim().split("\n").length, 1);
    assert.match(result.stderr, /^OpenAI 401: bad configuration .*GRADER_MODEL/);
    diagnostics.push(result.stderr);
  }
  assert.equal(new Set(diagnostics).size, 1);
});
