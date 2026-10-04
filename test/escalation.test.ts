import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "openai/resources/responses/responses";
import { replyAll } from "../src/cli.ts";
import { HANDOFFS, toEscalation, type Handoff } from "../src/escalation.ts";
import { REPLY_SCHEMA, schemaError } from "../src/reply.ts";
import { TOOLS } from "../src/tools.ts";
import { fake, final, toolCall } from "./fake.ts";

// SPEC "Escalation boundary": no role (L877), no channel blame (L769), no timing, no echo, own wording.
const BANNED = [
  /\bteam\b/i,
  /\bmember\b/i,
  /\bcoordinator\b/i,
  /\bspecialist\b/i,
  /\bagent\b/i,
  /\bmanager\b/i,
  /\bcolleague\b/i,
  /\bstaff\b/i,
  /\bsupport\b/i,
  /\bover text\b/i,
  /\btext(ing)?\b/i,
  /\bchat\b/i,
  /\bthread\b/i,
  /\bconversation\b/i,
  /\bsystem\b/i,
  /\bshortly\b/i,
  /\bright away\b/i,
  /\bwithin\b/i,
  /\bsoon\b/i,
  /\bnow\b/i,
  /\btoday\b/i,
  /\b(minute|hour|day)s?\b/i,
  /\basap\b/i,
  /getting a person for you/i,
  /\d/,
];

test("every handoff sentence: one short first-person sentence saying a person takes over, no banned words", () => {
  for (const [kind, { sentence, reason }] of Object.entries(HANDOFFS)) {
    assert.match(sentence, /^[^.!?]+[.!]$/, `${kind}: exactly one sentence`);
    assert.ok(sentence.split(/\s+/).length <= 16, `${kind}: short`);
    assert.match(sentence, /\bI(?:'m| am|'ll| will)?\b/, `${kind}: first person`);
    assert.match(sentence, /\bhanding (?:this|it) over to a person\b/, `${kind}: a person takes over`);
    for (const word of BANNED) assert.doesNotMatch(sentence, word, `${kind}: ${word}`);
    assert.ok(reason.length > 0 && reason.split(" ").length <= 6, `${kind}: short plain reason`);
  }
  // cannot_do says plainly it is outside what the coordinator does (L769 allows this), as a person, not a channel.
  assert.match(HANDOFFS.cannot_do.sentence, /isn't something I can do/);
});

test("toEscalation: the kind's sentence and reason, nothing past the handoff, schema-valid", () => {
  for (const kind of Object.keys(HANDOFFS) as Handoff[]) {
    const reply = toEscalation(kind);
    assert.equal(schemaError(REPLY_SCHEMA, reply), null);
    assert.equal(reply.escalate, true);
    assert.equal(reply.response, HANDOFFS[kind].sentence);
    assert.equal(reply.escalationReason, HANDOFFS[kind].reason);
    assert.deepEqual(
      [reply.templateId, reply.shouldFollowUp, reply.followUpTiming, reply.attachmentUrls, reply.workingMemoryUpdates],
      [null, false, null, null, null],
    );
  }
  assert.equal(HANDOFFS.system_error.reason, "system error", "the eval harness keys on this reason");
});

test("trace escalationCategory: router category, `reply`, `system_error`, else null; baseline too", async () => {
  const routeText = (fields: object) => JSON.stringify({ intent: "x", skills: [], escalation: null, ...fields });
  const route = (fields: object) => ({ ...final({}), output_text: routeText(fields) }) as Response;
  const client = fake(async (body) => {
    const user = (body.input as { role?: string; content?: string }[]).find((item) => item.role === "user")!.content!;
    const text = /^"(.*)"$/m.exec(user)![1]!;
    if ((body.text?.format as { name?: string }).name === "Route") {
      if (text === "cannot") return route({ escalation: { category: "cannot_do", reason: "r" } });
      if (text === "human") return route({ escalation: { category: "human_requested", reason: "r" } });
      return route({});
    }
    if (text === "boom") throw new Error("upstream 500");
    return final({ escalate: text === "model" });
  });
  const items = ["cannot", "human", "model", "boom", "plain"].map((text) => ({ id: text, text }));
  for (const mode of ["restructured", "baseline"] as const) {
    const traces: Record<string, unknown>[] = [];
    const replies = await replyAll(items, {
      client,
      mode,
      model: "m",
      effort: "low",
      router: { model: "r", effort: "none" },
      trace: (record) => traces.push(record),
    });
    const category = Object.fromEntries(traces.map((t) => [t.id, t.escalationCategory]));
    const expected =
      mode === "restructured"
        ? { cannot: "cannot_do", human: "human_requested", model: "reply", boom: "system_error", plain: null }
        : { cannot: null, human: null, model: "reply", boom: "system_error", plain: null };
    assert.deepEqual(category, expected, mode);
    assert.deepEqual(
      replies.map((r) => r.response),
      mode === "restructured"
        ? [HANDOFFS.cannot_do.sentence, HANDOFFS.human_requested.sentence, HANDOFFS.reply.sentence, HANDOFFS.system_error.sentence, "ok"]
        : ["ok", "ok", HANDOFFS.reply.sentence, HANDOFFS.system_error.sentence, "ok"],
    );
  }
});

// One assistant message item whose own text is `text`.
const messageItem = (text: string, id: string) => ({
  type: "message",
  id,
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});
const replyText = (escalate: boolean) => (final({ escalate, response: "model text" }) as Response).output_text;
const ESCALATED = replyText(true);
const PLAIN = replyText(false);
const JUNK = "not a reply at all";

test("an escalated message among co-returned messages ends the turn before any tool runs (both modes)", async () => {
  const memoryTool = TOOLS.find((tool) => tool.name === "updateWorkingMemoryTool")!;
  const run = memoryTool.run;
  let writes = 0;
  memoryTool.run = (input) => (writes++, run(input));
  // [label, message texts in output order, whether the turn must stop at the handoff]
  const cases: [string, string[], boolean][] = [
    ["escalation alone", [ESCALATED], true],
    ["escalation first, non-escalating second", [ESCALATED, PLAIN], true],
    ["non-escalating first, escalation last", [PLAIN, ESCALATED], true],
    ["escalation first, unparseable second", [ESCALATED, JUNK], true],
    ["unparseable first, escalation last", [JUNK, ESCALATED], true],
    ["non-escalating alone", [PLAIN], false],
    ["non-escalating and unparseable", [PLAIN, JUNK], false],
  ];
  try {
    for (const [label, texts, stops] of cases) {
      for (const mode of ["restructured", "baseline"] as const) {
        writes = 0;
        let replyCalls = 0;
        const client = fake(async (body) => {
          if ((body.text?.format as { name?: string }).name === "Route") {
            return { ...final({}), output_text: JSON.stringify({ intent: "x", skills: [], escalation: null }) } as Response;
          }
          if (++replyCalls > 1) return final({ response: "a later answer" });
          const call = toolCall("updateWorkingMemoryTool", { memory: {} }, "w1");
          // The SDK's output_text concatenates every message, which is exactly what must not be parsed as one.
          return {
            ...call,
            output: [...call.output, ...texts.map((text, i) => messageItem(text, `msg_${i}`))],
            output_text: texts.join(""),
          } as unknown as Response;
        });
        const traces: Record<string, unknown>[] = [];
        const [reply] = await replyAll([{ id: "m", text: "hi" }], {
          client,
          mode,
          model: "m",
          effort: "low",
          router: { model: "r", effort: "none" },
          trace: (record) => traces.push(record),
        });
        const where = `${mode}, ${label}`;
        if (stops) {
          assert.equal(writes, 0, `${where}: no tool after an escalation`);
          assert.equal(replyCalls, 1, `${where}: no further model call`);
          assert.equal(reply!.response, HANDOFFS.reply.sentence, where);
          assert.equal(traces[0]!.escalationCategory, "reply", where);
        } else {
          // No escalation: the tool runs and the loop continues, as before.
          assert.equal(writes, 1, where);
          assert.equal(replyCalls, 2, where);
          assert.equal(reply!.response, "a later answer", where);
        }
      }
    }
  } finally {
    memoryTool.run = run;
  }
});
