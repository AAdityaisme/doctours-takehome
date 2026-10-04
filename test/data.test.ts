import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BASELINE_SYSTEM } from "../src/baseline.ts";
import { CHAT_LIST, PATIENT_SUMMARY } from "../src/data.ts";
import { fill, userMessage } from "../src/prompt.ts";
import { TOOLS, findClinic, getClinicPackages, getPaymentLink, runTool } from "../src/tools.ts";

test("tools return the packet data", () => {
  const heva = getClinicPackages({ clinicName: "Heva Clinic" });
  assert.deepEqual(
    heva?.packages.map((p) => [p.name, p.basePrice, p.depositAmount]),
    [
      ["Silver", 3000, 500],
      ["Gold", 4500, 600],
    ],
  );
  assert.deepEqual(
    getClinicPackages({ clinicName: "dr. hakan" })?.packages.map((p) => [p.name, p.basePrice]),
    [["Sapphire", 3200]],
  );
  assert.equal(findClinic({ clinicName: "hakan" })?.name, "Dr. Hakan Clinic");
  assert.equal(findClinic({ clinicName: "nowhere" }), null);
  assert.equal(
    getPaymentLink({ type: "payment", clinicPackageId: "44444444-4444-4444-8444-444444444441" })?.url,
    "https://www.doctours.com/payment/44444444-4444-4444-8444-444444444441",
  );
  assert.equal(
    getPaymentLink({ type: "checkout", clinicId: "22222222-2222-4222-8222-222222222222" })?.url,
    "https://www.doctours.com/clinic/dr-hakan/checkout",
  );
});

test("all 14 packet functions are exposed under the prompt's names", () => {
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), [
    "getAllClinicsTool",
    "getClinicDoctorsTool",
    "getClinicPackagesTool",
    "getConsultationRescheduleLinkTool",
    "getFullCallsTool",
    "getLatestAssessmentTool",
    "getPatientContextTool",
    "getPatientImagesTool",
    "getPaymentLinkTool",
    "getSavedClinicsTool",
    "issuePromoCodeTool",
    "updateUserClinicPreferencesTool",
    "updateUserTool",
    "updateWorkingMemoryTool",
  ]);
});

test("runTool drops null arguments, passes null results through, reports unknown tools", () => {
  const out = JSON.parse(runTool("getClinicPackagesTool", '{"clinicId":null,"clinicName":"heva"}'));
  assert.equal(out.clinicName, "Heva Clinic");
  assert.equal(runTool("getClinicDoctorsTool", '{"clinicId":null,"clinicName":"nowhere"}'), "null");
  assert.match(runTool("chargeCardTool", "{}"), /unknown tool/);
});

test("runTool returns an error to the model, instead of throwing, on malformed arguments or a throwing tool", () => {
  for (const args of ["{not json", "null"]) {
    assert.match(JSON.parse(runTool("getClinicPackagesTool", args)).error, /getClinicPackagesTool failed/, args);
  }
  // The packet handler calls clinicName.trim(), so a number makes it throw.
  assert.match(JSON.parse(runTool("getClinicDoctorsTool", '{"clinicName":5}')).error, /getClinicDoctorsTool failed/);
});

test("fill: every {{NAME}} filled, unknown names throw, inserted values are not re-scanned", () => {
  assert.equal(fill("a {{X}} b {{N}}", { X: "x", N: 5 }), "a x b 5");
  assert.throws(() => fill("{{MISSING}}", {}), /MISSING/);
  assert.throws(() => fill("{{X}}", { X: undefined }), /X/);
  assert.equal(fill("{{X}}", { X: "{{Y}}" }), "{{Y}}");
  assert.equal(fill("use {{clinic.slug}}", {}), "use {{clinic.slug}}");
  assert.match(userMessage("hi {{Z}}"), /^Incoming thread message:\n"hi \{\{Z\}\}"\n/);
});

test("baseline prompt is the packet's prompt, fully filled", () => {
  const raw = readFileSync(new URL("../baseline/system-prompt.md", import.meta.url));
  // Pinned to packet L764-1554 (sha256 checked against the packet when the file was cut).
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    "d5eb3d6a6e7e5a2eb5abfb08afc7466121e7edd5c7dda30086ea57a9500519f2",
  );
  assert.deepEqual([...new Set(BASELINE_SYSTEM.match(/\{\{[^}]*\}\}/g))], ["{{clinic.slug}}"]);
  assert.ok(BASELINE_SYSTEM.includes(PATIENT_SUMMARY));
  assert.ok(BASELINE_SYSTEM.includes(CHAT_LIST));
  assert.ok(BASELINE_SYSTEM.includes("Patient Images: 5 uploaded"));
});
