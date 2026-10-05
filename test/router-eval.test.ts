import OpenAI from "openai";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Response, ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { routeCases, scoreRouter } from "../evals/router.ts";
import type { Case } from "../evals/score.ts";

const caseOf = (id: string, text: string, escalate: boolean, category: "human_requested" | "cannot_do" | null = null) => ({
  id,
  text,
  topic: "t",
  source: "",
  set: "cases" as const,
  expect: { escalate, escalationCategory: category, mustInclude: [], mustNotInclude: [], notes: "" },
}) satisfies Case & { set: "cases" };

const routeReply = (escalation: object | null): Response =>
  ({
    status: "completed",
    output_text: JSON.stringify({ intent: "test", skills: [], escalation }),
    usage: { input_tokens: 1000, output_tokens: 20, input_tokens_details: { cached_tokens: 800, cache_write_tokens: 0 } },
  }) as unknown as Response;

test("router eval: sends each case through route() and scores FP, FN, category and failures", async () => {
  const requests: ResponseCreateParamsNonStreaming[] = [];
  const client = {
    responses: {
      create: async (body: ResponseCreateParamsNonStreaming) => {
        requests.push(body);
        const text = JSON.stringify(body.input);
        if (text.includes("boom")) throw new Error("offline failure");
        if (text.includes("human please")) return routeReply({ category: "human_requested", reason: "wants a person" });
        if (text.includes("charge it")) return routeReply({ category: "human_requested", reason: "wrong category" });
        if (text.includes("whatsapp?")) return routeReply({ category: "cannot_do", reason: "contact ask" });
        return routeReply(null);
      },
    },
  };
  const cases = [
    caseOf("hit", "human please", true, "human_requested"),
    caseOf("wrong-cat", "charge it", true, "cannot_do"),
    caseOf("fp", "whatsapp?", false),
    caseOf("fn", "refund me now", true, "cannot_do"),
    caseOf("tn", "how much is gold", false),
    caseOf("failed", "boom", false),
    caseOf("failed-should", "boom refund", true, "cannot_do"),
  ];
  const results = await routeCases(cases, { client, model: "gpt-6-luna", effort: "none", concurrency: 2 });
  assert.deepEqual(results.map((r) => r.id), cases.map((c) => c.id));
  // Same call restructured mode makes: the router's strict schema, the configured model and effort.
  assert.equal((requests[0].text?.format as { name?: string }).name, "Route");
  assert.equal(requests[0].model, "gpt-6-luna");
  assert.equal(requests[0].reasoning?.effort, "none");

  const s = scoreRouter(results, "gpt-6-luna");
  // A router failure counts as no escalation (restructured mode's fallback), so it can't drop out of the rates.
  assert.deepEqual(s.escalate.should, { hits: 2, total: 4, rate: 0.5 });
  assert.deepEqual(s.escalate.shouldNot, { hits: 2, total: 3, rate: 2 / 3 });
  assert.deepEqual(s.category, { hits: 1, total: 2, rate: 0.5 });
  assert.deepEqual(s.falsePositives, [{ id: "fp", category: "cannot_do", reason: "contact ask" }]);
  assert.deepEqual(s.falseNegatives.map((f) => f.id), ["fn", "failed-should"]);
  assert.deepEqual(s.wrongCategory.map((f) => f.id), ["wrong-cat"]);
  assert.deepEqual(s.routerFailures.map((f) => f.id), ["failed", "failed-should"]);
  assert.equal(s.usage.input, 5000);
  // 5 billed calls (the two failures threw before any usage) x (200 uncached x $0.10 + 800 cached x $0.01 + 20 output x $0.50) per 1M tokens
  assert.equal(s.cost?.toFixed(6), (5 * (200 * 0.1 + 800 * 0.01 + 20 * 0.5) / 1e6).toFixed(6));
});

test("router eval stops on configuration errors instead of scoring them", async () => {
  const error = new OpenAI.AuthenticationError(401, { message: "bad key" }, undefined, new Headers());
  await assert.rejects(routeCases([caseOf("x", "hello", false)], {
    client: { responses: { create: async () => { throw error; } } }, model: "router", effort: "none", concurrency: 1,
  }), (caught) => caught === error);
});
