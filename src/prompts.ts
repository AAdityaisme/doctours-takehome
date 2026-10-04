import { readFileSync, readdirSync } from "node:fs";
import * as constants from "./data.ts";
import { fill } from "./prompt.ts";
import { REPLY_SCHEMA, strictObject, type Schema } from "./reply.ts";
import { TOOLS, type Tool } from "./tools.ts";

/** One prompt file: JSON-valued front matter, then the text that goes into the system prompt. */
export interface PromptFile {
  name: string;
  meta: Record<string, unknown>;
  body: string;
}

export interface Skill extends PromptFile {
  id: string;
  description: string;
  tools: string[];
  headings: string[];
}

const DIR = new URL("../prompts/", import.meta.url);

export function parsePromptFile(name: string, text: string): PromptFile {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return { name, meta: {}, body: text.trim() };
  const meta: Record<string, unknown> = {};
  for (const line of match[1]!.split("\n")) {
    const at = line.indexOf(": ");
    if (at < 0) throw new Error(`${name}: bad front matter line ${JSON.stringify(line)}`);
    meta[line.slice(0, at)] = JSON.parse(line.slice(at + 2));
  }
  return { name, meta, body: text.slice(match[0].length).trim() };
}

const load = (path: string): PromptFile => parsePromptFile(path, readFileSync(new URL(path, DIR), "utf8"));
const list = (dir: string): string[] =>
  readdirSync(new URL(dir, DIR))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => `${dir}${file}`);
const strings = (file: PromptFile, key: string): string[] => {
  const value = file.meta[key] ?? [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${file.name}: front matter ${key} must be a string array`);
  }
  return value;
};

const toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));
const checkTools = (file: PromptFile): string[] => {
  const names = strings(file, "tools");
  for (const name of names) if (!toolsByName.has(name)) throw new Error(`${file.name}: unknown tool ${name}`);
  return names;
};

export const CORE = load("core.md");
const coreTools = checkTools(CORE);

/** Stage files by the PIPELINE_STATUS values they serve (front matter `statuses`). */
export const STAGES = new Map<string, PromptFile>();
for (const path of list("stages/")) {
  const file = load(path);
  checkTools(file);
  for (const status of strings(file, "statuses")) STAGES.set(status, file);
}

/** Skills in catalog order (file name order). */
export const SKILLS: Skill[] = list("skills/").map((path) => {
  const file = load(path);
  const { id, description } = file.meta;
  if (typeof id !== "string" || `skills/${id}.md` !== path) throw new Error(`${path}: id must match the file name`);
  if (typeof description !== "string") throw new Error(`${path}: description must be a string`);
  // Whole sections the skill holds, which is what cross-references name ("see TIME-BOUND PAUSE"); not "# From" fragments.
  const headings = [...file.body.matchAll(/^# (?!From )(.+)$/gm)].map((m) => m[1]!);
  return { ...file, id, description, tools: checkTools(file), headings };
});
const skillsById = new Map(SKILLS.map((skill) => [skill.id, skill]));

/** The router's catalog: one `- id: description` line per skill. */
export const CATALOG = SKILLS.map((skill) => `- ${skill.id}: ${skill.description}`).join("\n");

export const ROUTER_SYSTEM = fill(load("router.md").body, { ...constants, SKILL_CATALOG: CATALOG });

// STRUCTURED OUTPUT FIELDS (packet L1022-1025) moved from the prompt into the schema, read verbatim from the original.
const ORIGINAL = readFileSync(new URL("../baseline/system-prompt.md", import.meta.url), "utf8");
const fieldRule = (label: string): string => {
  const line = ORIGINAL.split("\n").find((candidate) => candidate.startsWith(`- **${label}**: `));
  if (!line) throw new Error(`baseline prompt has no output rule for ${label}`);
  return line.slice(`- **${label}**: `.length);
};
const followUp = fieldRule("shouldFollowUp / followUpTiming");
const timingAt = followUp.indexOf("Set followUpTiming to");
const describe = (field: string, description: string): Schema => ({
  ...REPLY_SCHEMA.properties![field]!,
  description,
});

/** `REPLY_SCHEMA` with the original prompt's output-field rules as field descriptions (restructured mode). */
export const DESCRIBED_REPLY_SCHEMA: Schema = {
  ...REPLY_SCHEMA,
  properties: {
    ...REPLY_SCHEMA.properties,
    highEngagement: describe("highEngagement", fieldRule("highEngagement")),
    shouldFollowUp: describe("shouldFollowUp", followUp.slice(0, timingAt).trim()),
    followUpTiming: describe("followUpTiming", followUp.slice(timingAt)),
    intent: describe("intent", fieldRule("intent")),
    attachmentUrls: describe("attachmentUrls", fieldRule("attachmentUrls")),
  },
};

/** The packet constants: every placeholder's value, and what the stage choice and the rules read. Tests pass their own. */
export interface Context extends Record<string, unknown> {
  PIPELINE_STATUS: string;
  COLLECTION_STATUS: string;
  PROMO_OFFER: unknown;
  RECENT_MEDIA_CONVERSATION: readonly { role: string }[];
}

/**
 * Skills code loads without asking the router (SPEC decision 3). Intake: something is still to collect, or the
 * coordinator has never written in this thread (first contact). The router can't see either.
 */
export function ruleSkills(context: Context): string[] {
  const outstanding = !/everything is collected/i.test(context.COLLECTION_STATUS);
  const firstContact = !context.RECENT_MEDIA_CONVERSATION.some((message) => message.role === "assistant");
  return outstanding || firstContact ? ["intake"] : [];
}

export interface Assembly {
  system: string;
  tools: Tool[];
  /** Loaded skill ids, catalog order. */
  skills: string[];
  /** Ids the router returned that no skill has; ignored. */
  unknownSkills: string[];
  /** Skills not loaded, offered through `loadSkill`. */
  rest: Skill[];
}

/**
 * The reply's system prompt (SPEC step 3): core, the stage file for PIPELINE_STATUS, then the router's skills plus
 * the rule skills, every placeholder filled. Tools: the front-matter tools of all of those, in TOOLS order, plus
 * issuePromoCodeTool only when PROMO_OFFER is set.
 */
export function assemble(routed: string[], context: Context = constants): Assembly {
  const stage = STAGES.get(context.PIPELINE_STATUS);
  if (!stage) throw new Error(`no stage file for PIPELINE_STATUS ${context.PIPELINE_STATUS}`);
  const wanted = new Set([...routed, ...ruleSkills(context)]);
  const skills = SKILLS.filter((skill) => wanted.has(skill.id));
  const names = new Set([
    ...coreTools,
    ...strings(stage, "tools"),
    ...skills.flatMap((skill) => skill.tools),
    // ponytail: the packet ships only the no-promo ACTIVE PROMO OFFER text (discounts-and-quotes), matching its fixed
    // PROMO_OFFER = null. A live offer also needs its section generated from PROMO_OFFER; add that with the first real one.
    ...(context.PROMO_OFFER != null ? ["issuePromoCodeTool"] : []),
  ]);
  return {
    system: fill([CORE, stage, ...skills].map((file) => file.body).join("\n\n"), context),
    tools: TOOLS.filter((tool) => names.has(tool.name)),
    skills: skills.map((skill) => skill.id),
    unknownSkills: [...new Set(routed)].filter((id) => !skillsById.has(id)),
    rest: SKILLS.filter((skill) => !wanted.has(skill.id)),
  };
}

/** A tool whose output is prompt text, not patient data: it never adds attachment-eligible URLs. */
export interface SkillLoader {
  tool: Pick<Tool, "name" | "description" | "parameters">;
  /** The text sent back to the model, and the tools that skill adds from the next round on. */
  load(argumentsJson: string): { output: string; tools: Tool[] };
}

export interface LoadSkillCall {
  id: string;
  result: "loaded" | "already loaded" | "unknown";
}

/**
 * `loadSkill(id)` for the skills the assembly left out (SPEC step 3). Its description lists each one's id,
 * description and `# ` headings, so "see TIME-BOUND PAUSE" resolves. Every call lands in `calls`.
 */
export function skillLoader(rest: Skill[], calls: LoadSkillCall[], context: Context = constants): SkillLoader | null {
  if (rest.length === 0) return null;
  const loaded = new Set<string>();
  const lines = rest.map(
    (skill) => `- ${skill.id}: ${skill.description}${skill.headings.length ? ` Sections: ${skill.headings.join("; ")}` : ""}`,
  );
  return {
    tool: {
      name: "loadSkill",
      description: [
        "Load a skill that is not in your instructions yet, when this message needs it or your instructions refer to one of its sections by name. Returns its instructions.",
        "Not loaded:",
        ...lines,
      ].join("\n"),
      parameters: strictObject({ id: { type: "string", enum: rest.map((skill) => skill.id) } }),
    },
    load(argumentsJson) {
      let id = "";
      try {
        id = String((JSON.parse(argumentsJson) as { id?: unknown }).id ?? "");
      } catch {
        // falls through as unknown
      }
      const skill = rest.find((candidate) => candidate.id === id);
      const result = !skill ? "unknown" : loaded.has(id) ? "already loaded" : "loaded";
      calls.push({ id, result });
      if (!skill || result !== "loaded") return { output: JSON.stringify({ error: `${result} skill ${id}` }), tools: [] };
      loaded.add(id);
      return {
        output: JSON.stringify({ skill: id, instructions: fill(skill.body, context) }),
        tools: TOOLS.filter((tool) => skill.tools.includes(tool.name)),
      };
    },
  };
}
