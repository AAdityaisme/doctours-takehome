import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import type { Client } from "../src/respond.ts";

export const usage = {
  input_tokens: 100,
  input_tokens_details: { cached_tokens: 60, cache_write_tokens: 0 },
  output_tokens: 20,
  output_tokens_details: { reasoning_tokens: 5 },
  total_tokens: 120,
};

export const final = (fields: object) => {
  const reply = {
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
  };
  const text = JSON.stringify(reply);
  return {
    status: "completed",
    output: [
      { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
    ],
    output_text: text,
    usage,
  } as unknown as Response;
};

export const toolCall = (name: string, args: object, callId: string) =>
  ({
    status: "completed",
    output: [{ type: "function_call", id: `fc_${callId}`, call_id: callId, name, arguments: JSON.stringify(args), status: "completed" }],
    output_text: "",
    usage,
  }) as unknown as Response;

export const fake = (create: (body: ResponseCreateParamsNonStreaming) => Promise<Response>): Client => ({
  responses: { create },
});

