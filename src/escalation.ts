import type { Reply } from "./reply.ts";

// PLACEHOLDER until PR3 (escalation): one neutral sentence and a code-set reason for every case.
// PR3 replaces both with per-category wording. Neither may ever echo what the patient sent (a card number).
export const HANDOFF_SENTENCE = "I'm passing this to a member of our team now.";

/** Why the router handed off (SPEC "Escalation boundary"). PR3 gives each category its own wording. */
export type EscalationCategory = "human_requested" | "cannot_do";

// Code-set reasons: the router's own reason is free text and stays in the trace, since it could echo a card number.
export const CATEGORY_REASONS: Record<EscalationCategory, string> = {
  human_requested: "patient asked for a person",
  cannot_do: "request needs a person",
};

/**
 * The whole reply when a person must take over: one short sentence, and nothing past the handoff
 * (no attachments, no follow-up, no memory writes).
 */
export function toEscalation(reason: string): Reply {
  return {
    response: HANDOFF_SENTENCE,
    escalate: true,
    escalationReason: reason,
    templateId: null,
    intent: "hand off to a person",
    shouldFollowUp: false,
    followUpTiming: null,
    attachmentUrls: null,
    highEngagement: false,
    workingMemoryUpdates: null,
  };
}
