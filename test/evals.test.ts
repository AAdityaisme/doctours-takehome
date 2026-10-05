import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { Reply } from "../src/reply.ts";
import { toEscalation } from "../src/escalation.ts";
import { mkdtempSync, rmSync, writeFileSync as writeFile } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { counting429, load, parseOptions, writeResults } from "../evals/run.ts";
import {
  checkLiteral,
  containsLiteral,
  cost,
  gradeClaims,
  isLiteral,
  parseVerdicts,
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

const assertCaseShape = (cases: Case[]) => {
  const ids = cases.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of cases) {
    for (const field of ["id", "text", "topic", "source"] as const) assert.equal(typeof c[field], "string", c.id);
    assert.equal(typeof c.expect.escalate, "boolean", c.id);
    assert.ok([null, "human_requested", "cannot_do"].includes(c.expect.escalationCategory), c.id);
    assert.ok(c.expect.escalate === (c.expect.escalationCategory !== null), c.id);
    for (const field of ["mustInclude", "mustNotInclude"] as const) {
      assert.ok(Array.isArray(c.expect[field]) && c.expect[field].every((claim) => typeof claim === "string"), c.id);
    }
    assert.equal(typeof c.expect.notes, "string", c.id);
    assert.ok(c.ambiguous === undefined || typeof c.ambiguous === "boolean", c.id);
  }
};

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
  const escalated = toEscalation("reply");
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
            { claim: 3, pass: true, reason: "third" },
            { claim: 1, pass: true, reason: "first" },
          ],
        });
        return { status: "completed", output_text, usage: { input_tokens: 10, output_tokens: 5 } } as unknown as Response;
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
    { pass: true, reason: "third" },
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
  assertCaseShape([...cases, ...samples]);
  for (const c of cases.filter((c) => c.expect.escalate)) {
    assert.ok(c.expect.mustNotInclude.some((claim) => claim.includes("over text")), `${c.id}: L769 check`);
    assert.ok(c.expect.mustNotInclude.some((claim) => claim.startsWith("names a role")), `${c.id}: L877 check`);
  }
});

test("--cases-file loads the blind holdout and checks shape only", () => {
  assert.equal(parseOptions([]).values["cases-file"], "./cases.json");
  const { values } = parseOptions(["--cases-file", "./holdout.json"]);
  const cases = load(values["cases-file"]);
  assert.equal(cases.length, 30);
  assertCaseShape([...cases, ...load("./packet-samples.json")]);
});

test("a failed reply or grader call errors the trial: never a pass, never in the rates", () => {
  const c = caseOf({ escalate: true, escalationCategory: "cannot_do", mustNotInclude: ["answers a sales question"] });
  // The CLI turns a failed message into a system-error escalation, which would otherwise look like a correct escalation.
  const failedReply = scoreTrial(c, toEscalation("system_error"), { ok: false, error: "429" }, [{ pass: true, reason: "" }]);
  assert.equal(failedReply.error, "reply failed: 429");
  assert.equal(failedReply.pass, false);
  const failedGrader = scoreTrial(c, toEscalation("reply"), { ok: true }, null);
  assert.equal(failedGrader.error, "grader failed");
  const good = scoreTrial(c, toEscalation("reply"), { ok: true }, [{ pass: true, reason: "" }]);
  const summary = summarize([{ id: "c", topic: "x", expectEscalate: true, trials: [failedReply, failedGrader, good] }]);
  assert.equal(summary.errored, 2);
  assert.deepEqual(summary.escalate.expectedTrue, { hits: 1, total: 1, rate: 1 });
  assert.deepEqual(summary.passK, { hits: 0, total: 0, rate: null });
  assert.equal(summary.passKIncomplete, 1);
});

// Red-team round 1 (triage-pr3-6b1abff): one test per fix.

const graderResponse = (verdicts: unknown, status = "completed") =>
  ({ status, output_text: JSON.stringify({ verdicts }) }) as unknown as Response;

test("H1: exclusions read each decoded string, so a line break can't hide a URL or card digits", () => {
  const c = caseOf({ mustNotInclude: ["https://www.doctours.com/clinic/heva/checkout", "4111 1111 1111 1111"] });
  const links = reply({
    response: "Use these:\nhttps://www.doctours.com/clinic/heva/checkout\nhttps://www.doctours.com/payment/44444444-4444-4444-8444-444444444441",
  });
  assert.equal(scoreTrial(c, links, null, []).claims[0].pass, false);
  const memory = reply({ workingMemoryUpdates: { keyConcerns: "4111 1111\n1111 1111" } });
  assert.equal(scoreTrial(c, memory, null, []).claims[1].pass, false);
});

test("H2: amounts and emails match as whole tokens of the same value", () => {
  assert.equal(containsLiteral("The deposit is $500.99.", "$500"), false);
  assert.equal(containsLiteral("Silver is $3,000, Gold more.", "$3,000"), true);
  assert.equal(containsLiteral("Deposit $500.00 today", "$500"), true);
  assert.equal(containsLiteral("Email notmolly@doctours.com.evil.test.", "molly@doctours.com"), false);
  assert.equal(containsLiteral("Reach Molly at Molly@Doctours.com.", "molly@doctours.com"), true);
});

test("H3: a dollar amount inside a prose must-include is also checked in code", () => {
  const c = caseOf({ mustInclude: ["Heva Gold deposit is $600"], mustNotInclude: ["a Heva price above $4,500"] });
  const yes = [{ pass: true, reason: "" }, { pass: true, reason: "" }];
  const wrong = scoreTrial(c, reply({ response: "Heva Gold has a $601 deposit." }), null, yes);
  assert.equal(wrong.claims.find((claim) => claim.claim === "$600")?.pass, false);
  assert.equal(wrong.pass, false);
  // Exclusions are not split into tokens: naming $4,500 is fine, only the forbidden claim is.
  assert.equal(scoreTrial(c, reply({ response: "Gold is $4,500 with a $600 deposit." }), null, yes).pass, true);
});

test("H4: duplicate, out-of-range, missing or non-boolean verdicts are a grader error, never a pass", () => {
  const bad = [
    [{ claim: 1, pass: false, reason: "no" }, { claim: 1, pass: true, reason: "overwrite" }],
    [{ claim: 2, pass: true, reason: "out of range" }],
    [],
    [{ claim: 1, pass: "false", reason: "string" }],
  ];
  for (const verdicts of bad) assert.throws(() => parseVerdicts(graderResponse(verdicts), 1), JSON.stringify(verdicts));
  assert.deepEqual(parseVerdicts(graderResponse([{ claim: 1, pass: true, reason: "ok" }]), 1), [{ pass: true, reason: "ok" }]);
  const c = caseOf({ mustInclude: ["the deposit is refundable"] });
  assert.equal(scoreTrial(c, reply(), null, [{ pass: "yes" as unknown as boolean, reason: "" }]).pass, false);
  assert.equal(scoreTrial(c, reply(), null, []).error, "grader failed");
});

test("H5: an empty reply never passes, and every non-escalated case asks for an answer", () => {
  const c = caseOf({ mustNotInclude: ["drive times"] });
  const empty = scoreTrial(c, reply({ response: "  " }), null, [{ pass: true, reason: "nothing said" }]);
  assert.equal(empty.answered, false);
  assert.equal(empty.pass, false);
  for (const k of load("cases.json").filter((k) => !k.expect.escalate)) {
    assert.ok(k.expect.mustInclude.length > 0, `${k.id} has no positive claim`);
  }
});

test("M1: an incomplete grader response is a grader error", () => {
  assert.throws(() => parseVerdicts(graderResponse([{ claim: 1, pass: true, reason: "ok" }], "incomplete"), 1), /incomplete/);
});

test("M2: pass^k leaves out cases whose k trials didn't all complete", () => {
  const c = caseOf({ mustInclude: ["$500"] });
  const good = scoreTrial(c, reply({ response: "The deposit is $500." }), { ok: true }, []);
  const failed = scoreTrial(c, reply(), { ok: false, error: "429" }, []);
  const summary = summarize([
    { id: "complete", topic: "t", expectEscalate: false, trials: [good, good] },
    { id: "outage", topic: "t", expectEscalate: false, trials: [good, failed] },
  ]);
  assert.deepEqual(summary.passK, { hits: 1, total: 1, rate: 1 });
  assert.equal(summary.passKIncomplete, 1);
});

test("M3: results never overwrite an existing file, they take the next free suffix", () => {
  const dir = mkdtempSync(join(tmpdir(), "evals-results-"));
  try {
    const url = pathToFileURL(`${dir}/`);
    writeFile(new URL("baseline-x.json", url), "earlier run");
    const out = writeResults(url, "baseline-x", "this run");
    assert.ok(out.pathname.endsWith("/baseline-x-2.json"));
    assert.equal(readFileSync(new URL("baseline-x.json", url), "utf8"), "earlier run");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("M4: no case reuses a packet sample message verbatim", () => {
  const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const samples = new Set(load("packet-samples.json").map((s) => norm(s.text)));
  for (const c of load("cases.json")) assert.ok(!samples.has(norm(c.text)), c.id);
});

test("amounts written with USD instead of $ are the same token; other values still differ", () => {
  assert.equal(containsLiteral("Silver is 3,000 USD.", "$3,000"), true);
  assert.equal(containsLiteral("Gold: USD 4,500", "$4,500"), true);
  assert.equal(containsLiteral("Silver is 3,000.50 USD.", "$3,000"), false);
  assert.equal(containsLiteral("2,500 - 3,200 grafts", "$3,200"), false);
});

test("an unusable grader output still reports the call's tokens and errors the trial", async () => {
  const client = {
    responses: {
      create: async () =>
        ({
          status: "incomplete",
          output_text: JSON.stringify({ verdicts: [] }),
          usage: { input_tokens: 40, output_tokens: 7 },
        }) as unknown as Response,
    },
  };
  const claims = [{ kind: "include" as const, claim: "states a price" }];
  const graded = await gradeClaims(client, { model: "m", effort: "low" }, "how much?", reply(), claims);
  assert.equal(graded.verdicts, null);
  assert.match(graded.error ?? "", /incomplete/);
  assert.deepEqual([graded.usage.input, graded.usage.output], [40, 7]);
  assert.equal(scoreTrial(caseOf({ mustInclude: ["states a price"] }), reply(), null, graded.verdicts).error, "grader failed");
});

test("the category is read from the trace's escalationCategory; a router failure is scored and counted", () => {
  const c = caseOf({ escalate: true, escalationCategory: "cannot_do" });
  const escalated = toEscalation("cannot_do");
  assert.equal(scoreTrial(c, escalated, { ok: true, escalationCategory: "cannot_do" }, []).categoryOk, true);
  assert.equal(scoreTrial(c, escalated, { ok: true, escalationCategory: "human_requested" }, []).pass, false);
  // "reply" (the reply model escalated without a category) and "system_error" name no category: skipped, not failed.
  for (const source of ["reply", "system_error", null]) {
    assert.equal(scoreTrial(c, escalated, { ok: true, escalationCategory: source }, []).categoryOk, null, String(source));
  }
  // A false escalation with a named category counts as a wrong category too.
  assert.equal(scoreTrial(caseOf(), escalated, { ok: true, escalationCategory: "cannot_do" }, []).categoryOk, false);
  // The fallback reply is what the patient gets, so it is scored like any other reply, not errored.
  const fallback = scoreTrial(caseOf(), reply(), { ok: true, router: { error: "429" } }, []);
  assert.equal(fallback.error, null);
  assert.equal(fallback.pass, true);
  const summary = summarize([{ id: "c", topic: "t", expectEscalate: false, trials: [fallback] }]);
  assert.equal(summary.routerFailures, 1);
  assert.equal(summary.errored, 0);
  assert.equal(summary.casePass.total, 1);
});

test("emails: a local part with RFC 5322 punctuation is a different mailbox; ordinary surroundings still match", () => {
  const molly = "molly@doctours.com";
  for (const wrong of ["o'molly@doctours.com", "billing/molly@doctours.com", "x!molly@doctours.com", "x=molly@doctours.com"]) {
    assert.equal(containsLiteral(`email ${wrong}.`, molly), false, wrong);
    assert.equal(checkLiteral({ kind: "exclude", claim: molly }, reply({ response: `email ${wrong}` })).pass, true, wrong);
  }
  // An unclosed leading apostrophe belongs to the mailbox: a different address.
  assert.equal(containsLiteral("email 'molly@doctours.com today", molly), false);
  for (const right of ["(molly@doctours.com)", '"molly@doctours.com"', "email: molly@doctours.com.", "'molly@doctours.com'", "`molly@doctours.com`"]) {
    assert.equal(containsLiteral(`Reach Molly ${right}`, molly), true, right);
    assert.equal(checkLiteral({ kind: "exclude", claim: molly }, reply({ response: right })).pass, false, right);
  }
});

test("every 429 response seen is counted", async () => {
  const statuses = [429, 429, 200];
  const waits = { observed429s: 0 };
  const fetcher = counting429(async () => new Response("{}", { status: statuses.shift() }), waits);
  for (let i = 0; i < 3; i++) await fetcher("https://example.invalid");
  assert.equal(waits.observed429s, 2);
});

test("emails: an address running on past its TLD or closing a quoted local part is not the expected one", () => {
  const molly = "molly@doctours.com";
  for (const wrong of ["molly@doctours.com0", "molly@doctours.com-evil", '"molly@doctours.com"@example.org', '"billing molly@doctours.com"@example.org']) {
    assert.equal(containsLiteral(`For creator partnerships, email ${wrong}.`, molly), false, wrong);
  }
  const ends = [".", "...", ",", ";", ":", "!", "?", "'", "`", '"', ")", "]", ">"].map((end) => `Email molly@doctours.com${end}`);
  const wrapped = ["(molly@doctours.com)", "<molly@doctours.com>", '"molly@doctours.com"', "'molly@doctours.com'", "`molly@doctours.com`", '"molly@doctours.com', 'molly@doctours.com"'];
  for (const text of [...ends, ...wrapped.map((w) => `For creator partnerships, email ${w}.`), "Email MOLLY@DOCTOURS.COM."]) {
    assert.equal(containsLiteral(text, molly), true, text);
  }
});
