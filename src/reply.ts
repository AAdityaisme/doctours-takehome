import { toEscalation } from "./escalation.ts";

// Packet "Output" (L38-79), verbatim except `export`.
export interface Reply {
  response: string;
  escalate: boolean;
  escalationReason: string | null;
  templateId: string | null;
  intent: string;
  shouldFollowUp: boolean;
  followUpTiming: string | null;
  attachmentUrls: string[] | null;
  highEngagement: boolean;
  workingMemoryUpdates: WorkingMemoryUpdates | null;
}

export interface WorkingMemoryUpdates {
  collectionState?: {
    areaAskCount?: number | null;
    lastAskedItem?: "area" | "name" | "photos" | "none" | null;
    nameAskCount?: number | null;
    photoAskCount?: number | null;
  } | null;
  communicationStyle?: "detailed" | "concise" | "casual" | "formal" | "unknown" | null;
  escalationFlags?: string | null;
  keyConcerns?: string | null;
  patientName?: string | null;
  preferredPaymentMethod?:
    | "financing"
    | "layaway"
    | "pay_in_full"
    | "cash_preference"
    | "unknown"
    | null;
  procedureArea?: string | null;
  promisesMade?: string | null;
  targetProcedureWindow?:
    | "within_3_months"
    | "within_6_months"
    | "within_8_months"
    | "within_12_months"
    | "over_12_months"
    | "unknown"
    | null;
}

/** The subset of JSON Schema used here, which is also what OpenAI strict mode accepts. */
export interface Schema {
  type?: string | string[];
  enum?: unknown[];
  anyOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: Schema;
  description?: string;
}

const text: Schema = { type: ["string", "null"] };
const count: Schema = { type: ["integer", "null"] };
const choice = (...values: string[]): Schema => ({ type: ["string", "null"], enum: [...values, null] });
export const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
/** OpenAI strict mode: every key required (optional ones are nullable), no extra keys. */
export const strictObject = (properties: Record<string, Schema>): Schema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** `WorkingMemoryUpdates` as a strict JSON Schema; also the input of `updateWorkingMemoryTool`. */
export const WORKING_MEMORY_SCHEMA: Schema = strictObject({
  collectionState: nullable(
    strictObject({
      areaAskCount: count,
      lastAskedItem: choice("area", "name", "photos", "none"),
      nameAskCount: count,
      photoAskCount: count,
    }),
  ),
  communicationStyle: choice("detailed", "concise", "casual", "formal", "unknown"),
  escalationFlags: text,
  keyConcerns: text,
  patientName: text,
  preferredPaymentMethod: choice("financing", "layaway", "pay_in_full", "cash_preference", "unknown"),
  procedureArea: text,
  promisesMade: text,
  targetProcedureWindow: choice(
    "within_3_months",
    "within_6_months",
    "within_8_months",
    "within_12_months",
    "over_12_months",
    "unknown",
  ),
});

/** `Reply` as a strict JSON Schema, sent as `text.format` and used to validate the final output. */
export const REPLY_SCHEMA: Schema = strictObject({
  response: { type: "string" },
  escalate: { type: "boolean" },
  escalationReason: text,
  templateId: text,
  intent: { type: "string" },
  shouldFollowUp: { type: "boolean" },
  followUpTiming: text,
  attachmentUrls: nullable({ type: "array", items: { type: "string" } }),
  highEngagement: { type: "boolean" },
  workingMemoryUpdates: nullable(WORKING_MEMORY_SCHEMA),
});

const isType = (type: string, value: unknown): boolean => {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return typeof value === type;
};

/** Returns the first schema violation as a message, or null when `value` matches. */
export function schemaError(schema: Schema, value: unknown, path = "$"): string | null {
  if (schema.anyOf) {
    return schema.anyOf.some((branch) => schemaError(branch, value, path) === null) ? null : `${path}: no type matches`;
  }
  const types = [schema.type ?? []].flat();
  if (!types.some((type) => isType(type, value))) return `${path}: expected ${types.join(" | ")}`;
  if (schema.enum && !schema.enum.includes(value)) return `${path}: ${JSON.stringify(value)} is not allowed`;
  if (Array.isArray(value) && schema.items) {
    for (const [i, item] of value.entries()) {
      const error = schemaError(schema.items, item, `${path}[${i}]`);
      if (error) return error;
    }
  }
  if (schema.properties && isType("object", value)) {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in record)) return `${path}.${key}: missing`;
    for (const [key, item] of Object.entries(record)) {
      const property = schema.properties[key];
      if (!property) return `${path}.${key}: not in schema`;
      const error = schemaError(property, item, `${path}.${key}`);
      if (error) return error;
    }
  }
  return null;
}

function assertReply(value: unknown): asserts value is Reply {
  const error = schemaError(REPLY_SCHEMA, value);
  if (error) throw new Error(`Reply schema: ${error}`);
}

// Scheme matched case-insensitively (HTTPS:// is valid). Stops before whitespace, quotes and brackets; never ends
// on sentence punctuation. Bare domains ("hims.com") are sentence text, not links, and are left alone.
const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]{}]*[^\s<>"'()[\]{}.,;:!?]/gi;

/** Every http(s) URL in `text`, in order of first appearance, without duplicates. */
export const findUrls = (text: string): string[] => [...new Set(text.match(URL_PATTERN) ?? [])];

/**
 * Packet L83: if the response includes a URL, that URL is the last line. Every URL is lifted out of the body and
 * appended, one per line, so no link is left mid-message. Already-compliant text comes back unchanged.
 */
export function urlLast(response: string): string {
  const trimmed = response.trimEnd();
  const urls = findUrls(trimmed);
  if (urls.length === 0) return trimmed;
  // ponytail: lifting a URL out of a sentence can leave "here: and" behind; the prompt asks for URL-last, so this is the fallback.
  const body = trimmed
    .split("\n")
    .flatMap((line) => {
      const stripped = line.replace(URL_PATTERN, "");
      if (stripped === line) return [line];
      const tidied = stripped.replace(/[ \t]{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
      return tidied ? [tidied] : [];
    })
    .join("\n")
    .trimEnd();
  return [body, ...urls].filter(Boolean).join("\n");
}

/**
 * The output rules a prompt can't guarantee (SPEC step 5): templateId null, attachmentUrls limited to URLs a tool
 * returned this turn (max 3), URL on the last line, escalation reason only when escalating, escalation handed to code,
 * then a schema check on the result.
 */
export function postProcess(raw: unknown, toolUrls: ReadonlySet<string>): Reply {
  assertReply(raw);
  if (raw.escalate) {
    // The model's own reason is free text and could echo what the patient sent (a card number), so code sets it.
    const escalated = toEscalation("reply");
    assertReply(escalated);
    return escalated;
  }
  const attachments = [...new Set(raw.attachmentUrls ?? [])].filter((url) => toolUrls.has(url)).slice(0, 3);
  const reply: Reply = {
    ...raw,
    response: urlLast(raw.response),
    escalationReason: null,
    templateId: null,
    attachmentUrls: attachments.length > 0 ? attachments : null,
  };
  assertReply(reply);
  return reply;
}
