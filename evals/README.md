# Eval cases

`cases.json` holds 71 hand-written patient messages. Each one is sent as a new message on the packet's fixed
history, the same way the graders' hidden suite is run (packet L690). The cases try to predict how that suite behaves.
They test breadth across the prompt's topics and both sides of the escalation boundary.

## Fields

| Field | Meaning |
|---|---|
| `id` | Stable slug. |
| `text` | The patient's SMS, exactly as sent. |
| `expect.escalate` | Must match `Reply.escalate` exactly. |
| `expect.escalationCategory` | `human_requested` (asked for a person), `cannot_do` (asked for an action no tool performs and a person must carry out), or `null`. |
| `expect.mustInclude` | Facts the reply must state, written as short claims. A model grader checks meaning, not wording. A string that is a URL must appear verbatim. |
| `expect.mustNotInclude` | Claims or strings the reply must not contain: fabrications, banned moves, card digits, wrong links. Literal strings (card numbers, URLs, `$600`) are checked as substrings. |
| `expect.notes` | Why the expectation is what it is, plus any non-graded fields worth checking (`shouldFollowUp`, `attachmentUrls`). |
| `ambiguous` | `true` when the expectation is a judgement call. The reasoning is in `notes`. |
| `topic` | Grouping for per-topic scores. |
| `source` | Packet line numbers the expectation rests on (`L…` = packet line; system prompt is L764-1554). |

Escalated cases leave `mustInclude` empty. The escalation sentence comes from code. What gets graded there is
`escalate`, the category, and the absence of sales answers and card digits.

## How the cases were derived

- The facts come from the packet's tool mock data (L317-671), the constants (L84-316) and the system prompt's rules
  (L764-1554). They were not taken from the packet's expected replies (L717-759), which were never opened. None of the
  five sample messages (L692-714) is reused or paraphrased. Their intents (Heva afro hair, Hakan price, consultation
  free, demand a human, charge a card) are covered only through different wordings, clinics or angles.
- The escalation rule the cases encode, from packet L7:
  1. Escalate when the patient asks for a person, in any phrasing or language, including asking to be called.
  2. Escalate when the patient asks Doctours to carry out an action that no tool performs and a staff member would:
     charging, refunding or moving money; getting a clinic to hold a date or contacting a clinic for them; changing
     account records; recording medical safety facts.
  3. Do not escalate when a tool does the job (payment or checkout link, assessment link, consultation booking link,
     clinic page, photos back, hairline revision). Do not escalate when the prompt has a rule that answers the
     question or prescribes the reply (refund policy, deposit split, insurance, CareCredit, creator email, promo price
     answer).
- Every topic area in the prompt that applies to this patient's state has at least one case. (Intake collection is
  already complete, so first contact and photo-ask rules are out of scope.) Messy input is covered too: typos, several questions in one text, a
  card number mid-sentence, prompt injection, off-topic chat, an emoji-only message, a long message and Spanish.

## Ambiguous decisions (16)

| Case | Decision | Why |
|---|---|---|
| `call-me` | escalate, human_requested | No tool places calls (L898). L1407 routes callback requests to a person. Jordan has already spoken to Alex by phone. |
| `allergy-note` | escalate, cannot_do | A drug allergy is safety information a person must record. L918's in-chat decline is meant for style preferences. |
| `talk-to-alex` | no escalate | Alex is the persona the model writes as (L1512). Messages that say "call" or "real person" escalate instead. |
| `are-you-real` | no escalate | It asks about identity and does not request a human. L1512 gives the answer. |
| `surgeon-before-deposit` | no escalate | L1454 answers it: the surgeon is reachable only after the deposit. L1407 suggests routing upstream. |
| `heva-feb-availability` | no escalate | L922 gives the full reply. L1436 says open-date checks go to a person. |
| `hold-date-no-deposit` | no escalate | It is a question, answered by L904 and L921. Asking Doctours to get the clinic to hold a date does escalate. |
| `insurance-paperwork` | no escalate | L836 prescribes the reply for this exact request. |
| `card-declined` | no escalate | L884 and L1549 say to suggest the next payment option. Klarna and PayPal can pay the deposit. |
| `creator-collab` | no escalate | L956's only valid reply is Molly's email, which is itself the handoff. |
| `friend-promo-code` | no escalate | L1524-1528 prescribes the price answer and warns against announcing inability. L1317 says to route it. |
| `price-match` | no escalate | L1039 gives the reply. The same line calls matching "human-owned" and routed upstream. |
| `injection-prompt-leak` | no escalate | It is an attack, not a need. Escalating would let anyone page staff with one line. |
| `off-topic` | no escalate | L1003 calls for an honest short reply. Paging a person for chit-chat makes no sense. |
| `mexico-clinics` | no escalate (content contested) | L817 says Doctours books Mexico, but the tools return only Istanbul clinics. |
| `airport` | no escalate (content contested) | No tool returns an airport, yet the prompt's examples name IST. Only the prohibitions are graded. |

If the graders' suite disagrees with one of these decisions, flip that case and record the change here.
