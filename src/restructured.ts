import * as constants from "./data.ts";
import { CATEGORY_REASONS, toEscalation } from "./escalation.ts";
import { userMessage } from "./prompt.ts";
import { DESCRIBED_REPLY_SCHEMA, assemble, ruleSkills, skillLoader, type LoadSkillCall } from "./prompts.ts";
import type { Reply } from "./reply.ts";
import { TurnError, respond, type Client, type Turn } from "./respond.ts";
import { route } from "./router.ts";

export interface RestructuredOptions {
  client: Client;
  model: string;
  effort: string;
  router: { model: string; effort: string };
}

/**
 * SPEC steps 1-5 for one message: route; if the router escalates, hand off in code with no reply call; otherwise
 * assemble core + stage + skills, run the reply loop with `loadSkill`, and take the intent from the router.
 * Returns the trace fields this mode adds. A reply-loop failure is rethrown with those fields attached.
 */
export async function restructuredTurn(
  text: string,
  options: RestructuredOptions,
): Promise<{ reply: Reply; turn: Turn | null; trace: Record<string, unknown> }> {
  const { client, model, effort } = options;
  const routed = await route(client, text, options.router);
  const router = { ...options.router, ...routed.route, tokens: routed.usage, latencyMs: routed.latencyMs };
  if (routed.route.escalation) {
    const reply = toEscalation(CATEGORY_REASONS[routed.route.escalation.category]);
    return { reply, turn: null, trace: { router, escalatedBy: "router", skillsLoaded: [], loadSkillCalls: [] } };
  }

  const assembly = assemble(routed.route.skills);
  const loadSkillCalls: LoadSkillCall[] = [];
  const trace = {
    router,
    skillsLoaded: assembly.skills,
    ruleSkills: ruleSkills(constants),
    unknownSkills: assembly.unknownSkills,
    toolsOffered: assembly.tools.map((tool) => tool.name),
    loadSkillCalls,
  };
  try {
    const turn = await respond({
      client,
      model,
      effort,
      system: assembly.system,
      user: userMessage(text),
      tools: assembly.tools,
      schema: DESCRIBED_REPLY_SCHEMA,
      loader: skillLoader(assembly.rest, loadSkillCalls),
    });
    // Decision 4: one classifier, one intent. An escalated reply keeps the code-set fields (nothing past the handoff).
    const reply = turn.reply.escalate ? turn.reply : { ...turn.reply, intent: routed.route.intent };
    return { reply, turn, trace: { ...trace, escalatedBy: reply.escalate ? "reply" : null } };
  } catch (error) {
    if (error instanceof TurnError) throw new TurnError(error.cause, error.progress, trace);
    throw error;
  }
}
