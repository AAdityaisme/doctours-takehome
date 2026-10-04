import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { Reply } from "../src/reply.ts";
import { toEscalation } from "../src/escalation.ts";
import {
  checkLiteral,
  containsLiteral,
  cost,
  gradeClaims,
  isLiteral,
  percentile,
  scoreTrial,
  summarize,
  type Case,
  type CaseResult,
} from "../evals/score.ts";

const reply = (fields: Partial<Reply> = {}): Reply => ({
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
});

const caseOf = (expect: Partial<Case["expect"]> = {}, topic = "t"): Case => ({
  id: "c",
  text: "hi",
  topic,
  source: "",
  expect: { escalate: false, escalationCategory: null, mustInclude: [], mustNotInclude: [], notes: "", ...expect },
});

const load = (name: string): Case[] => JSON.parse(readFileSync(new URL(`../evals/${name}`, import.meta.url), "utf8"));

test("literal claims are URLs, emails, dollar amounts and digit strings; the rest go to the grader", () => {
  for (const claim of ["https://www.doctours.com/consultation", "molly@doctours.com", "$600", "$3,000", "4111 1111 1111 1111", "08/29", "1111"]) {
    assert.equal(isLiteral(claim), true, claim);
  }
  for (const claim of ["Heva Gold is $4,500", "answers a sales question", "Sapphire deposit is $500"]) {
    assert.equal(isLiteral(claim), false, claim);
  }
});

test("literal matching respects link, amount and card boundaries", () => {
  const heva = "https://www.doctours.com/clinic/heva";
  assert.equal(containsLiteral(`Book here:\n${heva}/checkout`, heva), false);
  assert.equal(containsLiteral(`See Heva.\n${heva}`, heva), true);
  assert.equal(containsLiteral("Gold is $5,000.", "$500"), false);
  assert.equal(containsLiteral("The deposit is $500.", "$500"), true);
  assert.equal(containsLiteral("card 4111-1111-1111-1111 noted", "4111 1111 1111 1111"), true);
  assert.equal(containsLiteral("Email Molly@Doctours.com", "molly@doctours.com"), true);
});

test("a must-not-include literal is searched in the whole reply, a must-include only in the text", () => {
  const leaked = reply({ response: "Handing this over.", escalationReason: "card 4242" });
  assert.equal(checkLiteral({ kind: "exclude", claim: "4242" }, leaked).pass, false);
  const inMemory = reply({ response: "Hi", workingMemoryUpdates: { promisesMade: "https://www.doctours.com/consultation" } });
  assert.equal(checkLiteral({ kind: "include", claim: "https://www.doctours.com/consultation" }, inMemory).pass, false);
});

test("scoreTrial maps verdicts to model claims in order, around literal ones", () => {
  const c = caseOf({ mustInclude: ["$600", "Gold has 4 nights"], mustNotInclude: ["a payment link", "4242"] });
  const trial = scoreTrial(c, reply({ response: "Gold: $600 deposit, 4 nights." }), null, [
    { pass: true, reason: "states 4 nights" },
    { pass: false, reason: "has a link" },
  ]);
  assert.deepEqual(
    trial.claims.map((claim) => [claim.claim, claim.method, claim.pass]),
    [
      ["$600", "literal", true],
      ["Gold has 4 nights", "model", true],
      ["a payment link", "model", false],
      ["4242", "literal", true],
    ],
  );
  assert.equal(trial.pass, false);
});

test("a missing verdict fails its claim", () => {
  const trial = scoreTrial(caseOf({ mustInclude: ["states a price"] }), reply(), null, []);
  assert.equal(trial.claims[0].pass, false);
  assert.equal(trial.claims[0].reason, "no grader verdict");
});

test("escalate must match exactly; the category counts only when the trace carries one", () => {
  const c = caseOf({ escalate: true, escalationCategory: "cannot_do" });
  const escalated = toEscalation("needs a person");
  assert.equal(scoreTrial(c, reply(), null, []).escalateOk, false);
  const noCategory = scoreTrial(c, escalated, { index: 0 }, []);
  assert.equal(noCategory.categoryOk, null);
  assert.equal(noCategory.pass, true);
  const wrong = scoreTrial(c, escalated, { escalationCategory: "human_requested" }, []);
  assert.equal(wrong.categoryOk, false);
  assert.equal(wrong.pass, false);
  assert.equal(scoreTrial(c, escalated, { escalationCategory: "cannot_do" }, []).categoryOk, true);
});

test("the grader sees only the message, the reply and the claims, and verdicts come back in claim order", async () => {
  let body: ResponseCreateParamsNonStreaming | undefined;
  const client = {
    responses: {
      create: async (request: ResponseCreateParamsNonStreaming) => {
        body = request;
        const output_text = JSON.stringify({
          verdicts: [
            { claim: 2, pass: false, reason: "second" },
            { claim: 1, pass: true, reason: "first" },
          ],
        });
        return { output_text, usage: { input_tokens: 10, output_tokens: 5 } } as unknown as Response;
      },
    },
  };
  const sent = reply({ response: "Silver is $3,000." });
  const claims = [
    { kind: "include" as const, claim: "Silver price" },
    { kind: "exclude" as const, claim: "a discount" },
    { kind: "include" as const, claim: "Gold price" },
  ];
  const graded = await gradeClaims(client, { model: "m", effort: "low" }, "how much?", sent, claims);
  assert.deepEqual(graded.verdicts, [
    { pass: true, reason: "first" },
    { pass: false, reason: "second" },
    { pass: false, reason: "no grader verdict" },
  ]);
  assert.equal(graded.usage.input, 10);
  const user = JSON.parse((body?.input as { role: string; content: string }[])[1].content);
  assert.deepEqual(Object.keys(user), ["patientMessage", "reply", "claims"]);
  assert.equal(user.claims[1].type, "must not include");
  assert.equal((body?.text?.format as { strict?: boolean }).strict, true);
});

test("summarize splits escalate accuracy by expectation and computes pass^k over repeats", () => {
  const pass = scoreTrial(caseOf(), reply(), null, []);
  const miss = scoreTrial(caseOf({ escalate: true, escalationCategory: "human_requested" }), reply(), null, []);
  const results: CaseResult[] = [
    { id: "a", topic: "x", expectEscalate: false, trials: [pass, pass] },
    { id: "b", topic: "x", expectEscalate: false, trials: [pass, { ...pass, pass: false }] },
    { id: "c", topic: "y", expectEscalate: true, trials: [miss, miss] },
  ];
  const summary = summarize(results);
  assert.deepEqual(summary.escalate.expectedFalse, { hits: 4, total: 4, rate: 1 });
  assert.deepEqual(summary.escalate.expectedTrue, { hits: 0, total: 2, rate: 0 });
  assert.equal(summary.casePass.hits, 3);
  assert.deepEqual(summary.passK, { hits: 1, total: 3, rate: 1 / 3 });
  assert.equal(summary.topics.y.cases, 1);
  assert.equal(summary.category.total, 0);
});

test("cost prices uncached, cached, cache-write and output tokens; unknown models have no price", () => {
  const usage = { input: 1_000_000, cached: 600_000, cacheWrite: 100_000, output: 100_000, reasoning: 50_000 };
  // 300k uncached x $2 + 600k x $0.10 + 100k x $2.50 + 100k x $10 = 0.6 + 0.06 + 0.25 + 1.0
  assert.equal(cost("gpt-6.1-sol", usage)?.toFixed(2), "1.91");
  assert.equal(cost("unknown", usage), null);
});

test("percentile is nearest-rank", () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([5, 1, 3, 2, 4], 95), 5);
  assert.equal(percentile([], 50), null);
});

test("case files are well formed: unique ids, consistent escalation, handoff checks on every escalated case", () => {
  const cases = load("cases.json");
  const samples = load("packet-samples.json");
  const ids = [...cases, ...samples].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of [...cases, ...samples]) {
    assert.equal(typeof c.text, "string", c.id);
    assert.equal(c.expect.escalate, c.expect.escalationCategory !== null, c.id);
    assert.ok(Array.isArray(c.expect.mustInclude) && Array.isArray(c.expect.mustNotInclude), c.id);
  }
  for (const c of cases.filter((c) => c.expect.escalate)) {
    assert.ok(c.expect.mustNotInclude.some((claim) => claim.includes("over text")), `${c.id}: L769 check`);
    assert.ok(c.expect.mustNotInclude.some((claim) => claim.startsWith("names a role")), `${c.id}: L877 check`);
  }
});
