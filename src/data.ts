// Packet "Constants" (pre-deposit-respond-packet.md L87-314), verbatim except `export` and one type annotation.

export const PATIENT_SUMMARY = `- Tier: pre_deposit
- Name: Jordan Hale
- Sex: MALE
- Home country: US
- Klarna/PayPal financing available: yes
- Pipeline Status: PRE_CLINICAL_SENT
- Consultation: Not scheduled
- Procedure Interest: FUE
- Estimated Grafts: 2800
- Graft Range: 2500 - 3200 grafts
- Grafts (from measurement): 2800
- User ID: 7c2e1a40-6b8f-4d3a-9e15-2f0a8b6c4d11`;

export const CLINIC_FLAGS = `- Heva Clinic: Speciality=Afro Hair; Practice type=Doctor-assisted
- Dr. Hakan Clinic: Speciality=Hair Transplant; Practice type=Doctor-performed hairline`;

export const RECENT_CALLS = "- 2026-09-18T15:00:00.000Z: outbound, 1320s — Free consultation. Jordan wants a hairline procedure, mentioned 4C curls, and is comparing Istanbul clinics. Photos were requested after the call.";

export const CHAT_LIST = `[Sep 20, 10:02 AM] Alex: Amazing, love to hear that! My name is Alex and I'll be helping you throughout your hair transplant journey, from today all the way through your results 12 to 18 months from now. To start, which area are you looking to address first: hairline, crown, full top, beard, or eyebrow?
[Sep 20, 10:06 AM] Jordan Hale: Hairline. My edges have been receding for a few years.
[Sep 20, 10:07 AM] Alex: That's one of the most common things we help with. What's your name?
[Sep 20, 10:08 AM] Jordan Hale: Jordan Hale
[Sep 21, 9:15 AM] Alex: A receding hairline is one of the most common things we help with, and you're in the right place for it. Once I have your photos the team builds your assessment, which shows what your new hairline could look like plus a graft estimate. Can you upload Front, Top, Back, Left, and Right? When you're finished, just send done and I'll check it.
https://www.doctours.com/image-upload
[Sep 21, 11:40 AM] Jordan Hale: done
[Sep 21, 11:41 AM] Alex: Got them — all five angles are in. The medical team will send your assessment as soon as it's ready.
[Sep 24, 2:05 PM] Jordan Hale: Any update?
[Sep 25, 9:30 AM] Alex: Your assessment is ready. It has your graft estimate and the clinics we matched you with. You can open it using the link below.
https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333
[Sep 26, 8:12 AM] Jordan Hale: Got it
[Sep 26, 8:13 AM] Alex: Did any clinic catch your eye, or do you have questions about the plan?`;

export const RECENT_CONVERSATION_SUMMARY = `[Sep 20, 10:08 AM] Jordan Hale: Jordan Hale
[Sep 21, 9:15 AM] Alex: A receding hairline is one of the most common things we help with, and you're in the right place for it. Once I have your photos the team builds your assessment, which shows what your new hairline could look like plus a graft estimate. Can you upload Front, Top, Back, Left, and Right? When you're finished, just send done and I'll check it.
https://www.doctours.com/image-upload
[Sep 21, 11:40 AM] Jordan Hale: done
[Sep 21, 11:41 AM] Alex: Got them — all five angles are in. The medical team will send your assessment as soon as it's ready.
[Sep 24, 2:05 PM] Jordan Hale: Any update?
[Sep 25, 9:30 AM] Alex: Your assessment is ready. It has your graft estimate and the clinics we matched you with. You can open it using the link below.
https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333
[Sep 26, 8:12 AM] Jordan Hale: Got it
[Sep 26, 8:13 AM] Alex: Did any clinic catch your eye, or do you have questions about the plan?`;

export const TIER = "pre_deposit";

export const PATIENT_NAME = "Jordan Hale";

export const PROCEDURE_AREA = "hairline";

export const OPENER_TYPE = "operator_initiated";

export const PATIENT_EMAIL = "jordan.hale@example.invalid";

export const PATIENT_PHONE = "+15555550123";

export const PATIENT_COUNTRY_CODE = "US";

export const KLARNA_PAYPAL_FINANCING_ELIGIBLE = true;

export const PATIENT_SEX = "MALE";

export const PROMO_OFFER = null;

export const PIPELINE_STATUS = "PRE_CLINICAL_SENT";

export const CONSULTATION_TIME = null;

export const CONSULTATION_ID = null;

export const SELECTED_CLINIC = null;

export const HAS_ACTIVE_BOOKING = false;

export const BOOKINGS: unknown[] = [];

export const PROCEDURE_INTEREST = "FUE";

export const ESTIMATED_GRAFTS = 2800;

export const GRAFT_RANGE = {
  "max": 3200,
  "min": 2500
};

export const GRAFTS = 2800;

export const SAVED_CLINIC_COUNT = 2;

export const WEBSITE_INTAKE_QA = [
  {
    "answer": "Hairline",
    "question": "Which area are you most concerned about?"
  },
  {
    "answer": "4C",
    "question": "How would you describe your hair texture?"
  }
];

export const HAS_PATIENT_IMAGES = true;

export const PATIENT_IMAGE_COUNT = 5;

export const CHAT_KIND = "DIRECT";

export const COORDINATOR_DISPLAY_NAME = "Alex";

export const RECENT_MEDIA_CONVERSATION = [
  {
    "createdAt": "2026-09-20T14:02:00.000Z",
    "imageUrls": [],
    "role": "assistant",
    "sender": "Alex",
    "senderParticipantId": "88888888-8888-4888-8888-888888888882",
    "senderRole": "OPERATOR",
    "text": "Amazing, love to hear that! My name is Alex and I'll be helping you throughout your hair transplant journey, from today all the way through your results 12 to 18 months from now. To start, which area are you looking to address first: hairline, crown, full top, beard, or eyebrow?"
  },
  {
    "createdAt": "2026-09-20T14:06:00.000Z",
    "imageUrls": [],
    "role": "user",
    "sender": "Jordan Hale",
    "senderParticipantId": "88888888-8888-4888-8888-888888888881",
    "senderRole": "PATIENT",
    "text": "Hairline. My edges have been receding for a few years."
  },
  {
    "createdAt": "2026-09-20T14:07:00.000Z",
    "imageUrls": [],
    "role": "assistant",
    "sender": "Alex",
    "senderParticipantId": "88888888-8888-4888-8888-888888888882",
    "senderRole": "OPERATOR",
    "text": "That's one of the most common things we help with. What's your name?"
  },
  {
    "createdAt": "2026-09-20T14:08:00.000Z",
    "imageUrls": [],
    "role": "user",
    "sender": "Jordan Hale",
    "senderParticipantId": "88888888-8888-4888-8888-888888888881",
    "senderRole": "PATIENT",
    "text": "Jordan Hale"
  },
  {
    "createdAt": "2026-09-21T13:15:00.000Z",
    "imageUrls": [],
    "role": "assistant",
    "sender": "Alex",
    "senderParticipantId": "88888888-8888-4888-8888-888888888882",
    "senderRole": "OPERATOR",
    "text": "A receding hairline is one of the most common things we help with, and you're in the right place for it. Once I have your photos the team builds your assessment, which shows what your new hairline could look like plus a graft estimate. Can you upload Front, Top, Back, Left, and Right? When you're finished, just send done and I'll check it.\nhttps://www.doctours.com/image-upload"
  },
  {
    "createdAt": "2026-09-21T15:40:00.000Z",
    "imageUrls": [],
    "role": "user",
    "sender": "Jordan Hale",
    "senderParticipantId": "88888888-8888-4888-8888-888888888881",
    "senderRole": "PATIENT",
    "text": "done"
  },
  {
    "createdAt": "2026-09-21T15:41:00.000Z",
    "imageUrls": [],
    "role": "assistant",
    "sender": "Alex",
    "senderParticipantId": "88888888-8888-4888-8888-888888888882",
    "senderRole": "OPERATOR",
    "text": "Got them — all five angles are in. The medical team will send your assessment as soon as it's ready."
  },
  {
    "createdAt": "2026-09-24T18:05:00.000Z",
    "imageUrls": [],
    "role": "user",
    "sender": "Jordan Hale",
    "senderParticipantId": "88888888-8888-4888-8888-888888888881",
    "senderRole": "PATIENT",
    "text": "Any update?"
  },
  {
    "createdAt": "2026-09-25T13:30:00.000Z",
    "imageUrls": [],
    "role": "assistant",
    "sender": "Alex",
    "senderParticipantId": "88888888-8888-4888-8888-888888888882",
    "senderRole": "OPERATOR",
    "text": "Your assessment is ready. It has your graft estimate and the clinics we matched you with. You can open it using the link below.\nhttps://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333"
  },
  {
    "createdAt": "2026-09-26T12:12:00.000Z",
    "imageUrls": [],
    "role": "user",
    "sender": "Jordan Hale",
    "senderParticipantId": "88888888-8888-4888-8888-888888888881",
    "senderRole": "PATIENT",
    "text": "Got it"
  },
  {
    "createdAt": "2026-09-26T12:13:00.000Z",
    "imageUrls": [],
    "role": "assistant",
    "sender": "Alex",
    "senderParticipantId": "88888888-8888-4888-8888-888888888882",
    "senderRole": "OPERATOR",
    "text": "Did any clinic catch your eye, or do you have questions about the plan?"
  }
];

export const SENDER_PARTICIPANT_ID = "88888888-8888-4888-8888-888888888881";

export const SENDER_PARTICIPANT_ROLE = "PATIENT";

export const SENDER_DISPLAY_NAME = "Jordan Hale";

export const SENDER_USER_ID = "7c2e1a40-6b8f-4d3a-9e15-2f0a8b6c4d11";

export const THREAD_ID = "3a91c0de-11b2-4f77-8c44-90e2b7a15f03";

export const RESOURCE_ID = "7c2e1a40-6b8f-4d3a-9e15-2f0a8b6c4d11";

export const USER_ID = "7c2e1a40-6b8f-4d3a-9e15-2f0a8b6c4d11";

export const SUPABASE_CHAT_ID = "3a91c0de-11b2-4f77-8c44-90e2b7a15f03";

export const COLLECTION_STATUS = "area hairline; name on file; photos received. Asks so far -- area 1, name 1, photos 1 (budget 1 each). Last collection ask: 3 patient turn(s) ago. Everything is collected -- add NO anchor.";

export const WORKING_MEMORY = `{"collectionState":{"areaAskCount":1,"lastAskedItem":"photos","nameAskCount":1,"photoAskCount":1},"communicationStyle":"casual","escalationFlags":"none","keyConcerns":"receding hairline","patientName":"Jordan","preferredPaymentMethod":"unknown","procedureArea":"hairline","promisesMade":null,"targetProcedureWindow":"within_6_months"}`;
