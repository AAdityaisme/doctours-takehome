import type { ReasoningEffort } from "openai/resources/shared";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import type { SkillLoader } from "./prompts.ts";
import { REPLY_SCHEMA, findUrls, postProcess, schemaError, type Reply, type Schema } from "./reply.ts";
import { runTool, type Tool } from "./tools.ts";

/** The one OpenAI method this system uses. The real `OpenAI` client fits; tests pass a fake. */
export interface Client {
  responses: { create(body: ResponseCreateParamsNonStreaming): Promise<Response> };
}

export interface Usage {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
}

export interface Turn {
  reply: Reply;
  /** Every call the model returned; `rejected` marks one outside what its request allowed, which did not run. */
  toolCalls: { name: string; arguments: string; rejected?: true }[];
  apiCalls: number;
  usage: Usage;
}

/** What a turn did before it failed, so the failure's trace still shows its tools, calls and tokens (SPEC step 7). */
export class TurnError extends Error {
  readonly progress: Omit<Turn, "reply">;
  /** Extra trace fields from the caller (restructured mode: router output, skills). */
  readonly details: Record<string, unknown>;
  constructor(cause: unknown, progress: Omit<Turn, "reply">, details: Record<string, unknown> = {}) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.progress = progress;
    this.details = details;
  }
}

// A reply needs a handful of lookups; more rounds than this means the model is looping.
const MAX_ROUNDS = 8;

export const emptyUsage = (): Usage => ({ input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 });

export const sumUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  cached: a.cached + b.cached,
  cacheWrite: a.cacheWrite + b.cacheWrite,
  output: a.output + b.output,
  reasoning: a.reasoning + b.reasoning,
});

export const addUsage = (total: Usage, usage: ResponseUsage | undefined): void => {
  total.input += usage?.input_tokens ?? 0;
  total.cached += usage?.input_tokens_details?.cached_tokens ?? 0;
  total.cacheWrite += usage?.input_tokens_details?.cache_write_tokens ?? 0;
  total.output += usage?.output_tokens ?? 0;
  total.reasoning += usage?.output_tokens_details?.reasoning_tokens ?? 0;
};

/** The parsed text when it is a schema-valid Reply with `escalate: true`; anything else (empty, not JSON, invalid) is null. */
const asEscalation = (text: string): unknown => {
  try {
    const raw: unknown = JSON.parse(text);
    return schemaError(REPLY_SCHEMA, raw) === null && (raw as Reply).escalate ? raw : null;
  } catch {
    return null;
  }
};

/**
 * The first message item, checked one by one (not `output_text`, which concatenates them all), that is an
 * escalated Reply; null when none is.
 */
const escalatedMessage = (response: Response): unknown => {
  for (const item of response.output) {
    if (item.type !== "message") continue;
    const text = item.content.map((part) => (part.type === "output_text" ? part.text : "")).join("");
    const escalation = asEscalation(text);
    if (escalation) return escalation;
  }
  return null;
};

/**
 * One patient message through the Responses API: call tools until the model answers, then parse its
 * strict-schema `Reply` and post-process it. Stable content (tools, schema, system prompt) comes first so
 * the batch shares a cached prefix. Any failure is rethrown as a `TurnError` carrying the work done so far.
 * Restructured mode passes its developer messages as items, a fixed `tools` list with the per-message `allowed` names
 * (`tool_choice: allowed_tools`, so the tools prefix stays cache-stable) and a `cacheKey`. Its `loader` is an extra
 * tool whose output is instructions: the tools it returns are allowed from the next round on, and its text never
 * counts as tool-returned URLs.
 */
export async function respond(options: {
  client: Client;
  model: string;
  effort: string;
  /** The baseline's one prompt string, or restructured mode's developer messages. */
  system: string | ResponseInputItem[];
  user: string;
  tools: Tool[];
  /** Names this message may call; unset = every tool in `tools`. */
  allowed?: string[];
  cacheKey?: string;
  schema?: Schema;
  loader?: SkillLoader | null;
}): Promise<Turn> {
  const { client, model, effort, system, user, loader, cacheKey, schema = REPLY_SCHEMA } = options;
  const tools = [...options.tools];
  const allowed = options.allowed && [...options.allowed];
  // Developer role: the caching guide puts an implicit breakpoint after the first developer message group.
  const input: ResponseInputItem[] = [
    ...(typeof system === "string" ? [{ role: "developer" as const, content: system }] : system),
    { role: "user", content: user },
  ];
  const toolUrls = new Set<string>();
  const progress: Omit<Turn, "reply"> = {
    toolCalls: [],
    apiCalls: 0,
    usage: emptyUsage(),
  };
  const definitions = () =>
    [...tools, ...(loader ? [loader.tool] : [])].map(({ name, description, parameters }) => ({
      type: "function" as const,
      name,
      description,
      parameters: { ...parameters },
      strict: true,
    }));

  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      // What this request lets the model call, fixed now: tools a loadSkill adds below join the next request only.
      const callable = new Set([
        ...tools.map((tool) => tool.name).filter((name) => !allowed || allowed.includes(name)),
        ...(loader ? [loader.tool.name] : []),
      ]);
      const response = await client.responses.create({
        model,
        reasoning: { effort: effort as ReasoningEffort },
        tools: definitions(),
        ...(allowed && {
          tool_choice: {
            type: "allowed_tools" as const,
            mode: "auto" as const,
            tools: [...allowed, ...(loader ? [loader.tool.name] : [])].map((name) => ({ type: "function", name })),
          },
        }),
        ...(cacheKey && { prompt_cache_key: cacheKey }),
        text: { format: { type: "json_schema", name: "Reply", schema: { ...schema }, strict: true } },
        input,
      });
      progress.apiCalls++;
      addUsage(progress.usage, response.usage);
      // Nothing is read from a response that didn't complete; the turn fails safe with its usage kept.
      if (response.status !== "completed") throw new Error(`response ${response.status}`);

      const calls = response.output.filter((item) => item.type === "function_call");
      // A message that already escalates stops the turn here, before any co-returned tool runs (L7: stop at the handoff).
      const escalation = calls.length > 0 ? escalatedMessage(response) : null;
      if (escalation) return { reply: postProcess(escalation, toolUrls), ...progress };
      if (calls.length === 0) {
        const reply = postProcess(JSON.parse(response.output_text), toolUrls);
        return { reply, ...progress };
      }

      input.push(...toResponseInputItems(response.output));
      for (const call of calls) {
        let output: string;
        if (!callable.has(call.name)) {
          // Never trust the API's allowed_tools alone: an out-of-list call doesn't run and its output is no URL source.
          output = JSON.stringify({ error: "tool not available for this message" });
          progress.toolCalls.push({ name: call.name, arguments: call.arguments, rejected: true });
          input.push({ type: "function_call_output", call_id: call.call_id, output });
          continue;
        }
        if (loader && call.name === loader.tool.name) {
          const loaded = loader.load(call.arguments);
          output = loaded.output;
          for (const tool of loaded.tools) {
            if (allowed) {
              if (!allowed.includes(tool.name)) allowed.push(tool.name);
            } else if (!tools.some((t) => t.name === tool.name)) tools.push(tool);
          }
        } else {
          output = runTool(call.name, call.arguments);
          for (const url of findUrls(output)) toolUrls.add(url);
        }
        progress.toolCalls.push({ name: call.name, arguments: call.arguments });
        input.push({ type: "function_call_output", call_id: call.call_id, output });
      }
    }
    throw new Error(`no reply after ${MAX_ROUNDS} tool rounds`);
  } catch (error) {
    throw new TurnError(error, progress);
  }
}
