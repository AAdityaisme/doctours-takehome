import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { replyAll } from "../src/cli.ts";
import { TOOLS } from "../src/tools.ts";
import { fake, final, toolCall } from "./fake.ts";

// What actually runs is what the request allowed, whatever the API returns.
type Body = ResponseCreateParamsNonStreaming;
const format = (body: Body) => (body.text?.format as { name?: string }).name;
const allowed = (body: Body) => (body.tool_choice as unknown as { tools: { name: string }[] }).tools.map((t) => t.name);
const outputs = (body: Body) =>
  Object.fromEntries(
    (body.input as { type?: string; call_id?: string; output?: string }[])
      .filter((item) => item.type === "function_call_output")
      .map((item) => [item.call_id, JSON.parse(item.output!)]),
  );
const both = (...responses: Response[]) =>
  ({ ...responses[0]!, output: responses.flatMap((r) => r.output), output_text: "" }) as Response;
const PAYMENT_ID = "44444444-4444-4444-8444-444444444442";
const PAYMENT_URL = `https://www.doctours.com/payment/${PAYMENT_ID}`;
const payment = () => toolCall("getPaymentLinkTool", { type: "payment", clinicPackageId: PAYMENT_ID, clinicId: null }, "pay");

const run = async (mode: "restructured" | "baseline", reply: (round: number) => Response) => {
  const requests: Body[] = [];
  const traces: Record<string, unknown>[] = [];
  let round = 0;
  const client = fake(async (body) => {
    if (format(body) === "Route") {
      return { ...final({}), output_text: JSON.stringify({ intent: "x", skills: [], escalation: null }) } as Response;
    }
    requests.push(structuredClone(body));
    return reply(++round);
  });
  const [out] = await replyAll([{ id: "m", text: "hi" }], {
    client,
    mode,
    model: "m",
    effort: "low",
    router: { model: "r", effort: "none" },
    trace: (t) => traces.push(t),
  });
  return { reply: out!, requests, trace: traces[0]! };
};

test("restructured: a defined tool outside allowed_tools doesn't run, isn't a URL source, and is traced as rejected", async (t) => {
  const spy = t.mock.method(TOOLS.find((tool) => tool.name === "getPaymentLinkTool")!, "run");
  const { reply, requests, trace } = await run("restructured", (round) =>
    round === 1 ? payment() : final({ attachmentUrls: [PAYMENT_URL] }),
  );
  assert.ok(!allowed(requests[0]!).includes("getPaymentLinkTool"));
  assert.equal(spy.mock.callCount(), 0);
  assert.deepEqual(outputs(requests[1]!).pay, { error: "tool not available for this message" });
  assert.equal(reply.attachmentUrls, null);
  assert.deepEqual(trace.toolCalls, [
    { name: "getPaymentLinkTool", arguments: JSON.stringify({ type: "payment", clinicPackageId: PAYMENT_ID, clinicId: null }), rejected: true },
  ]);
});

for (const order of ["loadSkill first", "tool first"] as const) {
  test(`restructured: a skill's tools are callable only from the request after it loads (${order})`, async (t) => {
    const spy = t.mock.method(TOOLS.find((tool) => tool.name === "getFullCallsTool")!, "run");
    const load = toolCall("loadSkill", { id: "consultation" }, "load");
    const early = toolCall("getFullCallsTool", { chatId: null, limit: null }, "early");
    const late = toolCall("getFullCallsTool", { chatId: null, limit: null }, "late");
    const { requests, trace } = await run("restructured", (round) =>
      round === 1 ? (order === "loadSkill first" ? both(load, early) : both(early, load)) : round === 2 ? late : final({}),
    );
    assert.equal(spy.mock.callCount(), 1, "only the round-two call runs");
    assert.deepEqual(outputs(requests[1]!).early, { error: "tool not available for this message" });
    assert.ok(allowed(requests[1]!).includes("getFullCallsTool"));
    assert.equal(outputs(requests[2]!).late.count, 1);
    const calls = trace.toolCalls as { name: string; rejected?: true }[];
    assert.deepEqual(
      calls.map((c) => [c.name, c.rejected ?? false]),
      order === "loadSkill first"
        ? [["loadSkill", false], ["getFullCallsTool", true], ["getFullCallsTool", false]]
        : [["getFullCallsTool", true], ["loadSkill", false], ["getFullCallsTool", false]],
    );
  });
}

test("baseline: every defined tool stays callable", async (t) => {
  const spy = t.mock.method(TOOLS.find((tool) => tool.name === "getPaymentLinkTool")!, "run");
  const { reply, requests } = await run("baseline", (round) =>
    round === 1 ? payment() : final({ response: "link", attachmentUrls: [PAYMENT_URL] }),
  );
  assert.equal("tool_choice" in requests[0]!, false);
  assert.equal(spy.mock.callCount(), 1);
  assert.equal(outputs(requests[1]!).pay.url, PAYMENT_URL);
  assert.deepEqual(reply.attachmentUrls, [PAYMENT_URL]);
});

for (const mode of ["restructured", "baseline"] as const) {
  test(`${mode}: an incomplete response with only a tool call fails safe before the tool runs`, async (t) => {
    const spy = t.mock.method(TOOLS.find((tool) => tool.name === "getPatientContextTool")!, "run");
    const { reply, requests, trace } = await run(mode, (round) =>
      round === 1 ? ({ ...toolCall("getPatientContextTool", { userId: null }, "ctx"), status: "incomplete" } as Response) : final({}),
    );
    assert.equal(spy.mock.callCount(), 0);
    assert.equal(requests.length, 1, "no further call");
    assert.equal(reply.escalationReason, "system error");
    assert.match(String(trace.error), /response incomplete/);
    assert.equal((trace.tokens as { input: number }).input, mode === "restructured" ? 200 : 100, "usage kept");
  });
}
