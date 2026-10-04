import { RECENT_CONVERSATION_SUMMARY } from "./data.ts";

// Text the system prompt itself tells the model to substitute ("replace {{clinic.slug}} with the slug"),
// so it is instruction, not a placeholder for us to fill.
const LITERAL = new Set(["clinic.slug"]);

/**
 * Packet Flow (L31): replace every `{{NAME}}` with the value of the same name. Strings go in as-is, anything
 * else as JSON. A name with no value throws, so nothing ships unfilled. Inserted values are never re-scanned.
 */
export function fill(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{\{([^{}]*)\}\}/g, (match, name: string) => {
    if (LITERAL.has(name)) return match;
    if (!Object.hasOwn(values, name) || values[name] === undefined) {
      throw new Error(`no value for placeholder {{${name}}}`);
    }
    const value = values[name];
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

// Packet "User message" (L678-685), verbatim.
const USER_TEMPLATE = `Incoming thread message:
"{{HUMAN_MESSAGE}}"
Incoming image count: 0
Chat kind: DIRECT
Triggering sender: Jordan Hale

Recent conversation summary:
{{RECENT_CONVERSATION_SUMMARY}}`;

/** The user message for one incoming patient text. */
export const userMessage = (text: string): string =>
  fill(USER_TEMPLATE, { HUMAN_MESSAGE: text, RECENT_CONVERSATION_SUMMARY });
