import * as constants from "./data.ts";
import { toEscalation } from "./escalation.ts";
import { userMessage } from "./prompt.ts";
import { DESCRIBED_REPLY_SCHEMA, SKILLS, assemble, ruleSkills, skillLoader, type LoadSkillCall } from "./prompts.ts";
import type { Reply } from "./reply.ts";
import { TurnError, respond, sumUsage, type Client, type Turn } from "./respond.ts";
import { redactNumbers, route } from "./router.ts";

export interface RestructuredOptions {
  client: Client;
  model: string;
  effort: string;
  router: { model: string; effort: string };
}

/**
 * SPEC steps 1-5 for one message: route; if the router escalates, hand off in code with no reply call; otherwise
 * assemble core + stage + skills, run the reply loop with `loadSkill`, and take the intent from the router.
 * If the router fails, the reply still runs with core + stage + rule skills, every other skill behind `loadSkill`,
 * and the reply model's own intent; only a reply-loop failure fails safe to a handoff.
 * Returns the trace fields this mode adds and message totals (router + reply). A reply-loop failure is rethrown
 * with both attached.
 */
export async function restructuredTurn(
  text: string,
  options: RestructuredOptions,
): Promise<{ reply: Reply; totals: Omit<Turn, "reply">; trace: Record<string, unknown> }> {
  const { client, model, effort } = options;
  const routed = await route(client, text, options.router);
  const router = {
    ...options.router,
    ...(routed.route ?? { error: routed.error }),
    tokens: routed.usage,
    latencyMs: routed.latencyMs,
  };
  // Decision 4: one classifier, one intent, on every path the router answered. Without a router, the reply model's
  // intent stands; both get the same digit redaction, since either could echo a card number.
  const intent = (reply: Reply): Reply => ({ ...reply, intent: routed.route?.intent ?? redactNumbers(reply.intent) });
  if (routed.route?.escalation) {
    const { category } = routed.route.escalation;
    const reply = intent(toEscalation(category));
    const totals = { toolCalls: [], apiCalls: routed.apiCalls, usage: routed.usage };
    const trace = { router, escalatedBy: "router", escalationCategory: category, skillsLoaded: [], loadSkillCalls: [] };
    return { reply, totals, trace };
  }

  const assembly = assemble(routed.route?.skills ?? []);
  const loadSkillCalls: LoadSkillCall[] = [];
  // Built after the turn: loadSkill may have added skills and their tools.
  const trace = () => {
    const loaded = loadSkillCalls.filter((call) => call.result === "loaded").map((call) => call.id);
    const added = SKILLS.filter((skill) => loaded.includes(skill.id)).flatMap((skill) => skill.tools);
    return {
      router,
      skillsLoaded: [...assembly.skills, ...loaded],
      ruleSkills: ruleSkills(constants),
      unknownSkills: assembly.unknownSkills,
      toolsOffered: [...new Set([...assembly.tools.map((tool) => tool.name), ...added])],
      loadSkillCalls,
    };
  };
  // Message totals count the router call too; router.tokens keeps the split.
  const withRouter = (progress: Omit<Turn, "reply">): Omit<Turn, "reply"> => ({
    ...progress,
    apiCalls: progress.apiCalls + routed.apiCalls,
    usage: sumUsage(routed.usage, progress.usage),
  });
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
    const reply = intent(turn.reply);
    const by = reply.escalate ? "reply" : null;
    return { reply, totals: withRouter(turn), trace: { ...trace(), escalatedBy: by, escalationCategory: by } };
  } catch (error) {
    if (error instanceof TurnError) throw new TurnError(error.cause, withRouter(error.progress), trace());
    throw error;
  }
}
