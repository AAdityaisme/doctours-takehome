I split the hair-transplant SMS prompt into a core, patient stages, and skills selected for each message.
I added a router and a reply-model backstop for escalation; code writes the handoff and stops the turn.

| Metric | Dev: original, baseline x1 | Dev: this system, restructured x3 | Holdout: baseline x1 | Holdout: restructured x3 |
|---|---|---|---|---|
| Escalate accuracy, all | 89.7% (78/87) | 95.4% (249/261) | 86.7% (26/30) | 96.7% (87/90) |
| Escalate accuracy, should | 60.9% (14/23) | 100.0% (69/69) | 55.6% (5/9) | 100.0% (27/27) |
| Escalate accuracy, shouldn't | 100.0% (64/64) | 93.8% (180/192) | 100.0% (21/21) | 95.2% (60/63) |
| Claims passed | 94.6% (383/405) | 97.9% (1189/1215) | 97.1% (135/139) | 96.4% (402/417) |
| Cases fully passed | 78.2% (68/87) | 92.3% (241/261) | 80.0% (24/30) | 86.7% (78/90) |
| pass^3 | Not measured | 90.8% (79/87) | Not measured | 86.7% (26/30) |
| Batch p50 / p95 latency, ms | 18370 / 50530 | 8762 / 18331 | 17396 / 47332 | 9808 / 21910 |
| Batch cost per message, USD | $0.0149 | $0.0079 | $0.0139 | $0.0061 |

These are the final runs at `1c53e5066d3adab8b63acda7223d3dfaa565260f`: dev has 87 cases;
the blind holdout has 30. Both modes use `gpt-6.1-sol` at `low` for replies.
Restructured mode also uses `gpt-6-luna` at `none` for routing.
The holdout was written blind by a separate agent before tuning, its SHA-256 was recorded before any experiment,
and it was run once at the end as a final evaluation session, with baseline x1 and restructured x3.

On unseen cases, claims passed are about equal: baseline 97.1% (x1) and this system 96.4% (x3).
The gain is escalation: should-escalate is 5/9 against 27/27, and overall escalation is 86.7% against 96.7%.
The original prompt often answers or declines in place. It avoids false handoffs but misses required escalations.
This system catches every required escalation in these runs, at the cost of false handoffs on answerable messages.
That is why its should-not-escalate score is lower. I name every remaining false-handoff case below.

**Latency is an unequal comparison.** Baseline dev saw 237 rate-limit (429) responses and baseline holdout saw 73;
the restructured runs saw 0. The latency figures include retry waits and exclude grading.
They measure the whole batch, including the packet samples, so I do not claim a latency speedup from this comparison.

I compute cost per message from each JSON usage table: `(usage.reply.cost + usage.router.cost)` divided by
the number of message trials in that batch, including packet samples and repeats, rounded to four decimal places.
I use the unrounded stored costs and exclude the eval-only grader. The estimates use the harness's recorded
token prices, including cached input and cache writes.

The 5 packet samples are scored apart. They had the same scores in the dev and holdout batches:

| Packet-sample metric | Baseline x1 | Restructured x3 |
|---|---|---|
| Escalate accuracy, all / should / shouldn't | 80.0% (4/5) / 50.0% (1/2) / 100.0% (3/3) | 100.0% (15/15) / 100.0% (6/6) / 100.0% (9/9) |
| Claims passed | 65.0% (13/20) | 100.0% (60/60) |
| Cases fully passed | 20.0% (1/5) | 100.0% (15/15) |
| pass^3 | Not measured | 100.0% (5/5) |

Final artifacts: [baseline dev](evals/results/baseline-2026-10-05-0529.json),
[baseline holdout](evals/results/baseline-2026-10-05-0548.json),
[restructured dev](evals/results/restructured-2026-10-05-0554.json),
[restructured holdout](evals/results/restructured-2026-10-05-0619.json).

## How to run it

Prerequisites: Git, Node.js >=24 ([package.json](package.json)), and an OpenAI API key for the configured models.
Node runs these `.ts` files directly using built-in type stripping.

```sh
npm ci
export OPENAI_API_KEY="your-key"
```

Save this as `input.json`. It uses the packet's `HUMAN_MESSAGES` shape:

```json
[
  { "id": "demo", "text": "Which city is Heva Clinic in?" }
]
```

```sh
node src/cli.ts input.json > output.json
```

The output is a JSON array of [Reply](src/reply.ts) objects, in input order, one per message.
Messages are independent turns on the packet's fixed history in [src/data.ts](src/data.ts).
For stdin, omit the input argument or use `-`.

Instead of exporting the key, put `OPENAI_API_KEY=your-key` in a local env file and use Node's `--env-file`:

```sh
node --env-file=/path/to/local.env src/cli.ts input.json > output.json
```

Keep that file outside the repository. [src/cli.ts](src/cli.ts) accepts these defaults and overrides:

| Environment variable | Default | Controls |
|---|---|---|
| `ROUTER_MODEL` | `gpt-6-luna` | Router model, restructured mode only |
| `ROUTER_EFFORT` | `none` | Router reasoning effort |
| `REPLY_MODEL` | `gpt-6.1-sol` | Reply model, both modes |
| `REPLY_EFFORT` | `low` | Reply reasoning effort |
| `CONCURRENCY` | `2` | Positive integer limiting messages in flight |

For the original prompt, add `--mode baseline`. The default is `--mode restructured`.
For a trace, add `--trace` with a file path:

```sh
node src/cli.ts --trace trace.jsonl input.json > output.json
```

That writes a JSON line per completed message, with its input index, router decision, loaded skills, tools,
tokens, cached tokens, and latency. Errors go to stderr; stdout holds only the reply array. The trace file is overwritten at the start.

Offline checks and live evals:

```sh
npm run typecheck && npm test
node evals/run.ts --mode baseline --repeat 1
node evals/run.ts --mode restructured --repeat 3
node evals/run.ts --mode restructured --cases-file ./holdout.json --repeat 3
```

Live evals need the key. `--cases-file` paths resolve relative to `evals/run.ts`.
`--cases` selects comma-separated case IDs; `--concurrency` controls eval concurrency.
The eval grader defaults to `gpt-6.1-sol` at `low`, overridden by `GRADER_MODEL` and `GRADER_EFFORT`.
The harness writes artifacts under [evals/results](evals/results) and prints a Markdown report.
See [evals/README.md](evals/README.md) for scoring and router-only evals.

## What I built and why

I use the Responses API and a small TypeScript tool loop. I chose no agent framework because the deliverable
is a batch command with a narrow contract. This keeps installation and the execution path easy to inspect.

| Step per message | Implementation | Why |
|---|---|---|
| Route intent, skills, and escalation | [src/router.ts](src/router.ts), [prompts/router.md](prompts/router.md) | A cheap classifier selects the topic rules and can hand off before paying for a reply. |
| Assemble core + stage + selected skills | [src/prompts.ts](src/prompts.ts), [src/restructured.ts](src/restructured.ts) | Code selects the stage from `PIPELINE_STATUS`, fills constants, and rejects unfilled placeholders. |
| Reply with tools | [src/respond.ts](src/respond.ts), [src/tools.ts](src/tools.ts) | The model looks up facts and can call `loadSkill` when another rule is needed. Code also enforces the allowed tool list. |
| Validate and normalize the output | [src/reply.ts](src/reply.ts) | Code sets `templateId` to null, moves URLs to the end, and filters attachments to URLs returned by tools this turn. |
| Write a handoff and stop | [src/escalation.ts](src/escalation.ts) | The patient receives one code-written sentence, with no continued answer or echoed payment details. |

The router's intent becomes `Reply.intent` when routing succeeds. A router handoff skips the reply call.
A reply-model handoff stops the loop before any tools returned alongside that handoff run.
[src/cli.ts](src/cli.ts) preserves batch order and lets the other messages finish if one turn fails.

## What stays loaded on every turn

Every reply turn loads [core](prompts/core.md) and the [stage file](prompts/stages) for `PIPELINE_STATUS`.
Core contains identity, voice, grounding, escalation, and patient context.
The stage governs what the coordinator may do at that point in the patient journey.
An early router handoff needs neither a reply prompt nor a reply call.

The router selects [skills](prompts/skills) per message from their descriptions.
Code adds `intake` when collection is outstanding or this is first contact.
Code offers the promo tool only when `PROMO_OFFER` is set.
The reply model can load an omitted skill; its instructions and tools become available in the loop and are traced.

Sizes from [docs/prompt-map.md](docs/prompt-map.md), before filling placeholders and without front matter:

| Instructions | Characters | Approximate tokens |
|---|---|---|
| Original prompt | 164,678 | ~41,169 |
| Core alone | 39,965 | ~9,991 |
| Core + largest stage (`PRE_CLINICAL_SENT`) + two largest skills (`financing`, `packages-and-pricing`) | 80,185 | ~20,046 |

These file-size estimates precede API usage and do not cap a message needing more skills.
Filling placeholders adds the same patient values to both modes. The core is still large.

E3 puts the fixed tool definitions and core + stage before the message-specific skills.
I mark an explicit cache breakpoint after that prefix and key the cache by stage.
`allowed_tools` narrows what can run without changing the tool definitions sent to the API.
Matching prefixes can be read from cache across the batch and later tool rounds. Caching reduces billed input work;
it does not remove the instructions from the model's context. [test/cache.test.ts](test/cache.test.ts) checks the prefix.

## How escalation works

I follow packet L7: a request for a human, or work no tool and no rule can perform, needs a person.
I treat the prompt's seven upstream routing rules as the boundary:

| Packet line | Human-owned request |
|---|---|
| L913 | Contact the clinic on the patient's behalf |
| L955 | Take on creator or partnership business |
| L980 | Reach the clinic, or a repeated request for its contact details |
| L1039 | Match a clinic's direct quote |
| L1317 | Honor a claimed discount, hold a date without payment, or change a booking |
| L1407 | Arrange a call other than the self-booked free consultation |
| L1436 | Verify specific open procedure dates |

A request to do the action escalates. A question about the policy gets an answer, even when the answer is no.
Asking for the named coordinator does not escalate: the packet has the model reply as that coordinator.
Payment links, consultation booking/rescheduling, and package facts remain automated work.
These boundary decisions include judgment calls; [evals/README.md](evals/README.md) records the alternatives.

The router decides first, as `human_requested` or `cannot_do`. The reply model is the backstop if the router misses.
It also distinguishes a prescribed policy refusal from a task a person could do, and escalates requests to update
medical safety information. A passing mention of a medical fact does not itself request a record update.

Code writes the handoff sentence and clears attachments, follow-up, and reply memory updates.
A failed reply turn hands off as `system_error` after retries. A router failure instead falls back to a reply with
core + stage + rule skills and `loadSkill` available. It does not automatically page a person.

`Reply.escalate` flags takeover; `Reply.escalationReason` carries the code-set reason.
There is no category field in `Reply`. The trace's `escalationCategory` carries `human_requested`, `cannot_do`,
`reply`, or `system_error`; `reply` means the backstop escalated without classifying the request.
The trace retains the router's more specific reason. [test/escalation.test.ts](test/escalation.test.ts)
and [test/restructured.test.ts](test/restructured.test.ts) cover these paths.

## The eight problems in the assignment

| Problem | What I changed | Evidence and boundary |
|---|---|---|
| 1. Unneeded rules crowd context | I load topic skills per message. | [Prompt sizes](docs/prompt-map.md); this shows fewer instructions, not a measured attention effect. |
| 2. A trace cannot locate a bad reply | I trace routing, skills, dynamic loads, and tools. | [Restructured trace tests](test/restructured.test.ts); this shows what was available, not which instruction caused a model decision. |
| 3. Another care line competes with hair rules | I separated stages and topic files. | [Prompt assembler](src/prompts.ts); only partly addressed. Core and the router remain hair-specific; no second care line is implemented or measured. |
| 4. A subtask has nowhere to go | I expose full call records as a tool. | [Consultation skill](prompts/skills/consultation.md), [tools](src/tools.ts). I did not add a subagent. Keeping one SMS turn local is a judgment call; bulk call-log inspection is where I would add one. |
| 5. Every message pays for the full prompt | I select skills, cache the stable prefix, and skip replies on early handoffs. | [Cache tests](test/cache.test.ts) and the final batch costs above. Latency causality is unresolved because of baseline rate limits. |
| 6. A small policy edit affects unrelated replies | I put topic rules in their own files. | [Skills](prompts/skills), [assembly tests](test/restructured.test.ts). Core edits still affect every reply; I have not measured the blast radius of arbitrary edits. |
| 7. Conflicts have no recorded winner | I record precedence and enforce output rules in code. | [Prompt map and conflicts](docs/prompt-map.md), [map tests](test/prompt-map.test.ts), and the decisions below. |
| 8. Behaviors cannot be tested separately | I separate routing, schema, handoff, and factual checks. | [Router eval](evals/router.ts), [scorer](evals/score.ts), [reply tests](test/reply.test.ts), and per-topic final summaries. |

## How I measured and built it

I compare the original [baseline prompt](baseline/system-prompt.md), filled with the packet constants, against the
restructured mode in the same harness. Both use the same tools, reply schema, and post-processing.
The baseline receives the original instructions; it has no new router or escalation prompt.

The dev set is hand-written and covers topics, request/question pairs, and messy input on the fixed patient history.
The packet samples are a separate smoke test. Their expected replies never enter application prompts or code.
[test/samples-guard.test.ts](test/samples-guard.test.ts) guards against sample references in `src/` and `prompts/`.

The harness checks escalation exactly. It checks URLs, emails, amounts, and digit strings literally, including
embedded literals in prose claims. Exclusions search every decoded string in `Reply`, not just `response`.
A `gpt-6.1-sol` grader at `low` judges the remaining claims by meaning; it sees the message, reply, and claims only.
A case fully passes only if escalation, any scored category, and every claim pass; a non-escalated answer must be nonempty.
`pass^k` is the fraction of cases that pass all repeated trials, not the average trial pass rate.
Errored trials are excluded from rates and reported separately; the final runs have 0.
Model grading can miss omissions or disagree with a short answer. It is evidence against these checks, not a safety proof.

The holdout hash is `a96df30a97f2721824be86153dc975a295e71df4c6f10f0058c1a14f99960c58`.
It was checked before the final run. The writer did not see dev messages or failures, but did see the eval README's
topic list and ambiguous case IDs. Its wording and facts are independent; its topic coverage overlaps.
The holdout has shape checks but lacks some handoff-wording checks present in dev; offline tests cover those rules.

I built through pull requests. Each change had a measured before/after screen, an independent Codex review,
and Greptile review. Review rejected some apparent gains and required fixes before merge.
The final table comes only from merged main. The following are **branch screens**, not final results.
They use `gpt-6-luna` at `none` for routing and `gpt-6.1-sol` at `low` for replies where a reply is measured.

| Shipped experiment | Change and measured branch-screen effect |
|---|---|
| E1: router precision V4 | Principle only: a request to act differs from a policy question. Router-only x3 false positives were 3, 4, 4 versus V0's 6, 5, 5; false negatives were 1, 1, 1. The missed cases escalated end to end in 9/9 trials. |
| E2: reply escalation scope | A specific prescribed refusal wins over a general capability limit. In x3 screens, assessment-note changed from 3/3 escalated to 3/3 answered; insurance-paperwork stayed 3/3 answered, allergy-note stayed 3/3 escalated, and medical-mention probes stayed 12/12 answered. |
| E3: cache prefix | Fixed definitions, core + stage prefix, and a loaded-skill list. Full dev x1 reply cost went from $1.27 to $0.61; claims were 95.1% against 95.7%, with 93% of reply input read from cache. |
| E4: completeness | Prices carry deposits; pages carry links; consultation answers keep their facts. The initial x3 completeness screen went from 9/30 to 30/30. After review fixes, the expanded set passed 33/33 and the fact samples 9/9. |

E4's consultation and all-packages rules were written after seeing sample failures, so those samples are not
independent evidence. Review tightened the checks and stopped booking links going to booked or declining patients.
The holdout is the check on unseen cases, and it shows no overall claims gain.

**What did not ship:** E1 V2's router illustrations. Review found they mirrored dev cases with changed entities;
class descriptions in the next attempt still mirrored those failures. I removed every illustration.
V4 shipped under an acceptance rule recorded before its screen: fewer router false positives than V0,
and every router miss still caught end to end. I do not claim V2's apparent gain.

## Contradictions I found in the packet

These are packet line numbers. I verified the cited rules and tool data, and recorded the implementation decisions
in [docs/prompt-map.md](docs/prompt-map.md). Some contradictions remain in the moved text.

| Defect | Conflict and which rule won |
|---|---|
| 1. Escalation versus decline scripts | L7 requires takeover for unperformable actions; L775, L902, and L921 give in-place limits or declines for refunds, cards, and date holds. I follow L7 for an action request; policy questions still get the rule. |
| 2. Routing versus slip-through replies | L913, L955, L980, L1039, L1317, L1407, and L1436 describe upstream human routing, while L914 and the fallbacks keep answering. I made the router that upstream step: requests hand off, questions keep their prescribed replies. This is a recorded interpretation. |
| 3. Voice versus a real handoff | L877 bans another Doctours person taking over; L769 forbids channel excuses and unsupported promises. L7 wins for takeover. Code writes a first-person sentence, naming no role and promising no timing. |
| 4. The clinic URL means different things | L331/L347 return Doctours pages; L867/L868 and L1416 call `url` an independent clinic website. I use the returned URL without inventing a separate domain. The mock cannot supply the independent site. |
| 5. The incision list names missing products | L981 names Heva VIP and MetropolMED; the catalog at L375-418 has neither. L399 gives Gold's doctor involvement. I follow package `aiContext` when present, per L971, and do not invent missing packages. |
| 6. Examples disagree with the catalog | L1041 asserts transfers; L1395 invents a price range; L989/L1519 name extra tiers; L1459 names an absent package; L1404 offers Miami. Fresh tool facts and L963/L967 grounding win. These examples remain as text, not catalog data. |
| 7. Documented package fields are absent | L963-977, L1412, and L1429 refer to airports, hotel lists, optional add-ons, list prices, and itinerary fields absent from L375-418/L448-456. The returned data wins. Missing details stay unknown; dead-tool references are removed as mapped. |
| 8. Patient chronology and phone capability disagree | L103/L472-481 record an earlier call, but L105 starts with a first-contact intro. I preserve the history. L1045's no-repeat-introduction rule and L898's current calling limit win for the next turn; a past call does not give the agent a calling tool. |
| 9. Photos can supposedly follow later | L896 allows remaining photos to follow after a reply, while L896/L912 ban future content promises. L83's current-turn attachment restriction wins in code. The inconsistent wording remains in the prompt; no future send is implemented. |
| 10. Brevity and link repetition omit graded facts | L883/L1549 suppress repeated links and L994 asks for an answer alone; L759 requires deposits and assessment/consultation links. I follow L759 narrowly through E4's deposit and page-link rules. Consultation links still respect booking state, refusal, and no-repeat rules. |

## Known limitations and what I would do next

The router can still escalate requests with their own prescribed policy refusal, including insurance paperwork
and financing enrollment (L836/L858). It decides before the reply model sees that refusal.
I would test a router decision to defer these classes to the reply model against new request/question pairs.

Every final false handoff came from the router. The repeated errors are clinic-contact, card-talk, and surgeon-contact
over-firing; identity and creator-policy questions also over-fired on dev. These are case IDs and counts, not patient texts:

| Set | False-handoff case | Trials handed off incorrectly |
|---|---|---|
| Dev x3 | `heva-whatsapp` | 3/3 |
| Dev x3 | `gold-ready-card-offer` | 3/3 |
| Dev x3 | `surgeon-before-deposit` | 3/3 |
| Dev x3 | `are-you-real` | 2/3 |
| Dev x3 | `creator-question` | 1/3 |
| Holdout x3 | `h-website-contact-heva` | 3/3 |

I would first reduce early false handoffs, since a router false positive skips the reply model's chance to correct it.
Other final failures include omitted financing mechanics on dev. Holdout failures include a clinic-specialty omission,
an unnecessary clarification about surgeon involvement, and an omitted cash-pay fact. These need new independent
checks before another change; I would not write a rule around a holdout sentence.

The holdout is small and uses the fixed patient state. Repeats measure consistency on those cases.
I would collect new histories and stage transitions, and keep a new blind set for tuning.
I would add a CI assertion for the recorded holdout SHA-256; today's CI validates its shape but does not lock its hash.

The tools are the packet's mocks. Writes do not persist across turns, and `escalate: true` is an output signal,
not a connected staff queue. The documented assessment-revision and follow-up workflows are assumed, not implemented.
Before product use I would connect real tools and a staff queue, verify those workflow contracts, and redact sensitive
trace fields. A second care line and bulk call-log delegation would then need their own prompts and measurements.
