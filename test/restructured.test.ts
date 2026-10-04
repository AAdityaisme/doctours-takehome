import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { replyAll, type BatchOptions } from "../src/cli.ts";
import * as constants from "../src/data.ts";
import { CATEGORY_REASONS, HANDOFF_SENTENCE } from "../src/escalation.ts";
import { CATALOG, CORE, SKILLS, assemble, ruleSkills } from "../src/prompts.ts";
import { fake, final, toolCall, usage } from "./fake.ts";

const routeResponse = (route: object) => {
  const text = JSON.stringify({ intent: "ask about financing", skills: [], escalation: null, ...route });
  return {
    status: "completed",
    output: [{ type: "message", id: "r", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
    output_text: text,
    usage,
  } as unknown as Response;
};

const formatName = (body: ResponseCreateParamsNonStreaming) => (body.text?.format as { name?: string }).name;
const developer = (body: ResponseCreateParamsNonStreaming) =>
  String((body.input as { role?: string; content?: string }[]).find((item) => item.role === "developer")?.content);
const toolNames = (body: ResponseCreateParamsNonStreaming) => (body.tools ?? []).map((tool) => (tool as { name: string }).name);
const skillText = (id: string) => SKILLS.find((skill) => skill.id === id)!.body;

/** A fake API: the router answers `route`, the reply model plays `replies` in order. Every request is kept. */
const scripted = (route: object, replies: Response[]) => {
  const requests: ResponseCreateParamsNonStreaming[] = [];
  const client = fake(async (body) => {
    requests.push(structuredClone(body));
    if (formatName(body) === "Route") return routeResponse(route);
    const next = replies.shift();
    assert.ok(next, "unexpected reply call");
    return next;
  });
  return { client, requests, replyRequests: () => requests.filter((body) => formatName(body) === "Reply") };
};

const run = async (client: BatchOptions["client"], text = "hi") => {
  const traces: Record<string, unknown>[] = [];
  const [reply] = await replyAll([{ id: "m", text }], {
    client,
    mode: "restructured",
    model: "reply-model",
    effort: "low",
    router: { model: "router-model", effort: "none" },
    trace: (record) => traces.push(record),
  });
  return { reply: reply!, trace: traces[0]! };
};

test("routing → assembly: core + the PIPELINE_STATUS stage + the router's skills, their tools, described schema", async () => {
  const { client, requests, replyRequests } = scripted({ skills: ["financing"] }, [final({ response: "Klarna works." })]);
  const { reply, trace } = await run(client, "can I pay monthly?");

  const router = requests[0]!;
  assert.equal(formatName(router), "Route");
  assert.equal(router.model, "router-model");
  assert.deepEqual(router.reasoning, { effort: "none" });
  assert.equal((router.text?.format as { strict?: boolean }).strict, true);
  assert.ok(developer(router).includes(CATALOG), "router sees the catalog");
  assert.equal(router.tools, undefined);

  const [body] = replyRequests();
  const system = developer(body!);
  assert.ok(system.startsWith(CORE.body.slice(0, 200)));
  assert.ok(system.includes("## PRE_CLINICAL_SENT (decision stage)"));
  assert.ok(system.includes(skillText("financing").slice(0, 300)));
  assert.ok(!system.includes(skillText("travel").slice(0, 300)), "unrouted skill not loaded");
  assert.ok(system.includes(constants.CHAT_LIST), "placeholders filled");
  assert.doesNotMatch(system, /\{\{(?!clinic\.slug\}\})/);
  assert.ok(toolNames(body!).includes("getSavedClinicsTool"), "stage tool");
  assert.ok(toolNames(body!).includes("loadSkill"));
  assert.ok(!toolNames(body!).includes("getPaymentLinkTool"), "no skill asked for it");
  assert.ok(!toolNames(body!).includes("issuePromoCodeTool"), "PROMO_OFFER is null");
  const schema = (body!.text?.format as unknown as { schema: { properties: Record<string, { description?: string }> } }).schema;
  assert.match(String(schema.properties.highEngagement!.description), /high engagement signals/);

  assert.equal(reply.response, "Klarna works.");
  assert.deepEqual(trace.skillsLoaded, ["financing"]);
  assert.equal(typeof (trace.router as { latencyMs: unknown }).latencyMs, "number");
  assert.deepEqual((trace.router as { tokens: unknown }).tokens, { input: 100, cached: 60, cacheWrite: 0, output: 20, reasoning: 5 });
});

test("deterministic rules: intake on outstanding collection or first contact; promo tool only with PROMO_OFFER", () => {
  assert.deepEqual(ruleSkills(constants), []);
  const outstanding = { ...constants, COLLECTION_STATUS: "area MISSING; name on file; photos MISSING." };
  assert.deepEqual(ruleSkills(outstanding), ["intake"]);
  const firstContact = { ...constants, RECENT_MEDIA_CONVERSATION: [{ role: "user" }] };
  assert.deepEqual(ruleSkills(firstContact), ["intake"]);
  assert.deepEqual(assemble([], outstanding).skills, ["intake"]);
  assert.ok(assemble([], outstanding).tools.some((tool) => tool.name === "updateUserTool"), "intake's tools come with it");

  assert.ok(!assemble([]).tools.some((tool) => tool.name === "issuePromoCodeTool"));
  const promo = { ...constants, PROMO_OFFER: { amount: 200 } };
  assert.ok(assemble([], promo).tools.some((tool) => tool.name === "issuePromoCodeTool"));

  assert.throws(() => assemble([], { ...constants, PIPELINE_STATUS: "NOPE" }), /no stage file/);
  const booked = assemble([], { ...constants, PIPELINE_STATUS: "MEETING_COMPLETED" });
  assert.ok(booked.system.includes("## MEETING_BOOKED / MEETING_COMPLETED"));
});

test("loadSkill: returns the skill's text, offers its tools from the next round, and is traced", async () => {
  const { client, replyRequests } = scripted({ skills: [] }, [
    toolCall("loadSkill", { id: "consultation" }, "l1"),
    toolCall("loadSkill", { id: "consultation" }, "l2"),
    final({ response: "It's free." }),
  ]);
  const { reply, trace } = await run(client, "is it free?");
  const [first, second, third] = replyRequests();
  assert.ok(!toolNames(first!).includes("getConsultationRescheduleLinkTool"));
  assert.ok(toolNames(second!).includes("getConsultationRescheduleLinkTool"), "skill tools offered after loading");
  const loadDescription = (first!.tools!.find((tool) => (tool as { name: string }).name === "loadSkill") as { description: string }).description;
  assert.match(loadDescription, /- consultation: .* Sections: CONSULTATION RESCHEDULING; PHONE CONTACT/);

  const outputs = (third!.input as { type?: string; output?: string }[]).filter((item) => item.type === "function_call_output");
  assert.equal(JSON.parse(outputs[0]!.output!).instructions, skillText("consultation"));
  assert.match(JSON.parse(outputs[1]!.output!).error, /already loaded/);
  assert.deepEqual(trace.loadSkillCalls, [
    { id: "consultation", result: "loaded" },
    { id: "consultation", result: "already loaded" },
  ]);
  assert.deepEqual(trace.skillsLoaded, ["consultation"], "trace shows what the reply could use");
  assert.ok((trace.toolsOffered as string[]).includes("getConsultationRescheduleLinkTool"));
  assert.equal(trace.apiCalls, 4, "router + 3 reply rounds");
  assert.deepEqual(trace.tokens, { input: 400, cached: 240, cacheWrite: 0, output: 80, reasoning: 20 });
  // Skill text is instructions, not tool data: its URLs never become attachments.
  assert.equal(reply.attachmentUrls, null);
});

test("a skill URL from loadSkill is not attachment-eligible", async () => {
  const { client } = scripted({ skills: [] }, [
    toolCall("loadSkill", { id: "consultation" }, "l1"),
    final({ response: "Book here https://www.doctours.com/consultation", attachmentUrls: ["https://www.doctours.com/consultation"] }),
  ]);
  const { reply } = await run(client);
  assert.equal(reply.attachmentUrls, null);
});

test("router escalation: no reply call, the handoff is built in code with a category reason", async () => {
  const { client, requests } = scripted(
    { intent: "wants a person", escalation: { category: "human_requested", reason: "asked for a person" } },
    [],
  );
  const { reply, trace } = await run(client, "get me someone real");
  assert.equal(requests.length, 1, "router only");
  assert.equal(reply.escalate, true);
  assert.equal(reply.response, HANDOFF_SENTENCE);
  assert.equal(reply.escalationReason, CATEGORY_REASONS.human_requested);
  assert.equal(trace.escalatedBy, "router");
  assert.equal(trace.apiCalls, 1, "the router call counts");
  assert.deepEqual(trace.tokens, { input: 100, cached: 60, cacheWrite: 0, output: 20, reasoning: 5 });
  assert.deepEqual((trace.router as { escalation: unknown }).escalation, { category: "human_requested", reason: "asked for a person" });
});

test("the reply model can still escalate a request the router missed", async () => {
  const { client } = scripted({ intent: "hold a date" }, [final({ escalate: true, escalationReason: "hold 4242", response: "sure" })]);
  const { reply, trace } = await run(client);
  assert.equal(reply.escalate, true);
  assert.equal(reply.response, HANDOFF_SENTENCE);
  assert.equal(trace.escalatedBy, "reply");
});

test("Reply.intent comes from the router, not the reply model", async () => {
  const { client } = scripted({ intent: "compare Heva packages" }, [final({ intent: "model's own intent" })]);
  const { reply } = await run(client);
  assert.equal(reply.intent, "compare Heva packages");
});

test("an unknown skill id from the router is ignored and traced, never a failed message", async () => {
  const { client, replyRequests } = scripted({ skills: ["made-up", "financing"] }, [final({ response: "fine" })]);
  const { reply, trace } = await run(client);
  assert.equal(reply.escalate, false);
  assert.equal(reply.response, "fine");
  assert.deepEqual(trace.skillsLoaded, ["financing"]);
  assert.deepEqual(trace.unknownSkills, ["made-up"]);
  assert.ok(developer(replyRequests()[0]!).includes(skillText("financing").slice(0, 300)));
});

test("a router failure fails that message safe; the batch carries on", async () => {
  const client = fake(async (body) => {
    if (formatName(body) === "Route") return { ...routeResponse({}), output_text: "{not json" } as Response;
    return final({});
  });
  const { reply, trace } = await run(client);
  assert.equal(reply.escalationReason, "system error");
  assert.equal(trace.ok, false);
});

test("card digits in the router's free text never reach Reply.intent or the trace", async () => {
  const { client } = scripted({ intent: "pay with card 4111 1111 1111 1111 exp 08/29 cvv 123" }, [final({})]);
  const { reply, trace } = await run(client);
  assert.equal(reply.intent, "pay with card [number] exp [number] cvv [number]");
  assert.doesNotMatch(JSON.stringify(trace), /4111|08\/29|123/);

  const escalated = scripted(
    { intent: "charge 5555-4444-3333-1111", escalation: { category: "cannot_do", reason: "charge 5555 4444 3333 1111" } },
    [],
  );
  const out = await run(escalated.client);
  assert.doesNotMatch(JSON.stringify([out.reply, out.trace]), /5555|1111/);
});
