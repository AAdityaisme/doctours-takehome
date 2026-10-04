import type { Reply } from "./reply.ts";

/** Why the router handed off (SPEC "Escalation boundary"). */
export type EscalationCategory = "human_requested" | "cannot_do";

/** Every source of a handoff; this is the trace's `escalationCategory`. */
export type Handoff = EscalationCategory | "reply" | "system_error";

// One short first-person sentence per source, written by code (SPEC "Escalation boundary"). It says a person is taking
// over (knowingly past L877's handoff ban, since a handoff now exists), names no role, never blames the channel
// (L769), promises no timing and never echoes the patient. The reply model's own escalation and the fail-safe don't
// know which kind of request it was, so they share a neutral sentence.
const NEUTRAL = "I'm handing this over to a person who can take care of it.";

/** The sentence and the code-set `escalationReason` for each handoff source. */
export const HANDOFFS: Record<Handoff, { sentence: string; reason: string }> = {
  human_requested: { sentence: "Of course, I'm handing this over to a person.", reason: "patient asked for a person" },
  cannot_do: {
    sentence: "That isn't something I can do myself, so I'm handing it over to a person.",
    reason: "needs a person to act",
  },
  reply: { sentence: NEUTRAL, reason: "needs a person" },
  system_error: { sentence: NEUTRAL, reason: "system error" },
};

/**
 * The whole reply when a person must take over: one short sentence, and nothing past the handoff
 * (no attachments, no follow-up, no memory writes).
 */
export function toEscalation(handoff: Handoff): Reply {
  return {
    response: HANDOFFS[handoff].sentence,
    escalate: true,
    escalationReason: HANDOFFS[handoff].reason,
    templateId: null,
    intent: "hand off to a person",
    shouldFollowUp: false,
    followUpTiming: null,
    attachmentUrls: null,
    highEngagement: false,
    workingMemoryUpdates: null,
  };
}
