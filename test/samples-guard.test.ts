import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

// SPEC "What gets graded" (packet L719): the packet samples are a smoke test, never an input to the system.
// Nothing under src/ or prompts/ may load evals/packet-samples.json or carry a sample message or its id.

const root = new URL("../", import.meta.url);
const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, " ");

const filesUnder = (dir: string): string[] => {
  const url = new URL(`${dir}/`, root);
  if (!existsSync(url)) return [];
  return readdirSync(url, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`);
};

test("src/ and prompts/ never read the packet samples or contain their messages", () => {
  const samples: { id: string; text: string }[] = JSON.parse(
    readFileSync(new URL("evals/packet-samples.json", root), "utf8"),
  );
  // A sample sentence that is also part of the original system prompt (L994 quotes "is the consultation free?")
  // may legitimately appear in the split prompts, so only sentences foreign to that prompt are banned.
  const original = normalize(readFileSync(new URL("baseline/system-prompt.md", root), "utf8"));
  const banned = [
    "packet-samples",
    ...samples.map((s) => normalize(s.text)).filter((text) => !original.includes(text)),
    ...samples.map((s) => s.id).filter((id) => id.includes("-")),
  ];
  assert.ok(banned.length >= 8, "the guard lost its sample texts");

  const files = [...filesUnder("src"), ...filesUnder("prompts")];
  assert.ok(files.length > 0);
  for (const file of files) {
    const content = normalize(readFileSync(file, "utf8"));
    for (const needle of banned) assert.ok(!content.includes(needle), `${file} contains "${needle}"`);
  }
});
