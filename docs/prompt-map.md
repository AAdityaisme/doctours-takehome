# Prompt map

Where every line of the original system prompt (packet lines 764-1554) went. Line numbers are packet line numbers.

Each line is in exactly one place: `prompts/core.md` (loaded every turn), one stage file (picked by code from
`PIPELINE_STATUS`), one skill (picked by the router, or by the reply model through `loadSkill`), code, or a
recorded deletion. Text was moved, not rewritten: the only changed lines are listed under [Edits](#edits).
`test/prompt-map.test.ts` checks this map against `baseline/system-prompt.md` on every test run.

## Sizes

| What | Size |
|------|------|
| Original prompt, L764-1554 | 164,678 chars, ~41,169 tokens |
| `core.md` alone | 39,050 chars, ~9,762 tokens |
| Core + largest stage (`PRE_CLINICAL_SENT`) + two largest skills (`financing`, `packages-and-pricing`) | 79,270 chars, ~19,817 tokens |

Sizes count the files as written, before `{{NAME}}` placeholders are filled and without front matter. Filling adds
the same per-patient values (transcript, summary, memory) to both the original and the split version.

## Core (`prompts/core.md`, every turn)
IDENTITY, OBJECTIVE, RESPONSE MODE, a new ESCALATION section, VOICE, CONVERSATION AWARENESS, CAPABILITIES &
CONSTRAINTS, the general rules of BUSINESS POLICY GROUNDING and PACKAGE & CLINIC FACTS, GUIDELINES, SPECIFICITY,
the general TOOL USAGE lines, and the per-patient context block (working memory, thread and identity lines, Patient
Summary, Clinic flags, Available Context, Recent Calls, Recent Conversation). Core tools:
`getPatientContextTool`, `updateWorkingMemoryTool`.

## Stages (`prompts/stages/`, one per message, chosen by code)
Front matter `statuses` lists the `PIPELINE_STATUS` values a file serves. `MEETING_BOOKED.md` serves both
`MEETING_BOOKED` and `MEETING_COMPLETED`, as the original section did.

| File | Statuses | Tools | Source lines | Chars |
|------|----------|-------|--------------|-------|
| `stages/LEAD.md` | `LEAD` | none | 1250-1255 | 695 |
| `stages/PREP_PRE_CLINICAL.md` | `PREP_PRE_CLINICAL` | `getLatestAssessmentTool` | 1256-1263 | 1,647 |
| `stages/PRE_CLINICAL_SENT.md` | `PRE_CLINICAL_SENT` | `getLatestAssessmentTool`, `getSavedClinicsTool`, `getAllClinicsTool`, `getClinicPackagesTool`, `getClinicDoctorsTool`, `updateUserClinicPreferencesTool` | 1264-1307, 1323-1325, 1414, 1425-1426 | 11,466 |
| `stages/MEETING_BOOKED.md` | `MEETING_BOOKED`, `MEETING_COMPLETED` | `getConsultationRescheduleLinkTool` | 1326-1337 | 2,211 |
| `stages/MEETING_MISSED.md` | `MEETING_MISSED` | `getConsultationRescheduleLinkTool` | 1338-1340 | 330 |
| `stages/WAITING.md` | `WAITING` | none | 1341-1343 | 161 |

## Skills (`prompts/skills/`, chosen per message)
The router sees only `id` and `description`. A message may call core tools plus the stage's tools plus each loaded
skill's tools (`tool_choice: allowed_tools`); every definition is sent on every call so the cached prefix holds.

| id | description | tools | Source lines | Chars |
|----|-------------|-------|--------------|-------|
| `intake` | First reply to a new patient, or the patient gives or is asked for their procedure area, name or hair concern (hairline, crown, edges, thinning, braids/traction), or answers the Instant Form intro. | `updateUserTool`, `getPatientImagesTool` | 788-808, 1016-1018, 1043-1051, 1052-1057, 1058-1067, 1068-1100 | 13,755 |
| `images` | Scalp photos: uploading or texting photos, 'done' after a photo ask, upload page trouble, which angles, why the back photo, photos delayed by a weave/braids/wig/shaved head, or wanting their own photos back. | `getPatientImagesTool` | 1101-1133, 1344-1361, 1417, 1462 | 13,824 |
| `assessment` | Their assessment: what it shows, opening or resending the assessment link, the graft estimate, asking to change the hairline, grafts or recommended clinics, or whether the plan is final. | `getLatestAssessmentTool` | 1418, 1431-1434, 1463 | 2,643 |
| `clinics` | Which clinics: clinic facts, city or country, afro/4C/textured hair specialty, doctors, recommended or saved clinics, a clinic not recommended, a clinic's website or link, contacting a clinic directly, why book through Doctours. | `getAllClinicsTool`, `getSavedClinicsTool`, `getClinicDoctorsTool` | 862-875, 964, 980, 989-990, 1369-1386, 1411, 1413, 1416, 1435, 1452, 1464 | 9,784 |
| `packages-and-pricing` | Package prices and contents: what a package costs or includes (hotel nights, hotels, transfers, add-ons, own hotel), comparing tiers, upgrades, extra nights, PRP/stem-cell extras, required items, currency. | `getClinicPackagesTool` | 968-969, 970-971, 972, 973, 974-976, 983-988, 1212-1247, 1387-1396, 1412, 1456 | 14,098 |
| `discounts-and-quotes` | Discounts, promo codes, coupons, a price seen in an ad or screenshot, or a price a clinic quoted the patient directly. | `getClinicPackagesTool` | 1038-1042, 1322, 1523-1529 | 2,596 |
| `deposit-and-payment` | Paying and booking: how or where to pay, the deposit and what it secures, a payment or checkout link, ready to book a chosen clinic or package, refund/transfer/price-lock terms, when the balance is due, cash, a deposit already paid to a clinic. | `getPaymentLinkTool`, `getClinicPackagesTool`, `getAllClinicsTool`, `updateUserClinicPreferencesTool` | 939, 1026-1029, 1030-1037, 1308-1321, 1419, 1439, 1441, 1444, 1446-1449, 1465-1466 | 11,160 |
| `financing` | Ways to pay beyond paying in full: financing, Klarna, PayPal, monthly payments, instalments, payment plans, layaway, health insurance, Medicare/Medicaid, HSA/FSA, CareCredit, Cherry. | none | 809-820, 821-841, 842-861, 940-944, 1440, 1442-1443, 1445, 1450-1451 | 14,656 |
| `consultation` | The free Doctours consultation call: whether it is free, what it is, booking, confirming or rescheduling it, a missed consultation, requests for a phone call, what was said on a past call. | `getConsultationRescheduleLinkTool`, `getFullCallsTool` | 946, 1362-1368, 1406-1408, 1420-1421, 1453-1455, 1467-1470 | 4,087 |
| `scheduling` | Procedure dates: which days a clinic or package operates, availability, holding or locking a date, busy season, when the patient plans to go (a month, season or date range), how the date gets confirmed. | `getClinicPackagesTool`, `updateUserClinicPreferencesTool` | 945, 1415, 1436-1438, 1457-1460 | 3,208 |
| `travel` | Travel: flights and help finding them, which airport to fly into, airport transfers, drive times, when to arrive and how long to stay, passports and why we need one. | `getClinicPackagesTool` | 934-935, 948-949, 951-953, 978, 1397-1405, 1427-1429 | 7,363 |
| `reversibility` | A clinic, package, date, add-on or deposit choice is being made or sent, or the patient hesitates over one ('what if I change my mind', 'is this final', 'not sure which'). | none | 1134-1169 | 5,534 |
| `time-bound-pause` | The patient is pausing or stepping back: needs time, still reviewing, saving money, not ready, getting things in order, will reach out later, or asks to be followed up later. | none | 1170-1211 | 4,335 |
| `procedure` | The procedure itself: which areas or procedures we do (hairline, crown, beard, eyebrow, veneers), who performs the incisions, where to buy finasteride or minoxidil. | `getClinicPackagesTool` | 979, 981-982, 1430 | 1,688 |
| `creator-partnerships` | Influencer, content-creator, sponsorship, collab, media kit or brand-partnership messages. | none | 954-959 | 2,272 |

## Changes from the SPEC's starting proposal
- **Payments and financing split in three.** `financing` (Klarna/PayPal geography, insurance, CareCredit/Cherry,
  layaway), `deposit-and-payment` (deposit rules, payment and checkout links, refund/transfer/price lock, deposit
  already paid to a clinic) and `discounts-and-quotes` (promo, claimed prices, a clinic's direct quote). Together they
  are 28,412 characters; a payment-link request does not need the insurance and CareCredit rules, and a discount
  ask does not need either.
- **Clinics and packages split in two.** `clinics` (which clinic, specialty, doctors, status tiers, website,
  contacting a clinic) and `packages-and-pricing` (prices, inclusions, hotels, what matters vs nice to have,
  pre-assessment length cap). "Where is Dr. Hakan Clinic?" needs only the first.
- **Direct quotes moved from clinics to `discounts-and-quotes`.** A quoted price is a pricing-negotiation ask, the same
  shape as a claimed discount.
- **Hesitation split into `reversibility` and `time-bound-pause`.** They fire on different signals: reversibility
  whenever a clinic, package, date or deposit choice is on the table (including sending a payment link), the pause
  close only when the patient steps back. Each can now be tested alone.
- **CONSULTATION BOOKING CONFIRMATION stays in the `MEETING_BOOKED` stage file**, not the consultation skill. It fires
  on a bare "yes" to the automated booking intro, which carries no topic for a router to classify.
- **PRE_CLINICAL_SENT Step 3 (payment) moved to `deposit-and-payment`.** Three stages cite it (L1261, L1330, L1385)
  and a direct payment ask is answered at every stage, so it is not stage-only text. Steps 0-2 and Pacing stay in
  the stage.
- **New skills:** `assessment` (OK 3, the assessment tool and link), `scheduling` (OK 5 and 10, tentative dates),
  `travel` (flights, airports, travel timing, passport; SPEC had travel readiness only) and `procedure` (OK 2,
  incisions, finasteride). Each answers a question type the SPEC groups did not cover.
- **PACKAGE & CLINIC FACTS and BUSINESS POLICY GROUNDING split between core and skills.** Core keeps the grounding
  rules that protect any reply mentioning a price or policy (L960-963, L965-967, L929-933, L936, L947). The
  field-level lookup rules and the topic examples (financing math, airports, consultation format) moved next to the
  topic rules they illustrate.
- **TOOL USAGE split by tool.** Each tool's usage line moved with the skill or stage that offers the tool; the
  general lines (L1409-1410, L1422-1423) stay in core.

## Line map

| Lines | Section | Destination | Reason / note |
|-------|---------|-------------|---------------|
| 764-776 | IDENTITY | core | L769 bans channel-blaming wording; it does not conflict with escalation because code, not the model, writes the escalation sentence. |
| 777-779 | OBJECTIVE | core |  |
| 780-787 | RESPONSE MODE | core | References to skill sections stay by name; the reply model can `loadSkill` them. |
| 788-808 | COLLECTION PERSISTENCE | skill `intake` |  |
| 809-820 | FINANCING GEOGRAPHY | skill `financing` |  |
| 821-841 | HEALTH INSURANCE | skill `financing` | L832 is an exact duplicate of L853 (the `unknown` branch). Both kept: each completes its own section's yes/no/unknown triad. |
| 842-861 | CARECREDIT / CHERRY | skill `financing` |  |
| 862-875 | CLINIC WEBSITE | skill `clinics` |  |
| 876-880 | VOICE | core | VOICE (L877) bans handoff wording ('someone from our team will...'). Kept: the model never writes the escalation sentence; code does (see ESCALATION in core). |
| 881-893 | CONVERSATION AWARENESS | core |  |
| 894-901 | CAPABILITIES & CONSTRAINTS | core |  |
| 902 | CAPABILITIES & CONSTRAINTS (bookings/flights bullet) | core (rewritten) | REWRITTEN: dead tools removed, see Edits. |
| 903-928 | CAPABILITIES & CONSTRAINTS | core | Includes the contrastive examples; they illustrate the cross-topic over-commit rule. L913 'routed to a person': a request to contact the clinic now escalates (router, and core ESCALATION). L914 'routing already decided this turn is yours' is overridden by core ESCALATION for requests that need a person. L921's date-hold decline is the slip-through reply; a request to hold a date escalates (packet L7). |
| 929-933 | BUSINESS POLICY GROUNDING (rules) | core |  |
| 934-935 | BUSINESS POLICY GROUNDING (drive times, airport transfers) | skill `travel` | Topic rules: only travel/airport replies need them. |
| 936-938 | BUSINESS POLICY GROUNDING (uncovered-policy rule, examples header) | core |  |
| 939 | BPG example: balance routing | skill `deposit-and-payment` | Example sits with the payment-routing rule it illustrates (L1441). |
| 940-944 | BPG examples: financing math, outside US/CA, insurance, CareCredit/Cherry, deposit installments | skill `financing` | Examples sit with the financing rules they illustrate. |
| 945 | BPG example: date locking | skill `scheduling` |  |
| 946 | BPG example: consultation format | skill `consultation` |  |
| 947 | BPG example: portal features | core | General: applies to any portal mention. |
| 948-949 | BPG examples: airport drive time, preferred landing | skill `travel` |  |
| 950 | BPG example: first-party trip link | deleted | DELETED: shows a reply sending a /trip/ link, which only the nonexistent getTripRecommendationsTool produces; pre-deposit replies never send a trip link (L902). |
| 951-953 | BPG examples: tied airports, transfer coverage | skill `travel` |  |
| 954-959 | CREATOR / PARTNERSHIP BUSINESS | skill `creator-partnerships` | L955 'routed to a human': creator/partnership business escalates; the Molly reply stays for when the router misses. |
| 960-962 | PACKAGE & CLINIC FACTS (header, intro) | core | Core keeps the grounding principle that protects any reply that mentions a price. |
| 963 | PACKAGE & CLINIC FACTS: Grounding | core (rewritten) | REWRITTEN: getBookingPackageDetailsTool removed, see Edits. |
| 964 | PACKAGE & CLINIC FACTS: hair type / afro is a clinic flag | skill `clinics` | Clinic capability, not a package fact. |
| 965-967 | PACKAGE & CLINIC FACTS: chat history not a source, self-correction, verbatim | core |  |
| 968-969 | PACKAGE & CLINIC FACTS: included vs addon, exact attribution | skill `packages-and-pricing` | Field-level lookup rules: only needed when a package answer is being written. |
| 970-971 | PACKAGE & CLINIC FACTS: price and currency, aiContext | skill `packages-and-pricing` (rewritten) | REWRITTEN: getBookingPackageDetailsTool removed, see Edits. |
| 972 | PACKAGE & CLINIC FACTS: self-booked hotel and transport | skill `packages-and-pricing` |  |
| 973 | PACKAGE & CLINIC FACTS: standard vs upgraded hotels | skill `packages-and-pricing` (rewritten) | REWRITTEN: plural 'packages tools' (implied the booked-tier tool), see Edits. |
| 974-976 | PACKAGE & CLINIC FACTS: hotel list rules | skill `packages-and-pricing` |  |
| 977 | PACKAGE & CLINIC FACTS: getTripDetailsTool.hotel | deleted | DELETED: describes getTripDetailsTool, which does not exist. |
| 978 | PACKAGE & CLINIC FACTS: why we need the passport | skill `travel` |  |
| 979 | PACKAGE & CLINIC FACTS: finasteride / minoxidil | skill `procedure` | Not a package fact; a procedure/medication question. |
| 980 | PACKAGE & CLINIC FACTS: can they message the clinic | skill `clinics` | L980 'goes to a person': a second contact ask or a request to reach the clinic escalates. |
| 981-982 | PACKAGE & CLINIC FACTS: who performs the incisions | skill `procedure` |  |
| 983-988 | PACKAGE & CLINIC FACTS: examples (inclusion, cross-package, currency) | skill `packages-and-pricing` |  |
| 989-990 | PACKAGE & CLINIC FACTS: example (hair type) | skill `clinics` |  |
| 991-993 | GUIDELINES | core |  |
| 994 | GUIDELINES: Size the reply | core (rewritten) | REWRITTEN (E4): the consultation example keeps its booking link only when booking a new call is a real next step, subject to No repeated links; see Edits. |
| 995-1007 | GUIDELINES | core | Head-covering (L999) and assessment-turnaround (L1000) stay core: they can surface in any travel, photo or recovery reply. |
| 1008-1015 | SPECIFICITY | core |  |
| 1016-1018 | DATA COLLECTION | skill `intake` |  |
| 1019-1025 | STRUCTURED OUTPUT FIELDS (header, highEngagement, shouldFollowUp/followUpTiming, intent, attachmentUrls) | code | CODE: the strict json_schema makes the output structural (L1019-1021); L1022-1024 become the schema `description` of their fields, verbatim (`DESCRIBED_REPLY_SCHEMA` in src/prompts.ts, read from baseline/system-prompt.md); L1025 becomes post-processing (attachmentUrls filtered to tool-returned URLs this turn, max 3) plus its field description. |
| 1026-1029 | STRUCTURED OUTPUT FIELDS: payment/checkout link bullets | skill `deposit-and-payment` | Behavior rules, not output fields. |
| 1030-1037 | DEPOSIT ELIGIBILITY RULE | skill `deposit-and-payment` | A one-line copy stays in core's Available Context (L1536). |
| 1038-1042 | DIRECT-FROM-CLINIC PRICE QUOTES | skill `discounts-and-quotes` | L1039 'routes to a human upstream': a request to match the quote escalates; a shared quote alone is answered as written. |
| 1043-1051 | FIRST-CONTACT INTRODUCTION | skill `intake` |  |
| 1052-1057 | INSTANT FORM AREA CONFIRMATION | skill `intake` |  |
| 1058-1067 | INFORMATION COLLECTION | skill `intake` |  |
| 1068-1100 | CONCERN REFLECTION | skill `intake` |  |
| 1101-1133 | IMAGE GUIDANCE | skill `images` |  |
| 1134-1169 | REVERSIBILITY | skill `reversibility` |  |
| 1170-1211 | TIME-BOUND PAUSE | skill `time-bound-pause` |  |
| 1212-1247 | WHAT MATTERS vs NICE TO HAVE | skill `packages-and-pricing` |  |
| 1248-1249 | STAGE-SPECIFIC BEHAVIOR (header) | deleted | DELETED (structural): code loads exactly one stage file, and each starts with its own `## <STATUS>` heading. |
| 1250-1255 | LEAD | stage `LEAD` |  |
| 1256-1263 | PREP_PRE_CLINICAL | stage `PREP_PRE_CLINICAL` |  |
| 1264-1307 | PRE_CLINICAL_SENT: intro, Step 0, Step 1, Step 2 | stage `PRE_CLINICAL_SENT` |  |
| 1308-1321 | PRE_CLINICAL_SENT: Step 3 — Payment | skill `deposit-and-payment` | Step 3 is cited by three stages (L1261, L1330, L1385) and a direct payment ask is answered at every stage, so it is a skill, not stage text. L1317 'routed to a person': requests to honor a claimed price/discount, hold a date or change a booking escalate; the slip-through reply stays. |
| 1322 | PRE_CLINICAL_SENT Step 3: no invented discounts | skill `discounts-and-quotes` |  |
| 1323-1325 | PRE_CLINICAL_SENT: Pacing | stage `PRE_CLINICAL_SENT` |  |
| 1326-1337 | MEETING_BOOKED / MEETING_COMPLETED (incl. CONSULTATION BOOKING CONFIRMATION) | stage `MEETING_BOOKED` | One file serves both statuses. Booking confirmation stays in the stage: it fires on a bare 'yes' to the booking intro, which carries no topic a router could classify. |
| 1338-1340 | MEETING_MISSED | stage `MEETING_MISSED` |  |
| 1341-1343 | WAITING | stage `WAITING` |  |
| 1344-1361 | IMAGE DELAY HANDLING | skill `images` |  |
| 1362-1368 | CONSULTATION RESCHEDULING | skill `consultation` |  |
| 1369-1386 | CLINIC STATUS TIERS | skill `clinics` |  |
| 1387-1396 | PRE-ASSESSMENT CLINIC AND PRICING ANSWERS | skill `packages-and-pricing` |  |
| 1397-1405 | TRAVEL READINESS | skill `travel` |  |
| 1406-1408 | PHONE CONTACT | skill `consultation` | L1407 'routed to a person': a request for any call other than the free consultation escalates; the slip-through reply stays. |
| 1409-1410 | TOOL USAGE: header, getPatientContextTool | core |  |
| 1411 | TOOL USAGE: getSavedClinicsTool | skill `clinics` | Each tool's usage line moves with the skill that offers the tool. |
| 1412 | TOOL USAGE: getClinicPackagesTool | skill `packages-and-pricing` |  |
| 1413 | TOOL USAGE: getClinicDoctorsTool | skill `clinics` |  |
| 1414 | TOOL USAGE: updateUserClinicPreferencesTool (selections) | stage `PRE_CLINICAL_SENT` | Clinic/package selection saving is Steps 1-2 of this stage. |
| 1415 | TOOL USAGE: tentative procedure dates | skill `scheduling` |  |
| 1416 | TOOL USAGE: getAllClinicsTool | skill `clinics` |  |
| 1417 | TOOL USAGE: getPatientImagesTool | skill `images` |  |
| 1418 | TOOL USAGE: getLatestAssessmentTool | skill `assessment` |  |
| 1419 | TOOL USAGE: getPaymentLinkTool | skill `deposit-and-payment` |  |
| 1420-1421 | TOOL USAGE: getConsultationRescheduleLinkTool, getFullCallsTool | skill `consultation` | The one listed call is the free consultation. |
| 1422-1424 | TOOL USAGE: prefer tool data, verify proactively | core |  |
| 1425-1426 | OPERATIONAL KNOWLEDGE header + 1. The Goal | stage `PRE_CLINICAL_SENT` | Item 1 is the PRE_CLINICAL_SENT funnel; RESPONSE MODE (core) already says other stages stay reactive. |
| 1427-1429 | OK 1 sub-bullets: no premature logistics, flight help, travel timing | skill `travel` |  |
| 1430 | OK 2. Procedure Areas and Clinics | skill `procedure` |  |
| 1431-1434 | OK 3. Assessment | skill `assessment` |  |
| 1435 | OK 4. Assessment Clinic Recommendations | skill `clinics` |  |
| 1436-1438 | OK 5. Scheduling | skill `scheduling` | L1436 'routed to a person': a request to verify specific open dates escalates; questions about how dates work are answered. |
| 1439 | OK 6. Payment & Deposits (deposit, methods, cash, refund, transfer) | skill `deposit-and-payment` |  |
| 1440 | OK 6: deposit paid in full, no deposit installments | skill `financing` | Answers instalment asks, which route to financing. |
| 1441 | OK 6: all payments through Doctours, balance due date | skill `deposit-and-payment` |  |
| 1442-1443 | OK 6: health insurance, CareCredit/Cherry pointers | skill `financing` |  |
| 1444 | OK 6: price lock | skill `deposit-and-payment` |  |
| 1445 | OK 6: Klarna account holder | skill `financing` |  |
| 1446-1449 | OK 6: two links (payment vs checkout) | skill `deposit-and-payment` |  |
| 1450-1451 | OK 6: remaining balance options, layaway | skill `financing` |  |
| 1452 | OK 7. Why Doctours | skill `clinics` |  |
| 1453-1455 | OK 8. Consultations | skill `consultation` |  |
| 1456 | OK 9. Pricing | skill `packages-and-pricing` |  |
| 1457-1460 | OK 10. Availability | skill `scheduling` |  |
| 1461 | OK 11. Platform Links (header line) | deleted | DELETED (structural): its seven links moved to the skills that send them (L1462-1468). |
| 1462 | OK 11: image upload link | skill `images` |  |
| 1463 | OK 11: assessment results link | skill `assessment` |  |
| 1464 | OK 11: clinic pages link | skill `clinics` |  |
| 1465-1466 | OK 11: payment and checkout links | skill `deposit-and-payment` |  |
| 1467-1470 | OK 11: consultation and reschedule links | skill `consultation` |  |
| 1471-1522 | WORKING_MEMORY_SYSTEM_INSTRUCTION, thread/date/identity lines, Patient Summary, Clinic flags | core | Per-patient context block. |
| 1523-1529 | ACTIVE PROMO OFFER | skill `discounts-and-quotes` | This is the no-promo variant (PROMO_OFFER is null). Production generates it per patient; it is kept verbatim. |
| 1530-1533 | Message Classification | deleted | DELETED: hardcoded 'Category: pricing / Confidence: high' on every message; the router's intent replaces it. |
| 1534-1554 | Available Context, Recent Calls, Recent Conversation, CRITICAL, Mastra NOTE | core | Per-patient context block. |

## Edits

### Rewritten lines (dead tools, E4)
The prompt names six tools the packet never defines. Every reference is removed or rewritten:

| Tool | Lines | What happened |
|------|-------|---------------|
| `getBookingPackageDetailsTool` | 963, 970 (and "both packages tools" in 971, "packages tools" in 973) | Rewritten to name `getClinicPackagesTool` only. |
| `getTripDetailsTool` | 977 | Bullet deleted. |
| `getTripRecommendationsTool` | 902 | Clause removed; example L950 (a trip link only this tool produces) deleted. |
| `searchAirportsTool` | 902 | Clause removed. |
| `updateFlightPreferencesTool` | 902 | Clause removed. |
| `updateUserAirportTool` | 902 | Clause removed. |

| Line | Why | Original text | Now |
|------|-----|---------------|-----|
| 902 | Removed the 'first-party flights after a deposit' exception: it names getTripRecommendationsTool, searchAirportsTool, updateUserAirportTool and updateFlightPreferencesTool (none exist) and the shareUrl/trip-page behavior only they produce. The pre-deposit flight sentence, which needs no tool, stays. | EXCEPTION — first-party flights after a deposit: you MAY help find and refine recommended flights via getTripRecommendationsTool, searchAirportsTool, updateUserAirportTool, and updateFlightPreferencesTool. Paste shareUrl whenever a tool returned it this turn, even if available/ok is false or offers are empty. Before purchase they can change filters on the page; after a one-seat ticket, if companionCanBuySameFlight is true, paste that same URL so a companion can buy those locked flights — they pay themselves, and you must not tell them to change People to 2. Never invent a /trip/ URL. Never say you could not load flight options when shareUrl is present. Never take card details — "book it for me" sends the tool link (or asks airport/qualifier if shareUrl is null). Never claim the trip page changed unless a write tool this turn returned ok and shareUrl. | (removed) |
| 963 | getBookingPackageDetailsTool does not exist; the pre-deposit packages tool is the only one. | (getClinicPackagesTool pre-deposit; getBookingPackageDetailsTool for booked patients) | (getClinicPackagesTool) |
| 970 | Same tool removed; 'both return' becomes 'it returns'. | call the packages tool for your stage (getClinicPackagesTool pre-deposit; getBookingPackageDetailsTool for booked patients): both return prices together with the clinic's currency | call the packages tool (getClinicPackagesTool): it returns prices together with the clinic's currency |
| 971 | 'both packages tools' meant getClinicPackagesTool + the nonexistent getBookingPackageDetailsTool. | both packages tools return an **aiContext** string | getClinicPackagesTool returns an **aiContext** string |
| 973 | 'packages tools' (plural) implied the nonexistent booked-tier tool. | packages tools return **standardHotels** | the packages tool returns **standardHotels** |
| 994 | E4: "nothing else" on the consultation example contradicted the graded consultation link (L759) when booking a new call is a real next step; see Rule conflicts. | gets the answer in one-to-three lines and nothing else — | gets the answer in one-to-three lines and nothing else (for the consultation, that answer includes its booking link only when booking a new call is a real next step: no consultation is scheduled and the patient hasn't said they don't want one; No repeated links still applies) — |

### Deleted lines

| Lines | Section | Reason |
|-------|---------|--------|
| 950 | BPG example: first-party trip link | shows a reply sending a /trip/ link, which only the nonexistent getTripRecommendationsTool produces; pre-deposit replies never send a trip link (L902). |
| 977 | PACKAGE & CLINIC FACTS: getTripDetailsTool.hotel | describes getTripDetailsTool, which does not exist. |
| 1248-1249 | STAGE-SPECIFIC BEHAVIOR (header) | (structural) code loads exactly one stage file, and each starts with its own `## <STATUS>` heading. |
| 1461 | OK 11. Platform Links (header line) | (structural) its seven links moved to the skills that send them (L1462-1468). |
| 1530-1533 | Message Classification | hardcoded 'Category: pricing / Confidence: high' on every message; the router's intent replaces it. |

### Moved to code (L1019-1025, STRUCTURED OUTPUT FIELDS)
The strict `json_schema` output format replaces "Your response is parsed as structured data" (L1019-1021). The
highEngagement, shouldFollowUp/followUpTiming and intent rules (L1022-1024) become the `description` of those schema
fields, verbatim (`DESCRIBED_REPLY_SCHEMA` in `src/prompts.ts`; L1023 covers two fields, so it is split at "Set
followUpTiming to"). Restructured mode only: baseline keeps its schema and the rules stay in its prompt. The attachmentUrls rule (L1025) becomes its field description plus post-processing: keep only URLs
a tool returned this turn, at most 3. The two payment-link bullets of that section (L1026-1027) are behavior rules,
not output fields, and went to `deposit-and-payment`.

### Exact duplicates
- L871, 916, 985, 1160, 1239 are the same line ("Contrastive examples — say the CORRECT version, never the BAD one:").
  Each heads a different example list, so all five stay, one per list (clinics, core, packages-and-pricing,
  reversibility, packages-and-pricing).
- L832 and L853 are the same `unknown` branch, once in HEALTH INSURANCE and once in CARECREDIT. Both stay in
  `financing`: each completes its own section's yes/no/unknown list.

### Text that is not from the original prompt
- Front matter on every prompt file. Values are JSON, so code can parse each one with `JSON.parse`.
- Headings of the form `# From <ORIGINAL SECTION>` above fragments moved out of a larger section, so a trace can
  name the section a rule came from.
- The ESCALATION section in core (new; the packet asks for it).
- `prompts/router.md` (new).
- Four completeness rules (E4), new text:
  - Core, CONVERSATION AWARENESS, after No repeated links (L883): "A page you point to comes with its link".
    A reply that points the patient to their assessment, the consultation booking page or a payment/checkout page
    includes that page's URL from its source. Asking how to use one of those pages, or whether they can, counts as
    asking for the link under L883; otherwise L883 stands. L1549 (repeat no URL) is read with L883's exception.
  - Stage `PRE_CLINICAL_SENT`, before Step 0: "Prices come with their deposit". A quoted package price comes with
    its `depositAmount` from the same tool result.
  - Stage `PRE_CLINICAL_SENT`, after it: "A clinic's price covers all its packages". Asked what a clinic costs (not
    one named package), the reply gives every package `getClinicPackagesTool` returns for it, and says so when there
    is only one.
  - Skill `consultation`, before CONSULTATION RESCHEDULING: "Answers about the consultation". An answer says it is
    a free phone call with the Doctours team (L1453-1455). The booking link (L1467) goes on the last line only when
    booking a new call is a real next step: no consultation is scheduled and the patient hasn't said they don't
    want one. Requests not to send a link and No repeated links still apply. Rescheduling still uses the tool's
    url (L1362-1368).
  - All say the added fact is part of the answer, so L994's one-to-three-line size and no-CTA rule still hold.

## Rule conflicts with a recorded winner
- **The seven "routed to a person" rules** (L913, L955, L980, L1039, L1317, L1407, L1436) describe an upstream
  handoff the old system did before the prompt ran. The router is now that step (SPEC decision 2026-10-03 23:55): a
  request for one of those actions escalates as `cannot_do`; a question about the policy is answered. Each rule's
  "if one slips through" reply stays verbatim in its skill. Core ESCALATION tells the reply model the same thing, so a
  request the router missed still escalates; the slip-through replies now cover questions, not requests.
- **Escalation vs "routing already happened"** (L914 "If you are writing a reply at all, routing already decided this
  turn is yours"): core ESCALATION wins for requests that need a person.
- **Holding a date** (L921's CORRECT reply declines in place): the packet (L7) names "contacting a clinic to hold a
  date" as an escalation, so a request to hold a date escalates. A question about how dates work is still answered.
- **Asking for the coordinator by name** is not a request for a person: the model is that coordinator (L1512).
- **VOICE bans handoff wording** (L877, and L769 bans channel-blaming): kept as is. Code writes the escalation
  sentence, so the model never writes handoff wording and the rule still holds for every word it does write.
- **Brevity and no repeated links vs the graded facts** (L994 "nothing else", L883 and L1549 no repeated URL, against
  the grading note L759, which requires the deposits, the assessment link and the consultation link): L759 wins,
  narrowly (packet defect 10). A reply that points to the assessment, the consultation booking page or a payment page
  carries its link under L883's request exception; a quoted price carries its deposit. An answer about the
  consultation says it is a free phone call with the Doctours team, with its booking link only when booking a new
  call is a real next step: no consultation is scheduled and the patient hasn't said they don't want one. Requests
  not to send a link and L883/L1549 still apply to consultation links. L994 is rewritten to agree (see Edits).
  Everywhere else L883, L994 and L1549 stand: a policy answer with no page to open carries no link.

## Conflicts left as found (recorded, not resolved)
- L902 ends "then give interim browse guidance"; L1428 says the flight-help line is the answer, "no need to name
  browse sites".
- WORKING_MEMORY_SYSTEM_INSTRUCTION says both "Do not remove empty sections - you must include the empty sections"
  and "only include fields you want to add or update" (L1501 vs L1505).

## Known defects kept verbatim
- Rules cite fields `getClinicPackagesTool` does not return in this packet: availableAddons, addons[], listPrice,
  standardHotels/upgradedHotels, preferredAirport, nearbyAirports, itinerary. The rules are conditional on the
  field, so they are inert here.
- L897 and L925 cite a "booking-documents deep link your prompt provides"; no prompt section provides one. It applies
  only to booked patients.
- L1509 hardcodes "Current Date/Time: September 27, 2026 at 07:37 PM UTC"; the packet's scenario depends on it, so it
  stays.
- The NOTE at L1551-1554 describes Mastra memory, which this system does not have. Its one actionable line (selection
  state comes from getPatientContextTool) is true.
- The prompt never states the consultation's length; nothing here invents one.
