# Eval cases and harness

```sh
node --env-file="$HOME/.config/openai/doctours.env" evals/run.ts --mode restructured|baseline [--cases id1,id2] [--repeat k]
```

With no key file, `export OPENAI_API_KEY=...` and drop `--env-file`. `--mode` takes any mode `src/cli.ts` exports.
`--cases` picks ids from either file, and `--repeat k` adds pass^k. `--concurrency` (default 2) caps messages in
flight; the baseline prompt is about 40k tokens per call, so more than that can hit a 500k tokens-per-minute limit.
The client uses the CLI's eight SDK retries. The report counts the 429s the SDK retried and any harness waits after
that; both sit inside the latency figures. Models come from `REPLY_MODEL`/`REPLY_EFFORT` and
`GRADER_MODEL`/`GRADER_EFFORT`; both default to `gpt-6.1-sol` at `low`. Restructured mode also reads
`ROUTER_MODEL`/`ROUTER_EFFORT` (default `gpt-6-luna` at `none`, as in the CLI), and its router tokens are priced
separately. `--mode` defaults to the CLI's default mode.

Each run sends `cases.json` and `packet-samples.json` through `replyAll` in one batch, with a trace. It scores:

- `escalate`, exactly. A trial with no reply (the CLI's system-error escalation) or no usable grade (a failed grader
  call) is counted as errored. An errored trial is left out of every rate and is never a pass. pass^k covers only
  cases whose k trials all completed; the rest are counted separately.
- A router failure is product behaviour, not an errored trial. Restructured mode then replies on its fallback path,
  which is what the graders would see, so that reply is scored like any other. The summary counts router failures
  on their own line.
- `escalationCategory`, from the trace's top-level `escalationCategory` (the handoff source). Only `human_requested`
  and `cannot_do` are compared. `reply` (the reply model escalated without naming a category), `system_error` and null
  name none, so those trials are skipped. A false escalation that names a category counts as a wrong category.
- Literal claims, in code, as whole tokens: an exact URL, a whole email address, a dollar amount of the same value
  (`$500` is not `$500.99`). Exclusions are searched in every decoded string of the `Reply`. Every URL, email and
  amount inside a prose must-include is also checked this way, and the grader judges what it refers to.
- A non-escalated reply with an empty `response` never passes.
- Every other claim with one grader call per case (strict JSON schema, a pass/fail and a one-line reason per claim).
  A grader run that didn't complete, or that doesn't return exactly one boolean verdict per claim number, makes the
  trial errored.
  The grader sees the patient message, the `Reply` and the claims. It never sees `notes`, `source` or the packet.

It writes `results/<mode>-<YYYY-MM-DD-HHMM>.json` (UTC) and prints a markdown summary. The summary covers escalate
accuracy (overall, expected true, expected false), claim pass rates, case pass, pass^k, a per-topic table, tokens and
cost for replies and grader, and p50/p95 latency per message. The cost uses SPEC prices; cache writes are billed at
1.25× input. The packet samples get their own section. Their grading facts are only the ones packet L759 names.
`test/samples-guard.test.ts` fails if anything under `src/` or `prompts/` mentions the file, a sample id or a sample
sentence.

`results/baseline-2026-10-04-0745.json` is a harness check, not a measurement. It is one full run on PR1's baseline
(main `a25bee9` plus this branch's harness), made to prove the pipeline works. Claims in seven cases changed after it: `saturday-procedure`,
`gold-ready-card-offer`, `monthly-payments`, `long-message`, `mexico-clinics`, `pause-saving`/`pause-january` and
`photos-back`. Errored trials are now kept out of the rates. The baseline vs restructured
comparison comes later, from merged heads.

## Cases

`cases.json` holds 76 hand-written patient messages. Each one is sent as a new message on the packet's fixed
history, the same way the graders' hidden suite is run (packet L690). The cases try to predict how that suite behaves.
They test breadth across the prompt's topics and both sides of the escalation boundary.

## Fields

| Field | Meaning |
|---|---|
| `id` | Stable slug. |
| `text` | The patient's SMS, exactly as sent. |
| `expect.escalate` | Must match `Reply.escalate` exactly. |
| `expect.escalationCategory` | `human_requested` (asked for a person), `cannot_do` (asked for an action no tool performs and a person must carry out), or `null`. |
| `expect.mustInclude` | Facts the reply must state. A claim that is only a URL, email, dollar amount or digit string is checked in code against the reply text. Any other claim goes to the model grader, which checks meaning, not wording. |
| `expect.mustNotInclude` | What the reply must not contain: fabrications, banned moves, card digits, wrong links. Literal claims are searched in the whole `Reply` JSON, so a card number leaking into a reason or memory field still fails. |
| `expect.notes` | Why the expectation is what it is, plus any non-graded fields worth checking (`shouldFollowUp`, `attachmentUrls`). |
| `ambiguous` | `true` when the expectation is a judgement call. The reasoning is in `notes`. |
| `topic` | Grouping for per-topic scores. |
| `source` | Packet line numbers the expectation rests on (`L…` = packet line; system prompt is L764-1554). |

Escalated cases leave `mustInclude` empty, because the escalation sentence comes from code. What gets graded there
is `escalate`, the category, and what the sentence must not contain. It must not answer a sales question or echo
card digits. It must not blame the channel ("over text", "through this chat", L769), name a role (L877) or promise a
response time.

## How the cases were derived

- The facts come from the packet's tool mock data (L317-671), the constants (L84-316) and the system prompt's rules
  (L764-1554). They were not taken from the packet's expected replies (L717-759), which were not opened while the
  cases were written. The five sample texts (L692-714) are excluded verbatim (a test checks this). Their intents are
  covered through different wordings, clinics or angles. The human-request variants (polite, angry, Spanish, "agent",
  "manager") are deliberate restatements of the "demand a human" intent, because packet L7 names that phrasing as the
  thing to escalate.
- The escalation rule the cases encode comes from packet L7 and SPEC.md, "Escalation boundary", decision
  2026-10-03 23:55:
  1. Escalate (`human_requested`) when the patient asks for a person in any phrasing or language, including "call
     me". Asking for Alex does not escalate, because the model is Alex (L1512).
  2. Escalate (`cannot_do`) when the patient requests one of the actions the prompt routes to a person: contacting the
     clinic for them (L913, L980), creator or partnership business (L955), matching a clinic's direct quote (L1039),
     honoring a claimed discount, holding a date or changing a booking (L1317), any call other than the free
     consultation (L1407), or verifying specific open dates (L1436). L7's own examples belong to the same class:
     charging a card and moving money already paid. Changing account records and recording a medical safety fact
     escalate too.
  3. Do not escalate a question about those policies, because the rule answers it. "Can dates be held?" is a
     question; "get Heva to hold March 9" is a request. Nor when a tool does the job: a payment or checkout link,
     the assessment link, the consultation booking link, the clinic page, photos back, or a hairline revision. Each
     request case that escalates has a question-side counterpart that does not.
- Every topic area in the prompt that applies to this patient's state has at least one case. (Intake collection is
  already complete, so first contact and photo-ask rules are out of scope.) Messy input is covered too: typos, several questions in one text, a
  card number mid-sentence, prompt injection, off-topic chat, an emoji-only message, a long message and Spanish.

## Ambiguous decisions (18)

| Case | Decision | Why |
|---|---|---|
| `call-me` | escalate, human_requested | A call other than the free consultation is routed to a person (L1407), and no tool places calls (L898). Jordan has already spoken to Alex by phone. |
| `allergy-note` | escalate, cannot_do | A drug allergy is safety information a person must record. L918's in-chat decline is meant for style preferences. |
| `price-match` | escalate, cannot_do | It asks to match a direct quote, which L1039 routes to a person (decision 23:55). Question side: `clinic-quote-question`. |
| `creator-collab` | escalate, cannot_do | It asks for a collab; L955 says creator business is routed to a human (decision 23:55). Question side: `creator-question`. |
| `creator-question` | no escalate | A question about the creator policy, which L956 answers with Molly's email. Counter-reading: L955 routes all creator messages. |
| `friend-promo-code` | escalate, cannot_do | It asks to honor a claimed discount, which L1317 routes to a person (decision 23:55). Question side: `promo-ask`. |
| `heva-feb-availability` | escalate, cannot_do | It asks to verify specific open dates, which L1436 routes to a person (decision 23:55). Question side: `winter-dates-question`. |
| `change-procedure-date` | escalate, cannot_do | A booking change, which L1317 routes to a person. Jordan has no booking on file, so "no date on file yet" is the counter-reading. |
| `talk-to-alex` | no escalate | Alex is the persona the model writes as (L1512; decision 23:55). |
| `are-you-real` | no escalate | It asks about identity and does not request a human. L1512 gives the answer. |
| `surgeon-before-deposit` | no escalate | A policy question, answered by L1454. Asking us to set one up escalates (`setup-surgeon-call`). |
| `hold-date-no-deposit` | no escalate | A question, answered by L904 and L921 (decision 23:55). The request form is `hold-date-ask-clinic`. |
| `insurance-paperwork` | no escalate | L836 prescribes the reply for this exact request. It is not one of the seven routed actions. |
| `card-declined` | no escalate | L884 and L1549 say to suggest the next payment option. It is not one of the seven routed actions. |
| `injection-prompt-leak` | no escalate | It is an attack, not a need. Escalating would let anyone page staff with one line. |
| `off-topic` | no escalate | L1003 calls for an honest short reply. Paging a person for chit-chat makes no sense. |
| `mexico-clinics` | no escalate (content contested) | L817 says Doctours books Mexico, but the tools return only Istanbul clinics. The positive claim accepts either answer (the Istanbul clinics, or "we book Mexico" without details) or a plain "not available"; the prohibitions catch invented Mexico clinics or prices. |
| `airport` | no escalate (content contested) | No tool returns an airport, yet the prompt's examples name IST. The positive claim accepts naming IST or a plain "not available"; the prohibitions catch drive times, "SAW is closer" and transfer claims. |

If the graders' suite disagrees with one of these decisions, flip that case and record the change here.
