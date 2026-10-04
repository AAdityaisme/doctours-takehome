import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import OpenAI from "openai";
import { baselineMessages } from "./baseline.ts";
import { toEscalation } from "./escalation.ts";
import type { Reply } from "./reply.ts";
import { respond, type Client } from "./respond.ts";
import { TOOLS } from "./tools.ts";

export const MODES = ["baseline"] as const;
export type Mode = (typeof MODES)[number];

export interface BatchOptions {
  client: Client;
  mode: Mode;
  model: string;
  effort: string;
  /** Receives one trace record per message, as each finishes. */
  trace?: (record: Record<string, unknown>) => void;
  concurrency?: number;
}

async function replyOne(item: unknown, index: number, options: BatchOptions): Promise<Reply> {
  const { client, mode, model, effort } = options;
  const started = performance.now();
  const id = (item as { id?: unknown } | null)?.id ?? null;
  const base = { index, id, mode, model, effort };
  try {
    const text = (item as { text?: unknown } | null)?.text;
    if (typeof text !== "string") throw new Error("message has no text");
    const turn = await respond({ client, model, effort, tools: TOOLS, ...baselineMessages(text) });
    options.trace?.({
      ...base,
      ok: true,
      escalate: turn.reply.escalate,
      toolCalls: turn.toolCalls,
      apiCalls: turn.apiCalls,
      tokens: turn.usage,
      latencyMs: Math.round(performance.now() - started),
    });
    return turn.reply;
  } catch (error) {
    // SPEC step 6: one failed message (after the SDK's own retries) escalates; the batch carries on.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`message ${index} (${String(id)}) failed: ${message}`);
    options.trace?.({ ...base, ok: false, error: message, latencyMs: Math.round(performance.now() - started) });
    return toEscalation("system error");
  }
}

/** Replies to every message, a few at a time. Output order and length always match the input. */
export async function replyAll(items: unknown[], options: BatchOptions): Promise<Reply[]> {
  const replies: Reply[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      replies[index] = await replyOne(items[index], index, options);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, items.length) }, worker));
  return replies;
}

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { mode: { type: "string", default: "baseline" }, trace: { type: "string" } },
  });
  const mode = values.mode as Mode;
  if (!MODES.includes(mode)) fail(`unknown --mode ${values.mode}; expected one of: ${MODES.join(", ")}`);

  const source = positionals[0] && positionals[0] !== "-" ? positionals[0] : 0; // 0 = stdin
  const items: unknown = JSON.parse(readFileSync(source, "utf8"));
  if (!Array.isArray(items)) fail("input must be a JSON array of {id, text}");
  if (!process.env.OPENAI_API_KEY) fail("OPENAI_API_KEY is not set");

  const tracePath = values.trace;
  if (tracePath) writeFileSync(tracePath, "");
  const replies = await replyAll(items as unknown[], {
    client: new OpenAI(),
    mode,
    model: process.env.REPLY_MODEL ?? "gpt-6.1-sol",
    effort: process.env.REPLY_EFFORT ?? "low",
    trace: tracePath ? (record) => appendFileSync(tracePath, `${JSON.stringify(record)}\n`) : undefined,
  });
  process.stdout.write(`${JSON.stringify(replies, null, 2)}\n`);
}
