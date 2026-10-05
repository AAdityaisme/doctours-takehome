import OpenAI, { type APIError } from "openai";

/** These errors need a configuration change, so retrying another patient cannot help. */
export function nonRetryableApiError(error: unknown): APIError | null {
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError ||
      error instanceof OpenAI.NotFoundError || error instanceof OpenAI.BadRequestError) return error;
  return null;
}
