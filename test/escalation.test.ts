import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response } from "openai/resources/responses/responses";
import { replyAll } from "../src/cli.ts";
import { HANDOFFS, toEscalation, type Handoff } from "../src/escalation.ts";
import { REPLY_SCHEMA, schemaError } from "../src/reply.ts";
import { fake, final } from "./fake.ts";

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
