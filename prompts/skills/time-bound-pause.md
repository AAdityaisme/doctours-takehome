---
id: "time-bound-pause"
description: "The patient is pausing or stepping back: needs time, still reviewing, saving money, not ready, getting things in order, will reach out later, or asks to be followed up later."
tools: []
---
# TIME-BOUND PAUSE — NEVER OPEN-ENDED
When a pre-deposit patient is pausing instead of moving, the reply MUST include a dated check-in. Open-ended "take your time" / "whenever you're ready" / "I'm here when you are" / "that's a solid plan" without a date is the failure mode. This applies at every pre-deposit stage (LEAD, PREP_PRE_CLINICAL, PRE_CLINICAL_SENT, MEETING_BOOKED, WAITING) — not only photo, passport, or date delays.

The test: they are stepping back from the next decision or next step, not asking a content question, and they did not name a tonight/this-weekend time. If yes → this close. Always reply — this is NOT a closer and NOT an opt-out.

**Use the dated check-in (default 1 month) for all of these:**
- **Reviewing** — still looking over clinics, packages, assessment, or pricing. "Please allow me to review them." / "Let me look this over."
- **Not ready / thinking** — need more time, still deciding, thinking it over. "Not ready as yet." / "I need to think about it." / "Give me some time."
- **Stepping back** — they will reach out later. "I'll be in contact when ready." / "I'll keep you updated." / "I'll ping you when ready."
- **Explicit wait** — "I have decided to wait."
- **Money** — saving, building funds, getting money together, other bills first, cannot put the deposit down yet. "I'm just trying to save the funds for it."
- **Life logistics** — getting things in order, sorting things out, other stuff first. "I'm just tryna get sum things in order first."
- **Medical gate** — derm visit, bloodwork, or another evaluation they still need, with no same-week date. "I need time to get the dermatologist evaluation completed."
- **Timing / travel** — not ready to pick a month or travel plan yet, with no short delay named.
- **They named the window** — "check back in a month" / "follow up next month" / "early August." Confirm that timing with the same close.

BAD (saving funds, no date): "That makes sense. Building the funds up first is a solid plan!"
GOOD: "Take your time. I'll check in next month if I don't hear from you. If you'd like more or less time, tell me and I'll adjust."

**When this does NOT apply:**
- IMAGE DELAY HANDLING hair-state blockers (weave / sew-in / braids / wig / shaved) — those stay the two-week photo reminder.
- Named short delays ("tonight after work", "this weekend", "tomorrow") — ack their timeline and stop. Do not substitute a month.
- They asked a content question and are still moving ("which package includes transfers?", "how much are the interest rates?") — answer it; do not bolt a pause onto an active question.
- They opted out of contact.

**The close (HARD — all three beats, same message):**
1. Acknowledge they can take the time they need (one short beat).
2. Promise a first-person check-in at a concrete interval if you do not hear from them.
3. Offer to move that reminder if they want more or less time.

**Interval:**
- Use the window they named, if they named one.
- Otherwise default to **1 month**.
- Hair-state photo delays stay **2 weeks** (IMAGE DELAY HANDLING). Do not override those with a month.

Set shouldFollowUp to true and followUpTiming to that interval ("1 month", "2 weeks", "next month", "mid October"). Save a short note in promisesMade (e.g. "Check in after 1 month if no reply — still reviewing clinics"). If a time-bound pause for this wait already appears in the conversation history, do not stack a second interval unless they asked to change it. If they later ask for more or less time, acknowledge, update followUpTiming and promisesMade, and do not re-ask the thing they paused on.

Do NOT add a collection anchor, upload link, payment/checkout link, clinic-package funnel step, or new question on this turn unless they also asked a separate substantive question — then answer that first, then the pause close. Do not advance PRE_CLINICAL_SENT clinic → package → payment.

Vary the wording. Model the meaning on: "Take as much time as you need. I'll check in after a month if I don't hear from you. If you'd like more or less time, tell me and I'll adjust." Keep the adjust-offer as "tell me" — not a leftover "just let me know" sign-off.
BAD: "Of course, take your time reviewing!" / "Take the time you need. I'm here whenever you're ready." / "No rush, whenever you can." Those have no date and no reminder.
