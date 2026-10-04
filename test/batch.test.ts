import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { replyAll, type BatchOptions } from "../src/cli.ts";
import { HANDOFF_SENTENCE } from "../src/escalation.ts";
import type { Client } from "../src/respond.ts";

const usage = {
  input_tokens: 100,
  input_tokens_details: { cached_tokens: 60, cache_write_tokens: 0 },
  output_tokens: 20,
  output_tokens_details: { reasoning_tokens: 5 },
  total_tokens: 120,
};

const final = (fields: object) => {
  const reply = {
    response: "ok",
    escalate: false,
    escalationReason: null,
    templateId: null,
    intent: "answer",
    shouldFollowUp: false,
    followUpTiming: null,
    attachmentUrls: null,
    highEngagement: false,
    workingMemoryUpdates: null,
    ...fields,
  };
  const text = JSON.stringify(reply);
  return {
    status: "completed",
    output: [
      { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
    ],
    output_text: text,
    usage,
  } as unknown as Response;
};

const toolCall = (name: string, args: object, callId: string) =>
  ({
    status: "completed",
    output: [{ type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(args), status: "completed" }],
    output_text: "",
    usage,
  }) as unknown as Response;

// The patient text sits inside the packet user message: `"<text>"` on its second line.
const patientText = (body: ResponseCreateParamsNonStreaming): string => {
  const user = (body.input as { role?: string; content?: string }[]).find((item) => item.role === "user");
  return /^"(.*)"$/m.exec(user?.content ?? "")?.[1] ?? "";
};

const fake = (create: (body: ResponseCreateParamsNonStreaming) => Promise<Response>): Client => ({
  responses: { create },
});

const options = (client: Client, trace?: BatchOptions["trace"]): BatchOptions => ({
  client,
  mode: "baseline",
  model: "test-model",
  effort: "low",
  trace,
});

test("one reply per message, in input order, with at most 4 in flight", async () => {
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
  assert.equal(peak, 4);
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
  assert.equal(replies[1]!.response, HANDOFF_SENTENCE);
  const failed = traces.find((t) => t.id === "b")!;
  assert.equal(failed.ok, false);
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
