import { readFileSync } from "node:fs";
import * as constants from "./data.ts";
import { fill, userMessage } from "./prompt.ts";

// The original prompt (packet L764-1554) filled per Flow L31. Filled once at load: a missing constant fails
// the run before any message is sent.
export const BASELINE_SYSTEM = fill(
  readFileSync(new URL("../baseline/system-prompt.md", import.meta.url), "utf8"),
  constants,
);

/** The control: original system prompt, packet user message. */
export const baselineMessages = (text: string) => ({ system: BASELINE_SYSTEM, user: userMessage(text) });
