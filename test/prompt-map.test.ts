import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import * as constants from "../src/data.ts";
import { DESCRIBED_REPLY_SCHEMA, parsePromptFile } from "../src/prompts.ts";
import { TOOLS } from "../src/tools.ts";

// docs/prompt-map.md uses packet line numbers; baseline/system-prompt.md is packet L764-1554 byte for byte.
const FIRST = 764;
const LAST = 1554;
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const original = read("baseline/system-prompt.md").split("\n");
const line = (n: number) => original[n - FIRST]!.trimEnd();

const promptPaths = ["prompts/core.md", "prompts/router.md", ...["stages/", "skills/"].flatMap((dir) =>
  readdirSync(new URL(`prompts/${dir}`, root)).filter((f) => f.endsWith(".md")).map((f) => `prompts/${dir}${f}`),
)];
const files = new Map(promptPaths.map((path) => [path, parsePromptFile(path, read(path))]));
const lines = (path: string) => files.get(path)!.body.split("\n").map((l) => l.trimEnd());
const replyPaths = promptPaths.filter((path) => path !== "prompts/router.md");

const doc = read("docs/prompt-map.md");
const section = (start: string, end: string) => doc.split(start)[1]!.split(end)[0]!;
const rows = [...section("## Line map", "\n## ").matchAll(/^\| (\d+)(?:-(\d+))? \| .*? \| (.*?) \|/gm)].map((m) => ({
  start: Number(m[1]),
  end: Number(m[2] ?? m[1]),
  dest: m[3]!.replace(" (rewritten)", ""),
}));
const rewritten = new Set(
  [...section("### Rewritten lines", "### Deleted lines").matchAll(/^\| (\d+) \| /gm)].map((m) => Number(m[1])),
);
const target = (dest: string): string => {
  if (dest === "core" || dest === "code" || dest === "deleted") return dest === "core" ? "prompts/core.md" : dest;
  const m = /^(stage|skill) `([\w-]+)`$/.exec(dest);
  assert.ok(m, `unknown destination ${dest}`);
  return `prompts/${m[1]}s/${m[2]}.md`;
};

test("the map covers L764-1554 once, in order, with no gaps", () => {
  assert.equal(original.length - 1, LAST - FIRST + 1, "baseline file is L764-1554 plus a final newline");
  let next = FIRST;
  for (const row of rows) {
    assert.equal(row.start, next, `row starting ${row.start}`);
    next = row.end + 1;
  }
  assert.equal(next, LAST + 1);
});

test("every original line is verbatim in its mapped file exactly once, or listed as rewritten, code or deleted", () => {
  const counts = new Map<string, number>();
  for (const path of replyPaths) for (const l of lines(path)) if (l.trim()) counts.set(l, (counts.get(l) ?? 0) + 1);
  const expected = new Map<string, number>();
  const tally = { verbatim: 0, rewritten: 0, code: 0, deleted: 0 };
  for (const row of rows) {
    const path = target(row.dest);
    for (let n = row.start; n <= row.end; n++) {
      const text = line(n);
      if (!text.trim()) continue;
      if (rewritten.has(n)) {
        tally.rewritten++;
        assert.ok(!counts.has(text), `L${n} is listed as rewritten but appears verbatim`);
        assert.ok(lines(path).some((l) => l !== text && l.slice(0, 30) === text.slice(0, 30)), `L${n} rewrite not in ${path}`);
      } else if (path === "code" || path === "deleted") {
        tally[path]++;
        assert.ok(!counts.has(text), `L${n} is listed as ${path} but appears in prompts/`);
      } else {
        tally.verbatim++;
        assert.ok(lines(path).includes(text), `L${n} missing from ${path}`);
        expected.set(text, (expected.get(text) ?? 0) + 1);
      }
    }
  }
  for (const [text, want] of expected) assert.equal(counts.get(text), want, `copies of ${JSON.stringify(text.slice(0, 60))}`);
  assert.deepEqual(tally, { verbatim: 622, rewritten: 6, code: 6, deleted: 7 });
});

test("the output-field rules that moved to code are the schema's field descriptions, verbatim", () => {
  const description = (field: string) => DESCRIBED_REPLY_SCHEMA.properties![field]!.description;
  const rule = (n: number, label: string) => line(n).slice(`- **${label}**: `.length);
  assert.equal(description("highEngagement"), rule(1022, "highEngagement"));
  assert.equal(
    `${description("shouldFollowUp")} ${description("followUpTiming")}`,
    rule(1023, "shouldFollowUp / followUpTiming"),
  );
  assert.equal(description("intent"), rule(1024, "intent"));
  assert.equal(description("attachmentUrls"), rule(1025, "attachmentUrls"));
});

test("prompt files: no dead tools, no hardcoded classification, known tools and placeholders only", () => {
  const dead = /getBookingPackageDetailsTool|getTripDetailsTool|getTripRecommendationsTool|searchAirportsTool|updateFlightPreferencesTool|updateUserAirportTool/;
  const names = new Set(TOOLS.map((tool) => tool.name));
  const placeholders = new Set([...Object.keys(constants), "clinic.slug", "SKILL_CATALOG"]);
  for (const [path, file] of files) {
    assert.doesNotMatch(file.body, dead, path);
    assert.doesNotMatch(file.body, /Message Classification/, path);
    for (const tool of (file.meta.tools as string[] | undefined) ?? []) assert.ok(names.has(tool), `${path}: ${tool}`);
    for (const [, name] of file.body.matchAll(/\{\{([^{}]*)\}\}/g)) assert.ok(placeholders.has(name!), `${path}: {{${name}}}`);
  }
});
