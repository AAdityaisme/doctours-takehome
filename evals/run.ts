import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import OpenAI from "openai";
import { MODES, replyAll, type Mode } from "../src/cli.ts";
import type { Reply } from "../src/reply.ts";
import type { Client, Usage } from "../src/respond.ts";
import {
  addUsage,
  claimsOf,
  subtractUsage,
  traceFailure,
  cost,
  gradeClaims,
  isLiteral,
  markdown,
  percentile,
  scoreTrial,
  summarize,
  zeroUsage,
  type Case,
  type CaseResult,
  type Trace,
  type Verdicts,
} from "./score.ts";

const load = (name: string): Case[] => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));

/** Runs `task` over `items`, `limit` at a time, keeping input order. */
async function pool<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The harness's client: 429s (tokens per minute) that outlast the SDK's own retries are retried here with growing
 * waits, so a saturated minute delays a message instead of failing it into a system-error escalation. The waits are
 * counted because they land inside the measured latency. Quota errors still throw.
 */
function patientClient(openai: OpenAI, waits: { count: number; ms: number }): Client {
  return {
    responses: {
      create: async (body) => {
        for (let attempt = 1; ; attempt++) {
          try {
            return await openai.responses.create(body);
          } catch (error) {
            if (!(error instanceof OpenAI.RateLimitError) || error.code === "insufficient_quota" || attempt > 20) throw error;
            const ms = Math.min(5_000 * attempt, 30_000);
            waits.count++;
            waits.ms += ms;
            await new Promise((resolve) => setTimeout(resolve, ms));
          }
        }
      },
    },
  };
}

interface Settings {
  client: Client;
  concurrency: number;
  mode: Mode;
  model: string;
  effort: string;
  /** Router model and effort, used by restructured mode (same defaults as the CLI). */
  router: { model: string; effort: string };
  grader: { model: string; effort: string };
}

/** One run of every case through the system, then one grader call per case that has model claims. */
async function runOnce(cases: Case[], settings: Settings) {
  const traces = new Map<number, Trace>();
  const replies: Reply[] = await replyAll(
    cases.map(({ id, text }) => ({ id, text })),
    { ...settings, trace: (record) => traces.set(record.index as number, record) },
  );
  let graderUsage = zeroUsage();
  let graderErrors = 0;
  const verdicts = await pool(cases, settings.concurrency * 2, async (c, i): Promise<Verdicts> => {
    const claims = claimsOf(c).filter((claim) => !isLiteral(claim.claim));
    // A failed reply is an errored trial whatever the grader says, so don't pay for the call.
    if (claims.length === 0 || traceFailure(traces.get(i) ?? null)) return [];
    try {
      const graded = await gradeClaims(settings.client, settings.grader, c.text, replies[i], claims);
      graderUsage = addUsage(graderUsage, graded.usage);
      if (graded.error) {
        graderErrors++;
        console.error(`grader output unusable on ${c.id}: ${graded.error}`);
      }
      return graded.verdicts;
    } catch (error) {
      graderErrors++;
      console.error(`grader failed on ${c.id}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });
  const trials = cases.map((c, i) => scoreTrial(c, replies[i], traces.get(i) ?? null, verdicts[i]));
  return { trials, traces: [...traces.values()], graderUsage, graderErrors };
}

/**
 * Writes `body` to `<base>.json` in `dir`, or `<base>-2.json`, `-3`... if that name exists. The exclusive flag makes
 * the check and the write one step, so a run started in the same minute can never overwrite another run's results.
 */
export function writeResults(dir: URL, base: string, body: string): URL {
  let collision: unknown;
  for (let n = 1; n <= 99; n++) {
    const url = new URL(`${base}${n === 1 ? "" : `-${n}`}.json`, dir);
    try {
      writeFileSync(url, body, { flag: "wx" });
      return url;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      collision = error;
    }
  }
  throw collision; // 99 names taken: refuse rather than overwrite.
}

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const money = (value: number | null) => (value === null ? "n/a" : `$${value.toFixed(2)}`);

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      mode: { type: "string", default: MODES[0] },
      cases: { type: "string" },
      repeat: { type: "string", default: "1" },
      concurrency: { type: "string", default: "2" },
    },
  });
  const mode = values.mode as Mode;
  if (!MODES.includes(mode)) fail(`unknown --mode ${values.mode}; expected one of: ${MODES.join(", ")}`);
  const repeat = Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1) fail("--repeat must be a positive integer");
  const concurrency = Number(values.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) fail("--concurrency must be a positive integer");
  if (!process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY is not set");

  const sets = { cases: load("./cases.json"), samples: load("./packet-samples.json") };
  const wanted = values.cases?.split(",").map((id) => id.trim());
  if (wanted) {
    const known = new Set([...sets.cases, ...sets.samples].map((c) => c.id));
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length > 0) fail(`unknown case ids: ${unknown.join(", ")}`);
    sets.cases = sets.cases.filter((c) => wanted.includes(c.id));
    sets.samples = sets.samples.filter((c) => wanted.includes(c.id));
  }
  // Both sets go through one batch per run so they share the cached prompt prefix; they are scored apart.
  const all = [...sets.cases, ...sets.samples];

  const waits = { count: 0, ms: 0 };
  const settings: Settings = {
    // The baseline prompt is ~40k tokens a call: even one message in flight can pass a 500k tokens-per-minute limit.
    client: patientClient(new OpenAI({ maxRetries: 8 }), waits),
    concurrency,
    mode,
    model: process.env.REPLY_MODEL ?? "gpt-6.1-sol",
    effort: process.env.REPLY_EFFORT ?? "low",
    router: { model: process.env.ROUTER_MODEL ?? "gpt-6-luna", effort: process.env.ROUTER_EFFORT ?? "none" },
    grader: { model: process.env.GRADER_MODEL ?? "gpt-6.1-sol", effort: process.env.GRADER_EFFORT ?? "low" },
  };
  const started = new Date();
  const runs: Awaited<ReturnType<typeof runOnce>>[] = [];
  for (let k = 1; k <= repeat; k++) {
    console.error(`run ${k}/${repeat}: ${all.length} messages, mode ${mode}`);
    runs.push(await runOnce(all, settings));
  }

  const resultsFor = (set: Case[]): CaseResult[] =>
    set.map((c) => {
      const index = all.indexOf(c);
      return { id: c.id, topic: c.topic, expectEscalate: c.expect.escalate, trials: runs.map((run) => run.trials[index]) };
    });
  const caseResults = resultsFor(sets.cases);
  const sampleResults = resultsFor(sets.samples);

  const traces = runs.flatMap((run) => run.traces);
  // A restructured trace's tokens include its router call; router.tokens holds that share, priced at the router model.
  const routerUsage = traces.reduce<Usage>(
    (total, t) => addUsage(total, (t.router as { tokens?: Partial<Usage> } | undefined)?.tokens),
    zeroUsage(),
  );
  const replyUsage = subtractUsage(
    traces.reduce<Usage>((total, t) => addUsage(total, t.tokens as Partial<Usage>), zeroUsage()),
    routerUsage,
  );
  const graderUsage = runs.reduce<Usage>((total, run) => addUsage(total, run.graderUsage), zeroUsage());
  const latencies = traces.map((t) => t.latencyMs).filter((ms): ms is number => typeof ms === "number");
  const usage = {
    reply: { model: settings.model, tokens: replyUsage, cost: cost(settings.model, replyUsage) },
    router: { model: settings.router.model, tokens: routerUsage, cost: cost(settings.router.model, routerUsage) },
    grader: { model: settings.grader.model, tokens: graderUsage, cost: cost(settings.grader.model, graderUsage) },
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    failedMessages: traces.filter((t) => traceFailure(t)).length,
    graderErrors: runs.reduce((n, run) => n + run.graderErrors, 0),
    rateLimitWaits: { count: waits.count, seconds: Math.round(waits.ms / 1000) },
  };

  let sha: string | null = null;
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    // Not a git checkout (e.g. a downloaded archive); the results just carry no sha.
  }
  const summary = { cases: summarize(caseResults), packetSamples: summarize(sampleResults) };
  const stamp = started.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  const results = new URL("./results/", import.meta.url);
  mkdirSync(results, { recursive: true });
  const out = writeResults(
    results,
    `${mode}-${stamp}`,
    `${JSON.stringify(
      { mode, sha, startedAt: started.toISOString(), repeat, settings: { ...settings, client: undefined }, summary, usage, cases: caseResults, packetSamples: sampleResults },
      null,
      2,
    )}\n`,
  );

  const report = [
    `## Eval: mode \`${mode}\`, ${settings.model} (${settings.effort}), ${repeat} run(s), sha ${sha?.slice(0, 7) ?? "n/a"}`,
    "",
    markdown(`Hand-written cases (${sets.cases.length})`, summary.cases, caseResults, repeat),
    "",
    markdown(`Packet samples (${sets.samples.length}), scored separately`, summary.packetSamples, sampleResults, repeat),
    "",
    "### Cost and latency",
    "",
    "| | Input | Cached | Cache writes | Output | Cost |",
    "|---|---|---|---|---|---|",
    `| Replies (${settings.model}) | ${replyUsage.input} | ${replyUsage.cached} | ${replyUsage.cacheWrite} | ${replyUsage.output} | ${money(usage.reply.cost)} |`,
    ...(routerUsage.input > 0
      ? [`| Router (${settings.router.model}) | ${routerUsage.input} | ${routerUsage.cached} | ${routerUsage.cacheWrite} | ${routerUsage.output} | ${money(usage.router.cost)} |`]
      : []),
    `| Grader (${settings.grader.model}) | ${graderUsage.input} | ${graderUsage.cached} | ${graderUsage.cacheWrite} | ${graderUsage.output} | ${money(usage.grader.cost)} |`,
    "",
    `Latency per message: p50 ${usage.latencyMs.p50 ?? "n/a"} ms, p95 ${usage.latencyMs.p95 ?? "n/a"} ms. ` +
      `Failed messages: ${usage.failedMessages}. Grader errors: ${usage.graderErrors}. ` +
      `Rate-limit waits: ${waits.count} (${usage.rateLimitWaits.seconds} s, inside the latency figures).`,
    "",
    `Results: ${out.pathname}`,
  ];
  process.stdout.write(`${report.join("\n")}\n`);
}
