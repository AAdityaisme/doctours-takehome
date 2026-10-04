import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { replyAll } from "../src/cli.ts";
import * as constants from "../src/data.ts";
import { assemble } from "../src/prompts.ts";
import { TOOLS } from "../src/tools.ts";
import { fake, final, toolCall } from "./fake.ts";

// E3: the reply's tools and first developer message are a cache-stable prefix; tool_choice narrows per message.
type Body = ResponseCreateParamsNonStreaming;
type Message = { role?: string; content?: string | { type: string; text: string; prompt_cache_breakpoint?: unknown }[] };
const format = (body: Body) => (body.text?.format as { name?: string }).name;
const messages = (body: Body) => body.input as Message[];
const developers = (body: Body) => messages(body).filter((m) => m.role === "developer");
const patient = (body: Body) => /^"(.*)"$/m.exec(String(messages(body).find((m) => m.role === "user")!.content))![1]!;
const choice = (body: Body) => body.tool_choice as unknown as { type: string; mode: string; tools: { type: string; name: string }[] };
const allowed = (body: Body) => choice(body).tools.map((tool) => tool.name);
const route = (skills: string[]) =>
  ({ ...final({}), output_text: JSON.stringify({ intent: "x", skills, escalation: null }) }) as Response;

const ROUTES: Record<string, string[]> = { none: [], money: ["financing", "deposit-and-payment"], trip: ["travel", "consultation"] };

const run = async (mode: "restructured" | "baseline", script: (body: Body, round: number) => Response) => {
  const requests: Body[] = [];
  const rounds = new Map<string, number>();
  const traces: Record<string, unknown>[] = [];
  const client = fake(async (body) => {
    if (format(body) === "Route") return route(ROUTES[patient(body)] ?? []);
    requests.push(structuredClone(body));
    const round = (rounds.get(patient(body)) ?? 0) + 1;
    rounds.set(patient(body), round);
    return script(body, round);
  });
  const items = Object.keys(ROUTES).map((text) => ({ id: text, text }));
  await replyAll(items, { client, mode, model: "m", effort: "low", router: { model: "r", effort: "none" }, trace: (t) => traces.push(t) });
  return { requests, traces };
};

test("tools and developer message 1 are byte-identical across messages with different skills", async () => {
  const { requests } = await run("restructured", () => final({}));
  assert.equal(requests.length, 3);
  const [first, ...rest] = requests;
  for (const body of rest) {
    assert.equal(JSON.stringify(body.tools), JSON.stringify(first!.tools), "tools");
    assert.equal(JSON.stringify(developers(body)[0]), JSON.stringify(developers(first!)[0]), "developer message 1");
    assert.equal(JSON.stringify(body.text), JSON.stringify(first!.text), "schema");
    assert.equal(body.prompt_cache_key, "restructured-PRE_CLINICAL_SENT");
  }
  // Message 1 is core + stage with an explicit breakpoint; message 2 carries the skills and is absent without any.
  const [one] = developers(first!);
  const part = (one!.content as { type: string; text: string; prompt_cache_breakpoint?: unknown }[])[0]!;
  assert.deepEqual(part.prompt_cache_breakpoint, { mode: "explicit" });
  assert.equal(part.text, assemble([]).prefix);
  const bySkills = Object.fromEntries(requests.map((body) => [patient(body), developers(body)]));
  assert.equal(bySkills.none!.length, 1);
  assert.equal(bySkills.money![1]!.content, assemble(ROUTES.money!).skillsText);
  assert.notEqual(bySkills.money![1]!.content, bySkills.trip![1]!.content);
  // Every tool restructured mode can offer, plus loadSkill; issuePromoCodeTool only with a promo.
  const names = first!.tools!.map((tool) => (tool as { name: string }).name);
  assert.deepEqual(names, [...TOOLS.filter((t) => t.name !== "issuePromoCodeTool").map((t) => t.name), "loadSkill"]);
});

test("allowed_tools is today's assembly per message, plus loadSkill; loaded skills' tools join from the next round", async () => {
  const { requests, traces } = await run("restructured", (body, round) =>
    patient(body) === "money" && round === 1 ? toolCall("loadSkill", { id: "consultation" }, "l1") : final({}),
  );
  const today = (id: string) => assemble(ROUTES[id]!).tools.map((tool) => tool.name);
  const [moneyFirst, moneySecond] = requests.filter((body) => patient(body) === "money");
  assert.deepEqual(allowed(moneyFirst!), [...today("money"), "loadSkill"]);
  assert.deepEqual(allowed(moneySecond!), [...today("money"), "getConsultationRescheduleLinkTool", "getFullCallsTool", "loadSkill"]);
  assert.deepEqual(moneySecond!.tools, moneyFirst!.tools, "definitions unchanged after loadSkill");
  for (const id of ["none", "trip"]) {
    assert.deepEqual(allowed(requests.find((body) => patient(body) === id)!), [...today(id), "loadSkill"], id);
  }
  for (const body of requests) {
    assert.equal(choice(body).type, "allowed_tools");
    assert.equal(choice(body).mode, "auto");
    assert.ok(choice(body).tools.every((tool) => tool.type === "function"));
  }
  // The trace's toolsOffered is the allowed list (without loadSkill), including what loadSkill added.
  const trace = traces.find((t) => t.id === "money")!;
  assert.deepEqual(trace.toolsOffered, [...assemble(ROUTES.money!).tools.map((t) => t.name), "getConsultationRescheduleLinkTool", "getFullCallsTool"]);
  assert.deepEqual(traces.find((t) => t.id === "none")!.toolsOffered, assemble([]).tools.map((t) => t.name));
});

test("loadSkill for a skill already in the instructions answers `already loaded`", async () => {
  const { requests, traces } = await run("restructured", (body, round) =>
    patient(body) === "money" && round === 1 ? toolCall("loadSkill", { id: "financing" }, "l1") : final({}),
  );
  const second = requests.filter((body) => patient(body) === "money")[1]!;
  const output = (second.input as { type?: string; output?: string }[]).find((item) => item.type === "function_call_output");
  assert.match(JSON.parse(output!.output!).error, /already loaded/);
  assert.deepEqual(traces.find((t) => t.id === "money")!.loadSkillCalls, [{ id: "financing", result: "already loaded" }]);
});

test("issuePromoCodeTool joins both the offered and the allowed list only when PROMO_OFFER is set", () => {
  const plain = assemble([]);
  const promo = assemble([], { ...constants, PROMO_OFFER: { amount: 200 } });
  assert.ok(!plain.offered.some((t) => t.name === "issuePromoCodeTool") && !plain.tools.some((t) => t.name === "issuePromoCodeTool"));
  assert.ok(promo.offered.some((t) => t.name === "issuePromoCodeTool") && promo.tools.some((t) => t.name === "issuePromoCodeTool"));
});

test("baseline requests are unchanged: one string developer message, all 14 tools, no tool_choice or cache key", async () => {
  const { requests } = await run("baseline", () => final({}));
  for (const body of requests) {
    assert.equal(developers(body).length, 1);
    assert.equal(typeof developers(body)[0]!.content, "string");
    assert.equal(body.tools!.length, 14);
    assert.equal("tool_choice" in body, false);
    assert.equal("prompt_cache_key" in body, false);
  }
});
