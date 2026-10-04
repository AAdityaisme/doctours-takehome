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

/**
 * SPEC step 1: one strict-JSON call that names the intent, the skills this message needs and whether a person
 * must take over. No tools. Usage and latency come back for the trace.
 */
export async function route(
  client: Client,
  text: string,
  options: { model: string; effort: string },
): Promise<{ route: Route; usage: Usage; latencyMs: number }> {
  const started = performance.now();
  const response = await client.responses.create({
    model: options.model,
    reasoning: { effort: options.effort as ReasoningEffort },
    text: { format: { type: "json_schema", name: "Route", schema: { ...ROUTE_SCHEMA }, strict: true } },
    input: [
      { role: "developer", content: ROUTER_SYSTEM },
      { role: "user", content: userMessage(text) },
    ],
  });
  const usage = emptyUsage();
  addUsage(usage, response.usage);
  if (response.status !== "completed") throw new Error(`router response ${response.status}`);
  const raw: unknown = JSON.parse(response.output_text);
  const error = schemaError(ROUTE_SHAPE, raw);
  if (error) throw new Error(`router schema: ${error}`);
  return { route: raw as Route, usage, latencyMs: Math.round(performance.now() - started) };
}
