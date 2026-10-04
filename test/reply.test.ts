import assert from "node:assert/strict";
import { test } from "node:test";
import { HANDOFF_SENTENCE } from "../src/escalation.ts";
import { REPLY_SCHEMA, postProcess, schemaError, urlLast, type Schema } from "../src/reply.ts";
import { TOOLS } from "../src/tools.ts";

const reply = (overrides: object = {}) => ({
  response: "Hi Jordan.",
  escalate: false,
  escalationReason: null,
  templateId: null,
  intent: "answer question",
  shouldFollowUp: false,
  followUpTiming: null,
  attachmentUrls: null,
  highEngagement: false,
  workingMemoryUpdates: null,
  ...overrides,
});

test("REPLY_SCHEMA and all 14 tool schemas are strict: every object is closed and lists all keys as required", () => {
  const walk = (schema: Schema, path: string): void => {
    if ([schema.type].flat().includes("object")) {
      assert.ok(schema.properties, `${path}: object without declared properties`);
      assert.deepEqual(schema.required, Object.keys(schema.properties), `${path}: required`);
      assert.equal(schema.additionalProperties, false, `${path}: additionalProperties`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) walk(child, `${path}.${key}`);
    schema.anyOf?.forEach((child) => walk(child, path));
    if (schema.items) walk(schema.items, `${path}[]`);
  };
  walk(REPLY_SCHEMA, "Reply");
  assert.equal(TOOLS.length, 14);
  for (const tool of TOOLS) walk(tool.parameters, tool.name);
});

test("schema validation rejects missing, extra and out-of-enum fields", () => {
  assert.equal(schemaError(REPLY_SCHEMA, reply()), null);
  const { intent: _intent, ...missing } = reply();
  assert.match(String(schemaError(REPLY_SCHEMA, missing)), /intent: missing/);
  assert.match(String(schemaError(REPLY_SCHEMA, reply({ extra: 1 }))), /extra: not in schema/);
  const memory = {
    collectionState: null,
    communicationStyle: "shouty",
    escalationFlags: null,
    keyConcerns: null,
    patientName: null,
    preferredPaymentMethod: null,
    procedureArea: null,
    promisesMade: null,
    targetProcedureWindow: null,
  };
  assert.notEqual(schemaError(REPLY_SCHEMA, reply({ workingMemoryUpdates: memory })), null);
  assert.equal(
    schemaError(REPLY_SCHEMA, reply({ workingMemoryUpdates: { ...memory, communicationStyle: "casual" } })),
    null,
  );
  assert.throws(() => postProcess(missing, new Set()), /Reply schema/);
});

test("postProcess: templateId null, no reason unless escalating, attachments only from tools, max 3", () => {
  const tool = ["https://a.test/1", "https://a.test/2", "https://a.test/3", "https://a.test/4"];
  const out = postProcess(
    reply({
      templateId: "tpl_1",
      escalationReason: "stray",
      attachmentUrls: ["https://made.up/x", ...tool, tool[0]],
    }),
    new Set(tool),
  );
  assert.equal(out.templateId, null);
  assert.equal(out.escalationReason, null);
  assert.deepEqual(out.attachmentUrls, tool.slice(0, 3));
  assert.equal(postProcess(reply({ attachmentUrls: ["https://made.up/x"] }), new Set()).attachmentUrls, null);
});

test("urlLast keeps compliant text and moves inline URLs to the last line", () => {
  assert.equal(urlLast("No links here.  "), "No links here.");
  const ok = "Here is your link:\nhttps://www.doctours.com/payment/abc";
  assert.equal(urlLast(ok), ok);
  assert.equal(
    urlLast("Open https://www.doctours.com/clinic/heva. Then tell me what you think."),
    "Open. Then tell me what you think.\nhttps://www.doctours.com/clinic/heva",
  );
  assert.equal(
    urlLast("Your page:\nhttps://x.test/a\nAny questions?"),
    "Your page:\nAny questions?\nhttps://x.test/a",
  );
  assert.equal(
    urlLast("See https://x.test/a for photos.\nhttps://x.test/b"),
    "See for photos.\nhttps://x.test/a\nhttps://x.test/b",
  );
  assert.equal(
    urlLast("Book using HTTPS://www.doctours.com/consultation. It's free."),
    "Book using. It's free.\nHTTPS://www.doctours.com/consultation",
  );
  // Bare domains are sentence text, not links: left in place.
  assert.equal(urlLast("You can buy at hims.com."), "You can buy at hims.com.");
});

test("an escalated reply is replaced by the handoff sentence and nothing else ships", () => {
  const out = postProcess(
    reply({
      escalate: true,
      escalationReason: "patient asked to charge card 4242 4242 4242 4242",
      response: "Sure, charging your card ending 4242 now! Meanwhile, Gold is $4500.",
      attachmentUrls: ["https://www.doctours.com/payment/x"],
      shouldFollowUp: true,
      followUpTiming: "1 day",
    }),
    new Set(["https://www.doctours.com/payment/x"]),
  );
  assert.equal(out.response, HANDOFF_SENTENCE);
  assert.equal(out.escalate, true);
  assert.equal(out.escalationReason, "needs a person");
  assert.doesNotMatch(JSON.stringify(out), /4242/);
  assert.equal(out.attachmentUrls, null);
  assert.equal(out.shouldFollowUp, false);
  assert.equal(out.followUpTiming, null);
  assert.equal(out.workingMemoryUpdates, null);
});
