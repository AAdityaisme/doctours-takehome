import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import OpenAI from "openai";
import { nonRetryableApiError } from "./api-errors.ts";
import { baselineMessages } from "./baseline.ts";
import { toEscalation } from "./escalation.ts";
import type { Reply } from "./reply.ts";
import { restructuredTurn } from "./restructured.ts";
import { TurnError, respond, type Client } from "./respond.ts";
import { TOOLS } from "./tools.ts";

export const MODES = ["restructured", "baseline"] as const;
export type Mode = (typeof MODES)[number];

export interface BatchOptions {
  client: Client;
  mode: Mode;
  model: string;
  effort: string;
  /** Router model and effort; restructured mode only. */
  router?: { model: string; effort: string };
  /** Receives one trace record per message, as each finishes. */
  trace?: (record: Record<string, unknown>) => void;
  concurrency?: number;
}

// One guarded sink per batch: tracing must never replace a completed reply or its handoff.
function safeTrace(sink: BatchOptions["trace"]): BatchOptions["trace"] {
  let reported = false;
  return sink && ((record) => {
    try {
      sink(record);
    } catch (error) {
      if (!reported) {
        reported = true;
        console.error(`trace write failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  });
}

async function replyOne(item: unknown, index: number, options: BatchOptions): Promise<Reply> {
  const { client, mode, model, effort } = options;
  const started = performance.now();
  const id = (item as { id?: unknown } | null)?.id ?? null;
  const base = { index, id, mode, model, effort };
  try {
    const text = (item as { text?: unknown } | null)?.text;
    if (typeof text !== "string") throw new Error("message has no text");
    if (mode === "restructured") {
      if (!options.router) throw new Error("restructured mode needs router options");
      const { reply, totals, trace } = await restructuredTurn(text, { client, model, effort, router: options.router });
      options.trace?.({
        ...base,
        ok: true,
        escalate: reply.escalate,
        ...trace,
        toolCalls: totals.toolCalls,
        apiCalls: totals.apiCalls,
        tokens: totals.usage,
        latencyMs: Math.round(performance.now() - started),
      });
      return reply;
    }
    const turn = await respond({ client, model, effort, tools: TOOLS, ...baselineMessages(text) });
    options.trace?.({
      ...base,
      ok: true,
      escalate: turn.reply.escalate,
      escalationCategory: turn.reply.escalate ? "reply" : null,
      toolCalls: turn.toolCalls,
      apiCalls: turn.apiCalls,
      tokens: turn.usage,
      latencyMs: Math.round(performance.now() - started),
    });
    return turn.reply;
  } catch (error) {
    const fatal = nonRetryableApiError(error instanceof TurnError ? error.cause : error);
    if (fatal) throw fatal;
    // SPEC step 6: one failed message (after the SDK's own retries) escalates; the batch carries on.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`message ${index} (${String(id)}) failed: ${message}`);
    const done = error instanceof TurnError ? error.progress : undefined;
    options.trace?.({
      ...base,
      ok: false,
      error: message,
      ...(error instanceof TurnError && error.details),
      ...(done && { toolCalls: done.toolCalls, apiCalls: done.apiCalls, tokens: done.usage }),
      escalationCategory: "system_error",
      latencyMs: Math.round(performance.now() - started),
    });
    return toEscalation("system_error");
  }
}

// Two in flight keeps a batch under a 500K tokens-per-minute limit: a 429 that outlasts the retries becomes a
// "system error" handoff, which scores as a wrong escalate.
// ponytail: caps messages, not tokens; the SDK's retry-after waits absorb bursts. Add a tokens-per-minute budget if
// 429s ever outlast the 8 retries.
export const DEFAULT_CONCURRENCY = 2;

/** Replies in input order, a few at a time. Configuration errors reject the entire batch. */
export async function replyAll(items: unknown[], options: BatchOptions): Promise<Reply[]> {
  options = { ...options, trace: safeTrace(options.trace) };
  let stopped = false;
  const replies: Reply[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const index = next++;
      try {
        replies[index] = await replyOne(items[index], index, options);
      } catch (error) {
        stopped = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, items.length) }, worker));
  return replies;
}

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { mode: { type: "string", default: "restructured" }, trace: { type: "string" } },
  });
  const mode = values.mode as Mode;
  if (!MODES.includes(mode)) fail(`unknown --mode ${values.mode}; expected one of: ${MODES.join(", ")}`);

  const source = positionals[0] && positionals[0] !== "-" ? positionals[0] : 0; // 0 = stdin
  const items: unknown = JSON.parse(readFileSync(source, "utf8"));
  if (!Array.isArray(items)) fail("input must be a JSON array of {id, text}");
  if (!process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY is not set");
  const concurrency = Number(process.env.CONCURRENCY ?? DEFAULT_CONCURRENCY);
  if (!Number.isInteger(concurrency) || concurrency < 1) fail("CONCURRENCY must be a positive integer");

  const tracePath = values.trace;
  let traceSink: BatchOptions["trace"];
  if (tracePath) {
    try {
      writeFileSync(tracePath, "");
      traceSink = (record) => appendFileSync(tracePath, `${JSON.stringify(record)}\n`);
    } catch (error) {
      console.error(`trace write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    const replies = await replyAll(items as unknown[], {
      // A 429 under a busy org's TPM limit would otherwise fail the message into a handoff. The SDK retries 429s,
      // waiting what retry-after(-ms) asks for (up to 60 s), else exponential backoff from 0.5 s capped at 8 s.
      client: new OpenAI({ maxRetries: 8 }),
      concurrency,
      mode,
      model: process.env.REPLY_MODEL ?? "gpt-6.1-sol",
      effort: process.env.REPLY_EFFORT ?? "low",
      router: { model: process.env.ROUTER_MODEL ?? "gpt-6-luna", effort: process.env.ROUTER_EFFORT ?? "none" },
      trace: traceSink,
    });
    process.stdout.write(`${JSON.stringify(replies, null, 2)}\n`);
  } catch (error) {
    const fatal = nonRetryableApiError(error);
    if (fatal) fail(`OpenAI ${fatal.status}: ${fatal.message.replace(/\s+/g, " ")} — check OPENAI_API_KEY and ROUTER_MODEL / REPLY_MODEL access and parameters`);
    fail(error instanceof Error ? error.message : String(error));
  }
}
