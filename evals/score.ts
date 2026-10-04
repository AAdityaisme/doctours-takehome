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

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const digitsOnly = (text: string): string => text.replace(/[\s/.-]/g, "");

/**
 * Whether `needle` appears in `haystack`, by its literal kind: URLs as exact links (so `/clinic/heva` is not
 * found inside `/clinic/heva/checkout`), emails case-insensitively, dollar amounts not followed by more digits
 * (`$500` is not in `$5,000`), and digit strings with separators ignored (a card echoed without spaces still counts).
 */
export function containsLiteral(haystack: string, needle: string): boolean {
  if (URL.test(needle)) return findUrls(haystack).includes(needle);
  if (EMAIL.test(needle)) return haystack.toLowerCase().includes(needle.toLowerCase());
  if (DOLLARS.test(needle)) return new RegExp(`${escape(needle)}(?!\\d|,\\d)`).test(haystack);
  return digitsOnly(haystack).includes(digitsOnly(needle));
}

/** Every claim a case makes, includes first. */
export const claimsOf = (c: Case): Claim[] => [
  ...c.expect.mustInclude.map((claim) => ({ kind: "include" as const, claim })),
  ...c.expect.mustNotInclude.map((claim) => ({ kind: "exclude" as const, claim })),
];

/**
 * Literal claims: a must-include is looked for in the patient-facing text; a must-not-include in the whole reply,
 * so a card number leaking into a reason or memory field still fails.
 */
export function checkLiteral(claim: Claim, reply: Reply): ClaimResult {
  const where = claim.kind === "include" ? reply.response : JSON.stringify(reply);
  const found = containsLiteral(where, claim.claim);
  const pass = claim.kind === "include" ? found : !found;
  const reason = found ? "found in reply" : "not found in reply";
  return { ...claim, method: "literal", pass, reason };
}

/**
 * Scores one reply against its case. `verdicts` answers the case's model claims in order; a missing verdict fails
 * its claim. The category is checked only when the trace carries `escalationCategory`. A failed reply (trace `ok`
 * false, which the CLI turns into a system-error escalation) or a failed grader call marks the trial as errored.
 */
export function scoreTrial(c: Case, reply: Reply, trace: Trace | null, verdicts: Verdicts): Trial {
  const all = claimsOf(c);
  const modelClaims = all.filter((claim) => !isLiteral(claim.claim));
  const claims = all.map((claim): ClaimResult => {
    if (isLiteral(claim.claim)) return checkLiteral(claim, reply);
    const verdict = verdicts?.[modelClaims.indexOf(claim)];
    return { ...claim, method: "model", pass: verdict?.pass ?? false, reason: verdict?.reason ?? "no grader verdict" };
  });
  const escalateOk = reply.escalate === c.expect.escalate;
  const categoryOk =
    trace && "escalationCategory" in trace ? (trace.escalationCategory ?? null) === c.expect.escalationCategory : null;
  const error =
    trace?.ok === false ? `reply failed: ${String(trace.error)}` : verdicts === null && modelClaims.length > 0 ? "grader failed" : null;
  const pass = !error && escalateOk && categoryOk !== false && claims.every((claim) => claim.pass);
  return { reply, trace, escalateOk, categoryOk, claims, pass, error };
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
 * Asks the grader model about the claims code can't check. It sees the patient's message, the reply and the claims,
 * nothing else (no notes, no packet). Returns verdicts in claim order plus the call's token usage.
 */
export async function gradeClaims(
  client: Client,
  options: { model: string; effort: string },
  text: string,
  reply: Reply,
  claims: Claim[],
): Promise<{ verdicts: Verdicts; usage: Usage }> {
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
  const parsed = JSON.parse(response.output_text) as { verdicts: { claim: number; pass: boolean; reason: string }[] };
  const byNumber = new Map(parsed.verdicts.map((verdict) => [verdict.claim, verdict]));
  const verdicts = numbered.map(({ claim }) => {
    const verdict = byNumber.get(claim);
    return verdict ? { pass: verdict.pass, reason: verdict.reason } : { pass: false, reason: "no grader verdict" };
  });
  const usage = response.usage;
  return {
    verdicts,
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
  /** Share of cases that pass every one of their k trials (an errored trial is not a pass). */
  passK: Rate;
  topics: Record<string, { cases: number; escalate: Rate; claims: Rate; casePass: Rate }>;
}

/**
 * Aggregates scored cases: escalate accuracy split by expectation, claim pass rates, case pass, pass^k, per topic.
 * Errored trials are counted but kept out of the rates, so an outage can't pass for system behaviour.
 */
export function summarize(results: CaseResult[]): Summary {
  const every = results.flatMap((r) => r.trials.map((t) => ({ ...t, topic: r.topic, expectEscalate: r.expectEscalate })));
  const trials = every.filter((t) => !t.error);
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
    passK: rate(results.filter((r) => r.trials.every((t) => t.pass)).length, results.length),
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
    `| Escalation category | ${summary.category.total === 0 ? "n/a (trace has no category)" : pct(summary.category)} |`,
    `| Claims passed, all | ${pct(summary.claims.all)} |`,
    `| Claims passed, literal | ${pct(summary.claims.literal)} |`,
    `| Claims passed, model-graded | ${pct(summary.claims.model)} |`,
    `| Cases fully passed | ${pct(summary.casePass)} |`,
    `| Errored trials (left out of rates) | ${summary.errored} |`,
    ...(repeat > 1 ? [`| pass^${repeat} | ${pct(summary.passK)} |`] : []),
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
