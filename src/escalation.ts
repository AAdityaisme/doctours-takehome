import type { Reply } from "./reply.ts";

// PLACEHOLDER until PR3 (escalation): one neutral sentence for every case. PR3 replaces it with
// per-category wording and decides what escalationReason may carry (it must never echo a card number).
export const HANDOFF_SENTENCE = "I'm passing this to a member of our team now.";

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
