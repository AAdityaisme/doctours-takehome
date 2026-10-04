import type { Response } from "openai/resources/responses/responses";
import type { ReasoningEffort } from "openai/resources/shared";
import { findUrls, strictObject, type Reply } from "../src/reply.ts";
import type { Client, Usage } from "../src/respond.ts";

export interface Case {
  id: string;
  text: string;
  expect: {
    escalate: boolean;
    escalationCategory: "human_requested" | "cannot_do" | null;
    mustInclude: string[];
    mustNotInclude: string[];
    notes: string;
  };
  ambiguous?: boolean;
  topic: string;
  source: string;
}

export type Trace = Record<string, unknown>;

export interface Claim {
  kind: "include" | "exclude";
  claim: string;
}

export interface ClaimResult extends Claim {
  method: "literal" | "model";
  pass: boolean;
  reason: string;
}

export interface Trial {
  reply: Reply;
  trace: Trace | null;
  escalateOk: boolean;
  /** null when the trace does not expose a category (PR1 traces don't). */
  categoryOk: boolean | null;
  claims: ClaimResult[];
  /** False when a reply that should answer has an empty response; an empty SMS never passes. */
  answered: boolean;
  pass: boolean;
  /** Set when the reply or the grader failed. Such a trial is left out of every rate and never counts as a pass. */
  error: string | null;
}

export interface CaseResult {
  id: string;
  topic: string;
  expectEscalate: boolean;
  trials: Trial[];
}

/** One model verdict per claim, in claim order; null when the grader call failed. */
export type Verdicts = { pass: boolean; reason: string }[] | null;

const URL = /^https?:\/\/\S+$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]+$/i;
const DOLLARS = /^\$\d[\d,]*(\.\d+)?$/;
const DIGITS = /^(?=.*\d)[\d\s/-]+$/;

/** URLs, emails, dollar amounts and card-style digit strings are checked in code; anything else is a claim for the grader. */
export const isLiteral = (claim: string): boolean => [URL, EMAIL, DOLLARS, DIGITS].some((pattern) => pattern.test(claim));

// "$3,000", "3,000 USD" and "USD 3,000" are the same amount; "$500.99" is not "$500".
const NUMBER = String.raw`\d+(?:,\d{3})*(?:\.\d+)?`;
const AMOUNT_TOKEN = new RegExp(String.raw`\$\s?${NUMBER}|\b${NUMBER}\s?USD\b|\bUSD\s?${NUMBER}`, "g");
// The local part takes every RFC 5322 atext character plus ".", so a token starts where the address really starts:
// "o'molly@" or "billing/molly@" is a different mailbox, not "molly@" with a prefix. A leading quote or backtick is
// atext too, so it is stripped only when the same character closes the address: 'molly@doctours.com' (quoted) is
// Molly's address, while an unclosed 'molly@doctours.com is a different mailbox.
const EMAIL_TOKEN = /[\w!#$%&'*+\/=?^`{|}~.-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi;
const emailsIn = (text: string): string[] =>
  [...text.matchAll(EMAIL_TOKEN)].map(({ 0: token, index }) => {
    const quote = token[0];
    const closed = (quote === "'" || quote === "`") && text[index + token.length] === quote;
    return closed ? token.slice(1) : token;
  });
const amount = (token: string): number => Number(token.replace(/[^\d.]/g, ""));
const digitsOnly = (text: string): string => text.replace(/[\s/.-]/g, "");

/** The whole URLs, email addresses and dollar amounts in `text`, as tokens. */
export const literalsIn = (text: string): string[] => [
  ...findUrls(text),
  ...emailsIn(text),
  ...(text.match(AMOUNT_TOKEN) ?? []),
];

/**
 * Whether `needle` appears in `haystack` as a whole token of its kind: an exact link (so `/clinic/heva` is not
 * found inside `/clinic/heva/checkout`), a whole email address (so `molly@` is not found inside
 * `notmolly@...evil.test`), a dollar amount of the same value (`$500` is neither `$500.99` nor `$5,000`), or a digit
 * string with separators ignored (a card echoed without spaces or across a line break still counts).
 */
export function containsLiteral(haystack: string, needle: string): boolean {
  if (URL.test(needle)) return findUrls(haystack).includes(needle);
  if (EMAIL.test(needle)) return emailsIn(haystack).some((t) => t.toLowerCase() === needle.toLowerCase());
  if (DOLLARS.test(needle)) return (haystack.match(AMOUNT_TOKEN) ?? []).some((t) => amount(t) === amount(needle));
  return digitsOnly(haystack).includes(digitsOnly(needle));
}

/** Every string value in a reply, decoded and each on its own (not its JSON encoding, which escapes line breaks). */
const stringsIn = (value: unknown): string[] =>
  typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(stringsIn) : [];

/**
 * Why a trace has no reply to score, if it has none: the reply loop failed and the CLI sent a system-error escalation
 * in its place. A router failure is not this. Restructured mode then replies on its fallback path, which is what a
 * patient (and the graders) would get, so that reply is scored and the failure only counted (`routerFailed`).
 */
export function traceFailure(trace: Trace | null): string | null {
  return trace?.ok === false ? `reply failed: ${String(trace.error)}` : null;
}

/** Whether restructured mode's router failed on this message, so the reply came from the fallback path. */
export const routerFailed = (trace: Trace | null): boolean =>
  Boolean((trace?.router as { error?: unknown } | undefined)?.error);

/**
 * The escalation category a trace names, from its top-level `escalationCategory` (the handoff source). Only the two
 * real categories count: "reply" (the reply model escalated without naming one), "system_error" and null name none,
 * so the check is skipped rather than failed. A wrong-or-false escalation is already caught by `escalate`.
 */
const categoryOf = (trace: Trace | null): string | null => {
  const category = trace?.escalationCategory;
  return category === "human_requested" || category === "cannot_do" ? category : null;
};

/** Every claim a case makes, includes first. */
export const claimsOf = (c: Case): Claim[] => [
  ...c.expect.mustInclude.map((claim) => ({ kind: "include" as const, claim })),
  ...c.expect.mustNotInclude.map((claim) => ({ kind: "exclude" as const, claim })),
];

/**
 * Literal claims: a must-include is looked for in the patient-facing text; a must-not-include in every string of the
 * reply, so a card number leaking into a reason or memory field still fails.
 */
export function checkLiteral(claim: Claim, reply: Reply): ClaimResult {
  const where = claim.kind === "include" ? [reply.response] : stringsIn(reply);
  const found = where.some((text) => containsLiteral(text, claim.claim));
  const pass = claim.kind === "include" ? found : !found;
  const reason = found ? "found in reply" : "not found in reply";
  return { ...claim, method: "literal", pass, reason };
}

/**
 * The code half of a prose must-include: every URL, email and dollar amount it names must appear as a whole token,
 * so the grader can't wave through a wrong number. The grader still judges what the number refers to. A prose
 * must-not-include is not split this way: "a Heva price above $4,500" forbids a claim, not the token $4,500.
 */
const embeddedChecks = (claim: Claim, reply: Reply): ClaimResult[] =>
  claim.kind === "include" && !isLiteral(claim.claim)
    ? literalsIn(claim.claim).map((token) => {
        const result = checkLiteral({ kind: "include", claim: token }, reply);
        return { ...result, reason: `${result.reason} (from "${claim.claim}")` };
      })
    : [];

/**
 * Scores one reply against its case. `verdicts` answers the case's model claims in order; a missing verdict fails
 * its claim. The category is checked only when the trace names one. A failed reply (`traceFailure`) or a failed
 * grader call marks the trial as errored: no reply, or no usable grade.
 */
export function scoreTrial(c: Case, reply: Reply, trace: Trace | null, verdicts: Verdicts): Trial {
  const all = claimsOf(c);
  const modelClaims = all.filter((claim) => !isLiteral(claim.claim));
  const claims = all.flatMap((claim): ClaimResult[] => {
    if (isLiteral(claim.claim)) return [checkLiteral(claim, reply)];
    const verdict = verdicts?.[modelClaims.indexOf(claim)];
    const graded: ClaimResult = {
      ...claim,
      method: "model",
      pass: verdict?.pass === true,
      reason: verdict?.reason ?? "no grader verdict",
    };
    return [graded, ...embeddedChecks(claim, reply)];
  });
  const answered = c.expect.escalate || reply.response.trim() !== "";
  const escalateOk = reply.escalate === c.expect.escalate;
  const category = categoryOf(trace);
  const categoryOk = category === null ? null : category === c.expect.escalationCategory;
  const graderFailed = modelClaims.length > 0 && (verdicts === null || verdicts.length !== modelClaims.length);
  const error = traceFailure(trace) ?? (graderFailed ? "grader failed" : null);
  const pass = !error && answered && escalateOk && categoryOk !== false && claims.every((claim) => claim.pass);
  return { reply, trace, escalateOk, categoryOk, claims, answered, pass, error };
}

const GRADER_INSTRUCTIONS = `You grade one SMS reply that a hair-transplant patient coordinator sent to a patient.
You get the patient's message, the reply as JSON ("response" is the text the patient sees, "attachmentUrls" are attached links), and numbered claims.
For every claim return pass true or false and a one-line reason.
- "must include": pass only if the reply clearly states that fact or does that thing. Wording may differ; names, numbers, prices and links must match.
- "must not include": pass only if the reply does not state or do that thing.
Judge only what the reply says. Do not use outside knowledge about whether a fact is true. Return exactly one verdict per claim number.`;

const VERDICT_SCHEMA = strictObject({
  verdicts: {
    type: "array",
    items: strictObject({ claim: { type: "integer" }, pass: { type: "boolean" }, reason: { type: "string" } }),
  },
});

/**
 * The grader's verdicts, in claim order, or a thrown error the harness turns into an errored trial. A run that did
 * not complete, or output that isn't exactly one boolean verdict per claim number 1..n, is never read as a judgement:
 * strict output can still repeat or skip a number, and a repeated number must not let a later `true` hide a `false`.
 */
export function parseVerdicts(response: Response, count: number): { pass: boolean; reason: string }[] {
  if (response.status !== "completed") throw new Error(`grader response ${response.status}`);
  const parsed = JSON.parse(response.output_text) as { verdicts?: unknown };
  const list = Array.isArray(parsed.verdicts) ? (parsed.verdicts as Record<string, unknown>[]) : [];
  const byNumber = new Map<number, { pass: boolean; reason: string }>();
  for (const v of list) {
    const n = v?.claim;
    const valid = Number.isInteger(n) && (n as number) >= 1 && (n as number) <= count && typeof v.pass === "boolean";
    if (!valid || typeof v.reason !== "string" || byNumber.has(n as number)) {
      throw new Error(`grader returned an invalid verdict: ${JSON.stringify(v)}`);
    }
    byNumber.set(n as number, { pass: v.pass as boolean, reason: v.reason });
  }
  if (byNumber.size !== count) throw new Error(`grader returned ${byNumber.size} verdicts for ${count} claims`);
  return Array.from({ length: count }, (_, i) => byNumber.get(i + 1)!);
}

/**
 * Asks the grader model about the claims code can't check. It sees the patient's message, the reply and the claims,
 * nothing else (no notes, no packet). Returns verdicts in claim order (null, with `error`, when the output is unusable)
 * plus the call's token usage.
 */
export async function gradeClaims(
  client: Client,
  options: { model: string; effort: string },
  text: string,
  reply: Reply,
  claims: Claim[],
): Promise<{ verdicts: Verdicts; usage: Usage; error: string | null }> {
  const numbered = claims.map((claim, i) => ({
    claim: i + 1,
    type: claim.kind === "include" ? "must include" : "must not include",
    text: claim.claim,
  }));
  const response: Response = await client.responses.create({
    model: options.model,
    reasoning: { effort: options.effort as ReasoningEffort },
    input: [
      { role: "developer", content: GRADER_INSTRUCTIONS },
      { role: "user", content: JSON.stringify({ patientMessage: text, reply, claims: numbered }, null, 2) },
    ],
    text: { format: { type: "json_schema", name: "Verdicts", schema: { ...VERDICT_SCHEMA }, strict: true } },
  });
  const usage = response.usage;
  let verdicts: Verdicts = null;
  let error: string | null = null;
  try {
    verdicts = parseVerdicts(response, claims.length);
  } catch (invalid) {
    error = invalid instanceof Error ? invalid.message : String(invalid);
  }
  // Usage is returned even when the verdicts are unusable: the call was still paid for.
  return {
    verdicts,
    error,
    usage: {
      input: usage?.input_tokens ?? 0,
      cached: usage?.input_tokens_details?.cached_tokens ?? 0,
      cacheWrite: usage?.input_tokens_details?.cache_write_tokens ?? 0,
      output: usage?.output_tokens ?? 0,
      reasoning: usage?.output_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

// SPEC "OpenAI facts" (per 1M tokens: input, cached input, output). Cache writes bill at 1.25x input (OpenAI
// deployment checklist, GPT-5.6 and later).
const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-6.1-sol": { input: 2, cached: 0.1, output: 10 },
  "gpt-6-luna": { input: 0.1, cached: 0.01, output: 0.5 },
};

export const zeroUsage = (): Usage => ({ input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 });

/** `total` minus `part`, field by field. */
export const subtractUsage = (total: Usage, part: Usage): Usage => ({
  input: total.input - part.input,
  cached: total.cached - part.cached,
  cacheWrite: total.cacheWrite - part.cacheWrite,
  output: total.output - part.output,
  reasoning: total.reasoning - part.reasoning,
});

/** Sums usage records; missing fields count as zero. */
export const addUsage = (total: Usage, usage: Partial<Usage> | undefined): Usage => ({
  input: total.input + (usage?.input ?? 0),
  cached: total.cached + (usage?.cached ?? 0),
  cacheWrite: total.cacheWrite + (usage?.cacheWrite ?? 0),
  output: total.output + (usage?.output ?? 0),
  reasoning: total.reasoning + (usage?.reasoning ?? 0),
});

/**
 * Dollar estimate for `usage` on `model`, or null for a model with no listed price. Input tokens include cached and
 * cache-write tokens; reasoning tokens are part of output.
 */
export function cost(model: string, usage: Usage): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const uncached = usage.input - usage.cached - usage.cacheWrite;
  return (uncached * price.input + usage.cached * price.cached + usage.cacheWrite * price.input * 1.25 +
    usage.output * price.output) / 1e6;
}

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

const rate = (hits: number, total: number) => ({ hits, total, rate: total === 0 ? null : hits / total });
export type Rate = ReturnType<typeof rate>;

export interface Summary {
  cases: number;
  trials: number;
  escalate: { all: Rate; expectedTrue: Rate; expectedFalse: Rate };
  category: Rate;
  claims: { all: Rate; literal: Rate; model: Rate };
  casePass: Rate;
  /** Trials left out of every rate because the reply or the grader failed. */
  errored: number;
  /** Trials whose router failed; their fallback replies are scored like any other. */
  routerFailures: number;
  /** Share of cases that pass all k trials, over the cases with k completed (non-errored) trials. */
  passK: Rate;
  /** Cases left out of pass^k because one of their trials errored. */
  passKIncomplete: number;
  topics: Record<string, { cases: number; escalate: Rate; claims: Rate; casePass: Rate }>;
}

/**
 * Aggregates scored cases: escalate accuracy split by expectation, claim pass rates, case pass, pass^k, per topic.
 * Errored trials are counted but kept out of the rates, so an outage can't pass for system behaviour.
 */
export function summarize(results: CaseResult[]): Summary {
  const every = results.flatMap((r) => r.trials.map((t) => ({ ...t, topic: r.topic, expectEscalate: r.expectEscalate })));
  const trials = every.filter((t) => !t.error);
  const complete = results.filter((r) => r.trials.every((t) => !t.error));
  const count = (list: typeof trials, test: (t: (typeof trials)[number]) => boolean) =>
    rate(list.filter(test).length, list.length);
  const claims = trials.flatMap((t) => t.claims);
  const claimRate = (list: ClaimResult[]) => rate(list.filter((c) => c.pass).length, list.length);
  const categorised = trials.filter((t) => t.categoryOk !== null);
  const topics: Summary["topics"] = {};
  for (const topic of [...new Set(results.map((r) => r.topic))]) {
    const inTopic = trials.filter((t) => t.topic === topic);
    topics[topic] = {
      cases: results.filter((r) => r.topic === topic).length,
      escalate: count(inTopic, (t) => t.escalateOk),
      claims: claimRate(inTopic.flatMap((t) => t.claims)),
      casePass: count(inTopic, (t) => t.pass),
    };
  }
  return {
    cases: results.length,
    trials: trials.length,
    escalate: {
      all: count(trials, (t) => t.escalateOk),
      expectedTrue: count(trials.filter((t) => t.expectEscalate), (t) => t.escalateOk),
      expectedFalse: count(trials.filter((t) => !t.expectEscalate), (t) => t.escalateOk),
    },
    category: count(categorised, (t) => t.categoryOk === true),
    claims: {
      all: claimRate(claims),
      literal: claimRate(claims.filter((c) => c.method === "literal")),
      model: claimRate(claims.filter((c) => c.method === "model")),
    },
    casePass: count(trials, (t) => t.pass),
    errored: every.length - trials.length,
    routerFailures: every.filter((t) => routerFailed(t.trace)).length,
    passK: rate(complete.filter((r) => r.trials.every((t) => t.pass)).length, complete.length),
    passKIncomplete: results.length - complete.length,
    topics,
  };
}

const pct = (r: Rate): string => (r.rate === null ? "n/a" : `${(r.rate * 100).toFixed(1)}% (${r.hits}/${r.total})`);

/** The summary tables as markdown, plus every failed check for a quick read. */
export function markdown(title: string, summary: Summary, results: CaseResult[], repeat: number): string {
  const lines = [
    `### ${title}`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Escalate accuracy, all | ${pct(summary.escalate.all)} |`,
    `| Escalate accuracy, expected true | ${pct(summary.escalate.expectedTrue)} |`,
    `| Escalate accuracy, expected false | ${pct(summary.escalate.expectedFalse)} |`,
    `| Escalation category | ${summary.category.total === 0 ? "n/a (no escalation named a category)" : pct(summary.category)} |`,
    `| Claims passed, all | ${pct(summary.claims.all)} |`,
    `| Claims passed, literal | ${pct(summary.claims.literal)} |`,
    `| Claims passed, model-graded | ${pct(summary.claims.model)} |`,
    `| Cases fully passed | ${pct(summary.casePass)} |`,
    `| Errored trials (left out of rates) | ${summary.errored} |`,
    `| Router failures (fallback reply scored) | ${summary.routerFailures} |`,
    ...(repeat > 1
      ? [`| pass^${repeat} | ${pct(summary.passK)}; ${summary.passKIncomplete} case(s) with an errored trial left out |`]
      : []),
    "",
    "| Topic | Cases | Escalate | Claims | Case pass |",
    "|---|---|---|---|---|",
    ...Object.entries(summary.topics).map(
      ([topic, t]) => `| ${topic} | ${t.cases} | ${pct(t.escalate)} | ${pct(t.claims)} | ${pct(t.casePass)} |`,
    ),
  ];
  const failures = results.flatMap((r) =>
    r.trials.flatMap((t, i) => {
      const run = repeat > 1 ? ` (run ${i + 1})` : "";
      if (t.error) return [`- ${r.id}${run}: errored (${t.error})`];
      return [
        ...(t.answered ? [] : [`- ${r.id}${run}: empty reply`]),
        ...(t.escalateOk ? [] : [`- ${r.id}${run}: escalate ${t.reply.escalate}, expected ${r.expectEscalate}`]),
        ...(t.categoryOk === false ? [`- ${r.id}${run}: wrong escalation category`] : []),
        ...t.claims
          .filter((c) => !c.pass)
          .map((c) => `- ${r.id}${run}: ${c.kind === "include" ? "missing" : "contains"} "${c.claim}" (${c.reason})`),
      ];
    }),
  );
  if (failures.length > 0) lines.push("", "<details><summary>Failed checks</summary>", "", ...failures, "", "</details>");
  return lines.join("\n");
}
