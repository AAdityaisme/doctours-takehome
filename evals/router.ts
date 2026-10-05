import { apiErrorMessage, messageApiError, nonRetryableApiError } from "../src/api-errors.ts";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import OpenAI from "openai";
import type { Client, Usage } from "../src/respond.ts";
import { route, type Routed } from "../src/router.ts";
import { counting429, fail, load, pool, writeResults } from "./run.ts";
import { addUsage, cost, percentile, zeroUsage, type Case } from "./score.ts";

/** One case through the router alone: what it decided against what the case expects. */
export interface RouterResult {
  id: string;
  set: "cases" | "samples";
  expectEscalate: boolean;
  expectCategory: string | null;
  /** Null when the router failed (`error` set): no decision to score. */
  escalation: { category: string; reason: string } | null;
  intent: string | null;
  skills: string[];
  error: string | null;
  latencyMs: number;
  usage: Usage;
}

/**
 * Sends every case through `route()` exactly as restructured mode does (same input, same model and effort), with no
 * reply call and no grader. Order matches `cases`.
 */
export async function routeCases(
  cases: (Case & { set: RouterResult["set"] })[],
  options: { client: Client; model: string; effort: string; concurrency: number },
): Promise<RouterResult[]> {
  return pool(cases, options.concurrency, async (c) => {
    const started = performance.now();
    let routed: Routed;
    try {
      routed = await route(options.client, c.text, options);
    } catch (error) {
      if (!messageApiError(error)) throw error;
      routed = {
        route: null,
        error: error instanceof Error ? error.message : String(error),
        usage: zeroUsage(),
        apiCalls: 0,
        latencyMs: Math.round(performance.now() - started),
      };
    }
    return {
      id: c.id,
      set: c.set,
      expectEscalate: c.expect.escalate,
      expectCategory: c.expect.escalationCategory,
      escalation: routed.route?.escalation ?? null,
      intent: routed.route?.intent ?? null,
      skills: routed.route?.skills ?? [],
      error: routed.error,
      latencyMs: routed.latencyMs,
      usage: routed.usage,
    };
  });
}

const share = (hits: number, total: number) => ({ hits, total, rate: total === 0 ? null : hits / total });

/**
 * Scores one run. A router failure is scored as no escalation because the router made no decision, and it is also
 * counted on its own; so a variant can't look better by failing on
 * hard cases. A false positive is a handoff the case says to answer; a false negative is a missed handoff, which the
 * reply model may still catch, but the router is measured on its own here.
 */
export function scoreRouter(results: RouterResult[], model: string) {
  const escalated = (r: RouterResult) => r.escalation !== null;
  const should = results.filter((r) => r.expectEscalate);
  const shouldNot = results.filter((r) => !r.expectEscalate);
  const caught = should.filter(escalated);
  const usage = results.reduce<Usage>((total, r) => addUsage(total, r.usage), zeroUsage());
  const latencies = results.map((r) => r.latencyMs);
  return {
    escalate: {
      all: share(results.filter((r) => escalated(r) === r.expectEscalate).length, results.length),
      should: share(caught.length, should.length),
      shouldNot: share(shouldNot.filter((r) => !escalated(r)).length, shouldNot.length),
    },
    category: share(caught.filter((r) => r.escalation?.category === r.expectCategory).length, caught.length),
    falsePositives: shouldNot.filter(escalated).map((r) => ({ id: r.id, ...r.escalation! })),
    falseNegatives: should.filter((r) => !escalated(r)).map((r) => ({ id: r.id, intent: r.intent ?? `router failed: ${r.error}` })),
    wrongCategory: caught
      .filter((r) => r.escalation?.category !== r.expectCategory)
      .map((r) => ({ id: r.id, expected: r.expectCategory, ...r.escalation! })),
    routerFailures: results.filter((r) => r.error !== null).map((r) => ({ id: r.id, error: r.error })),
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    usage,
    cost: cost(model, usage),
  };
}

const pct = (r: { hits: number; total: number; rate: number | null }) =>
  r.rate === null ? "n/a" : `${(r.rate * 100).toFixed(1)}% (${r.hits}/${r.total})`;

async function main() {
  const { values } = parseArgs({
    options: { repeat: { type: "string", default: "1" }, concurrency: { type: "string", default: "4" } },
  });
  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) fail("--repeat must be a positive integer");
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) fail("--concurrency must be a positive integer");
  if (!process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY is not set");

  const cases = [
    ...load("./cases.json").map((c) => ({ ...c, set: "cases" as const })),
    ...load("./packet-samples.json").map((c) => ({ ...c, set: "samples" as const })),
  ];
  const waits = { observed429s: 0 };
  const settings = {
    // Same defaults as the CLI's restructured mode.
    model: process.env.ROUTER_MODEL ?? "gpt-6-luna",
    effort: process.env.ROUTER_EFFORT ?? "none",
    concurrency,
  };
  // As in src/cli.ts: the SDK's own retries only, so a 429 left after them is a router failure, as in production.
  // The fetch wrapper only counts 429s.
  const client = new OpenAI({ maxRetries: 8, fetch: counting429(fetch, waits) });
  const started = new Date();
  const runs = [];
  for (let k = 1; k <= repeat; k++) {
    console.error(`router run ${k}/${repeat}: ${cases.length} messages, ${settings.model} (${settings.effort})`);
    const results = await routeCases(cases, { client, ...settings });
    runs.push({ score: scoreRouter(results, settings.model), results });
  }

  let sha: string | null = null;
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Not a git checkout; the results just carry no sha.
  }
  const stamp = started.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const dir = new URL("./results/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const rateLimits = { observed429s: waits.observed429s };
  const out = writeResults(
    dir,
    `router-${stamp}`,
    `${JSON.stringify({ sha, startedAt: started.toISOString(), repeat, settings, rateLimits, runs }, null, 2)}\n`,
  );

  const money = (value: number | null) => (value === null ? "n/a" : `$${value.toFixed(4)}`);
  const lines = [
    `## Router eval: ${settings.model} (${settings.effort}), ${cases.length} messages x ${repeat}, sha ${sha?.slice(0, 7) ?? "n/a"}`,
    "",
    "| Run | Escalate all | Should | Shouldn't | Category (correct escalations) | FP | FN | Router failures | p50 / p95 ms | Cost |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...runs.map(({ score: s }, i) =>
      `| ${i + 1} | ${pct(s.escalate.all)} | ${pct(s.escalate.should)} | ${pct(s.escalate.shouldNot)} | ${pct(s.category)} | ` +
      `${s.falsePositives.length} | ${s.falseNegatives.length} | ${s.routerFailures.length} | ${s.latencyMs.p50} / ${s.latencyMs.p95} | ${money(s.cost)} |`,
    ),
    "",
    ...runs.flatMap(({ score: s }, i) => [
      ...s.falsePositives.map((f) => `- run ${i + 1} FP ${f.id}: ${f.category}, "${f.reason}"`),
      ...s.falseNegatives.map((f) => `- run ${i + 1} FN ${f.id}: intent "${f.intent}"`),
      ...s.wrongCategory.map((f) => `- run ${i + 1} category ${f.id}: ${f.category}, expected ${f.expected} ("${f.reason}")`),
      ...s.routerFailures.map((f) => `- run ${i + 1} router failure ${f.id}: ${f.error}`),
    ]),
    "",
    `Rate limits: ${rateLimits.observed429s} 429 responses seen.`,
    `Results: ${out.pathname}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const fatal = nonRetryableApiError(error);
    console.error(fatal ? apiErrorMessage(fatal) : error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
