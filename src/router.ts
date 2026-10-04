import type { ReasoningEffort } from "openai/resources/shared";
import { ROUTER_SYSTEM, SKILLS } from "./prompts.ts";
import { userMessage } from "./prompt.ts";
import { nullable, schemaError, strictObject, type Schema } from "./reply.ts";
import { addUsage, emptyUsage, type Client, type Usage } from "./respond.ts";
import type { EscalationCategory } from "./escalation.ts";

export interface Route {
  intent: string;
  skills: string[];
  escalation: { category: EscalationCategory; reason: string } | null;
}

const routeSchema = (skillIds?: string[]): Schema =>
  strictObject({
    intent: { type: "string" },
    skills: { type: "array", items: skillIds ? { type: "string", enum: skillIds } : { type: "string" } },
    escalation: nullable(
      strictObject({
        category: { type: "string", enum: ["human_requested", "cannot_do"] },
        reason: { type: "string" },
      }),
    ),
  });

/** Sent to the API: skill ids constrained to the catalog. */
export const ROUTE_SCHEMA = routeSchema(SKILLS.map((skill) => skill.id));
// Checked locally without the id enum: an unknown id is dropped and traced later, never a failed message.
const ROUTE_SHAPE = routeSchema();

export interface Routed {
  /** Null when the router failed: no response, an incomplete one, bad JSON or a schema miss. */
  route: Route | null;
  error: string | null;
  usage: Usage;
  /** 1 when the API returned a response (billed, even if unusable), else 0. */
  apiCalls: number;
  latencyMs: number;
}

/**
 * SPEC step 1: one strict-JSON call that names the intent, the skills this message needs and whether a person
 * must take over. No tools. Never throws: a failure comes back as `route: null` with its error and any usage the
 * API already billed, so the caller can still reply and trace it.
 */
export async function route(client: Client, text: string, options: { model: string; effort: string }): Promise<Routed> {
  const started = performance.now();
  const usage = emptyUsage();
  let apiCalls = 0;
  const done = (result: Route | null, error: string | null): Routed => ({
    route: result,
    error,
    usage,
    apiCalls,
    latencyMs: Math.round(performance.now() - started),
  });
  try {
    const response = await client.responses.create({
      model: options.model,
      reasoning: { effort: options.effort as ReasoningEffort },
      text: { format: { type: "json_schema", name: "Route", schema: { ...ROUTE_SCHEMA }, strict: true } },
      input: [
        { role: "developer", content: ROUTER_SYSTEM },
        { role: "user", content: userMessage(text) },
      ],
    });
    apiCalls = 1;
    addUsage(usage, response.usage);
    if (response.status !== "completed") return done(null, `router response ${response.status}`);
    const raw: unknown = JSON.parse(response.output_text);
    const error = schemaError(ROUTE_SHAPE, raw);
    if (error) return done(null, `router schema: ${error}`);
    const parsed = raw as Route;
    return done(
      {
        ...parsed,
        intent: redactNumbers(parsed.intent),
        escalation: parsed.escalation && { ...parsed.escalation, reason: redactNumbers(parsed.escalation.reason) },
      },
      null,
    );
  } catch (error) {
    return done(null, error instanceof Error ? error.message : String(error));
  }
}

/**
 * The router's free text reaches Reply.intent and the trace, and could echo a card number, expiry or CVV the patient
 * sent. Any run of 3+ digits (spaces, dashes, slashes, dots or commas between them) becomes "[number]".
 */
export const redactNumbers = (text: string): string => text.replace(/\d(?:[\s,./-]?\d){2,}/g, "[number]");
