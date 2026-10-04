import type { ReasoningEffort } from "openai/resources/shared";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import { REPLY_SCHEMA, findUrls, postProcess, type Reply } from "./reply.ts";
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
  toolCalls: { name: string; arguments: string }[];
  apiCalls: number;
  usage: Usage;
}

/** What a turn did before it failed, so the failure's trace still shows its tools, calls and tokens (SPEC step 7). */
export class TurnError extends Error {
  readonly progress: Omit<Turn, "reply">;
  constructor(cause: unknown, progress: Omit<Turn, "reply">) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.progress = progress;
  }
}

// A reply needs a handful of lookups; more rounds than this means the model is looping.
const MAX_ROUNDS = 8;

const addUsage = (total: Usage, usage: ResponseUsage | undefined): void => {
  total.input += usage?.input_tokens ?? 0;
  total.cached += usage?.input_tokens_details?.cached_tokens ?? 0;
  total.cacheWrite += usage?.input_tokens_details?.cache_write_tokens ?? 0;
  total.output += usage?.output_tokens ?? 0;
  total.reasoning += usage?.output_tokens_details?.reasoning_tokens ?? 0;
};

/**
 * One patient message through the Responses API: call tools until the model answers, then parse its
 * strict-schema `Reply` and post-process it. Stable content (tools, schema, system prompt) comes first so
 * the batch shares a cached prefix. Any failure is rethrown as a `TurnError` carrying the work done so far.
 */
export async function respond(options: {
  client: Client;
  model: string;
  effort: string;
  system: string;
  user: string;
  tools: Tool[];
}): Promise<Turn> {
  const { client, model, effort, system, user, tools } = options;
  // Developer role: the caching guide puts an implicit breakpoint after the first developer message group.
  const input: ResponseInputItem[] = [
    { role: "developer", content: system },
    { role: "user", content: user },
  ];
  const toolUrls = new Set<string>();
  const progress: Omit<Turn, "reply"> = {
    toolCalls: [],
    apiCalls: 0,
    usage: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  };
  const definitions = tools.map(({ name, description, parameters }) => ({
    type: "function" as const,
    name,
    description,
    parameters: { ...parameters },
    strict: true,
  }));

  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const response = await client.responses.create({
        model,
        reasoning: { effort: effort as ReasoningEffort },
        tools: definitions,
        text: { format: { type: "json_schema", name: "Reply", schema: { ...REPLY_SCHEMA }, strict: true } },
        input,
      });
      progress.apiCalls++;
      addUsage(progress.usage, response.usage);

      const calls = response.output.filter((item) => item.type === "function_call");
      if (calls.length === 0) {
        if (response.status !== "completed") throw new Error(`response ${response.status}`);
        const reply = postProcess(JSON.parse(response.output_text), toolUrls);
        return { reply, ...progress };
      }

      input.push(...toResponseInputItems(response.output));
      for (const call of calls) {
        const output = runTool(call.name, call.arguments);
        for (const url of findUrls(output)) toolUrls.add(url);
        progress.toolCalls.push({ name: call.name, arguments: call.arguments });
        input.push({ type: "function_call_output", call_id: call.call_id, output });
      }
    }
    throw new Error(`no reply after ${MAX_ROUNDS} tool rounds`);
  } catch (error) {
    throw new TurnError(error, progress);
  }
}
