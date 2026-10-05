import OpenAI, { type APIError } from "openai";

/** Request content can fail independently of the next patient's message. */
export const MESSAGE_ERROR_CODES = new Set([
  "context_length_exceeded", "invalid_prompt", "string_above_max_length", "content_policy_violation",
]);

export function messageApiError(error: unknown): APIError | null {
  return error instanceof OpenAI.BadRequestError && MESSAGE_ERROR_CODES.has(error.code ?? "") ? error : null;
}

/** Setup and billing failures cannot be recovered by processing another patient. */
export function nonRetryableApiError(error: unknown): APIError | null {
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError ||
      error instanceof OpenAI.NotFoundError ||
      (error instanceof OpenAI.BadRequestError && !messageApiError(error)) ||
      (error instanceof OpenAI.APIError && error.code === "insufficient_quota")) return error;
  return null;
}

/** One diagnostic format for the batch command and both eval commands. */
export function apiErrorMessage(error: APIError): string {
  const message = error.message.replace(/\s+/g, " ").replace(new RegExp(`^${error.status}\\s+`), "");
  return `OpenAI ${error.status}: ${message} — check OPENAI_API_KEY, billing and ROUTER_MODEL / REPLY_MODEL / GRADER_MODEL access and parameters`;
}
