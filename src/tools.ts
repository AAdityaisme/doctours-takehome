// Packet "Tools" (pre-deposit-respond-packet.md L322-670), verbatim except `export`.

export const HEVA_CLINIC_ID = "11111111-1111-4111-8111-111111111111";
export const HAKAN_CLINIC_ID = "22222222-2222-4222-8222-222222222222";

export const CLINICS = [
  {
    id: HEVA_CLINIC_ID,
    name: "Heva Clinic",
    slug: "heva",
    status: "ACTIVE",
    url: "https://www.doctours.com/clinic/heva",
    address: { city: "Istanbul", country: "TR" },
    clinic_flags: [
      { name: "Speciality", value: "Afro Hair" },
      { name: "Practice type", value: "Doctor-assisted" },
    ],
    ai_context: {
      bestFor: ["afro and textured hair", "hairline work"],
      patientFacingSummary: "Istanbul clinic for afro and textured hair.",
    },
  },
  {
    id: HAKAN_CLINIC_ID,
    name: "Dr. Hakan Clinic",
    slug: "dr-hakan",
    status: "ACTIVE",
    url: "https://www.doctours.com/clinic/dr-hakan",
    address: { city: "Istanbul", country: "TR" },
    clinic_flags: [
      { name: "Speciality", value: "Hair Transplant" },
      { name: "Practice type", value: "Doctor-performed hairline" },
    ],
    ai_context: {
      bestFor: ["hairline design"],
      patientFacingSummary: "Istanbul clinic where the doctor draws the hairline.",
    },
  },
];

export const DOCTORS = [
  {
    id: "99999999-9999-4999-8999-999999999991",
    clinicId: HEVA_CLINIC_ID,
    name: "Dr. Sibel",
    title: "Hair transplant surgeon",
  },
  {
    id: "99999999-9999-4999-8999-999999999992",
    clinicId: HAKAN_CLINIC_ID,
    name: "Dr. Hakan",
    title: "Hair transplant surgeon",
  },
];

export const PACKAGES = [
  {
    id: "44444444-4444-4444-8444-444444444441",
    clinicId: HEVA_CLINIC_ID,
    name: "Silver",
    basePrice: 3000,
    depositAmount: 500,
    currency: "USD",
    chargedPer: "FLAT",
    bookableWeekdays: ["MON", "TUE", "THU", "FRI"],
    aiContext: null,
    includedAddons: [
      { name: "Hotel", includedQuantity: 3, unitDescription: "night" },
    ],
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    clinicId: HEVA_CLINIC_ID,
    name: "Gold",
    basePrice: 4500,
    depositAmount: 600,
    currency: "USD",
    chargedPer: "FLAT",
    bookableWeekdays: ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
    aiContext: "The doctor makes every incision and extracts every graft.",
    includedAddons: [
      { name: "Hotel", includedQuantity: 4, unitDescription: "night" },
    ],
  },
  {
    id: "55555555-5555-4555-8555-555555555551",
    clinicId: HAKAN_CLINIC_ID,
    name: "Sapphire",
    basePrice: 3200,
    depositAmount: 500,
    currency: "USD",
    chargedPer: "FLAT",
    bookableWeekdays: ["MON", "TUE", "WED", "THU", "FRI"],
    aiContext: "The doctor draws the hairline.",
    includedAddons: [
      { name: "Hotel", includedQuantity: 3, unitDescription: "night" },
    ],
  },
];

export function findClinic(input: { clinicId?: string; clinicName?: string }) {
  if (input.clinicId) {
    return CLINICS.find((clinic) => clinic.id === input.clinicId) ?? null;
  }
  const name = input.clinicName?.trim().toLowerCase() ?? "";
  if (!name) return null;
  return (
    CLINICS.find((clinic) => clinic.name.toLowerCase() === name) ??
    CLINICS.find((clinic) => clinic.name.toLowerCase().includes(name)) ??
    CLINICS.find((clinic) => name.includes(clinic.name.toLowerCase())) ??
    null
  );
}

export function getAllClinics() {
  return { clinics: CLINICS };
}

export function getClinicDoctors(input: { clinicId?: string; clinicName?: string }) {
  const clinic = findClinic(input);
  if (!clinic) return null;
  return {
    clinicId: clinic.id,
    clinicName: clinic.name,
    doctors: DOCTORS.filter((doctor) => doctor.clinicId === clinic.id),
  };
}

export function getClinicPackages(input: { clinicId?: string; clinicName?: string }) {
  const clinic = findClinic(input);
  if (!clinic) return null;
  return {
    clinicName: clinic.name,
    clinic_flags: clinic.clinic_flags,
    currency: "USD",
    packages: PACKAGES.filter((pkg) => pkg.clinicId === clinic.id),
  };
}

export function getConsultationRescheduleLink(_input: { userId?: string }) {
  return {
    consultationTime: null,
    reason: "no_consultation_on_file",
    status: "no_consultation",
    url: null,
  };
}

export function getFullCalls(_input: { chatId?: string; limit?: number }) {
  return {
    calls: [
      {
        createdAt: "2026-09-18T15:00:00.000Z",
        direction: "outbound",
        duration: 1320,
        id: "66666666-6666-4666-8666-666666666666",
        recordingUrl: null,
        result: "completed",
        summary:
          "Free consultation. Jordan wants a hairline procedure, mentioned 4C curls, and is comparing Istanbul clinics. Photos were requested after the call.",
        transcript:
          "Alex: Thanks for hopping on. Jordan: I want to fix my hairline. My hair is 4C. Alex: We will need photos next, then the medical team builds the assessment.",
      },
    ],
    count: 1,
  };
}

export function getLatestAssessment(_input: { userId?: string }) {
  return {
    assessmentUrl:
      "https://www.doctours.com/assessment/c3d4e5f6-3333-4333-8333-333333333333",
    graftRange: { high: 3200, low: 2500 },
    hasAssessment: true,
    hasHairlineDrawing: true,
    shareStatus: "available",
    version: 1,
  };
}

export function getPatientContext(_input: { userId?: string }) {
  return {
    clinicSelectionPreferences: {
      budgetMax: null,
      excludedDestinations: null,
      preferredDestinations: null,
      selectedClinicId: null,
      selectedPackageId: null,
      softClinicInterestIds: null,
      softPackageInterestIds: null,
    },
    consultationTime: null,
    email: "jordan.hale@example.invalid",
    name: "Jordan Hale",
    phone: "+15555550123",
    pipelineStatus: "PRE_CLINICAL_SENT",
    tentativeProcedureDates: {
      strength: "medium",
      text: "within about 6 months",
    },
  };
}

export function getPatientImages(_input: { userId?: string }) {
  const userId = "7c2e1a40-6b8f-4d3a-9e15-2f0a8b6c4d11";
  const angle = (name: string) => ({
    uploaded: true,
    urls: [`https://assets.example.invalid/intake/${userId}/${name}.jpg`],
  });
  return {
    allAnglesUploaded: true,
    angles: {
      front: angle("front"),
      top: angle("top"),
      left: angle("left"),
      right: angle("right"),
      back: angle("back"),
    },
    hasImages: true,
    imageCount: 5,
    missingAngles: [],
    uploadedAngles: ["front", "top", "left", "right", "back"],
  };
}

export function getPaymentLink(input: {
  clinicPackageId?: string;
  type?: string;
  clinicId?: string;
}) {
  const pkg = PACKAGES.find((item) => item.id === input.clinicPackageId);
  if (input.type === "payment" && pkg) {
    const clinic = CLINICS.find((item) => item.id === pkg.clinicId);
    return {
      clinicId: pkg.clinicId,
      clinicName: clinic?.name ?? null,
      clinicPackageId: pkg.id,
      clinicPackageName: pkg.name,
      linkType: "payment",
      reason: null,
      status: "ready",
      url: `https://www.doctours.com/payment/${pkg.id}`,
    };
  }
  if (input.type === "checkout") {
    const clinic = CLINICS.find((item) => item.id === input.clinicId);
    if (!clinic) return null;
    return {
      clinicId: clinic.id,
      clinicName: clinic.name,
      clinicPackageId: null,
      clinicPackageName: null,
      linkType: "checkout",
      reason: null,
      status: "ready",
      url: `https://www.doctours.com/clinic/${clinic.slug}/checkout`,
    };
  }
  if (input.type === "payment") {
    return {
      clinicId: null,
      clinicName: null,
      clinicPackageId: null,
      clinicPackageName: null,
      linkType: "payment",
      reason: "missing_or_malformed_clinic_package_id",
      status: "missing_input",
      url: null,
    };
  }
  return null;
}

export function getSavedClinics(_input: { userId?: string }) {
  return {
    count: 2,
    recommendationStatus: "available",
    savedClinics: CLINICS.map((clinic, index) => ({
      clinic,
      clinicId: clinic.id,
      id:
        index === 0
          ? "77777777-7777-4777-8777-777777777771"
          : "77777777-7777-4777-8777-777777777772",
      ranking: index + 1,
    })),
  };
}

export function issuePromoCode(_input: { userId?: string }) {
  return {
    amount: null,
    code: null,
    endsAt: null,
    needs: null,
    paymentUrl: null,
    reason: "patient_not_on_sent_out_list",
    status: "not_on_list",
  };
}

export function updateUser(_input: {
  firstName?: string;
  lastName?: string;
  userId?: string;
}) {
  return {
    firstName: "Jordan",
    lastName: "Hale",
    reason: "name_already_set",
    updated: false,
  };
}

export function updateUserClinicPreferences(input: {
  clinicSelection?: Record<string, unknown>;
  userId?: string;
}) {
  const selectedClinicId = input.clinicSelection?.selectedClinicId;
  const selectedPackageId = input.clinicSelection?.selectedPackageId;
  const clinicOk =
    selectedClinicId == null ||
    CLINICS.some((clinic) => clinic.id === selectedClinicId);
  const packageOk =
    selectedPackageId == null ||
    PACKAGES.some((pkg) => pkg.id === selectedPackageId);
  if (!clinicOk || !packageOk) return null;
  return {
    clinicSelection: {
      budgetMax: null,
      excludedDestinations: [],
      preferredDestinations: [],
      selectedClinicId: selectedClinicId ?? null,
      selectedPackageId: selectedPackageId ?? null,
      softClinicInterestIds: [],
      softPackageInterestIds: [],
    },
    dropped: [],
    lockedReason: null,
    tentativeProcedureDates: {
      strength: "medium",
      text: "within about 6 months",
    },
    updated: true,
    userId: "7c2e1a40-6b8f-4d3a-9e15-2f0a8b6c4d11",
  };
}

export function updateWorkingMemory(_input: { memory?: Record<string, unknown> }) {
  return { success: true };
}

// ---- Everything below is ours: OpenAI function-tool definitions for the packet functions above. ----

/** One packet function exposed to the model under the name the system prompt uses (packet L319). */
export interface Tool {
  name: string;
  description: string;
  strict: boolean;
  parameters: Record<string, unknown>;
  run(input: Record<string, unknown>): unknown;
}

const nullableString = { type: ["string", "null"] };
const userId = { userId: nullableString };
const clinicRef = { clinicId: nullableString, clinicName: nullableString };

// Strict mode: every property listed in `required`, optional ones nullable, no extra keys.
const strict = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const TOOLS: Tool[] = [
  {
    name: "getAllClinicsTool",
    description: "List every clinic with id, name, slug, status, url, address, clinic_flags and ai_context.",
    strict: true,
    parameters: strict({}),
    run: getAllClinics,
  },
  {
    name: "getClinicDoctorsTool",
    description: "Doctors at one clinic. Pass clinicId or clinicName.",
    strict: true,
    parameters: strict(clinicRef),
    run: getClinicDoctors,
  },
  {
    name: "getClinicPackagesTool",
    description:
      "Packages for one clinic: price, deposit, currency, bookable weekdays, included add-ons. Pass clinicId or clinicName.",
    strict: true,
    parameters: strict(clinicRef),
    run: getClinicPackages,
  },
  {
    name: "getConsultationRescheduleLinkTool",
    description: "Trusted reschedule link for the patient's consultation call.",
    strict: true,
    parameters: strict(userId),
    run: getConsultationRescheduleLink,
  },
  {
    name: "getFullCallsTool",
    description: "Full records (summary and transcript) of the patient's recent calls.",
    strict: true,
    parameters: strict({ chatId: nullableString, limit: { type: ["integer", "null"] } }),
    run: getFullCalls,
  },
  {
    name: "getLatestAssessmentTool",
    description: "The patient's latest assessment: link, graft range and share status.",
    strict: true,
    parameters: strict(userId),
    run: getLatestAssessment,
  },
  {
    name: "getPatientContextTool",
    description:
      "Patient profile, pipeline status, clinic/package selection preferences and tentative procedure dates.",
    strict: true,
    parameters: strict(userId),
    run: getPatientContext,
  },
  {
    name: "getPatientImagesTool",
    description: "Which intake photo angles (front, top, left, right, back) the patient has uploaded.",
    strict: true,
    parameters: strict(userId),
    run: getPatientImages,
  },
  {
    name: "getPaymentLinkTool",
    description:
      'Trusted deposit link. type "payment" needs clinicPackageId; type "checkout" needs clinicId.',
    strict: true,
    parameters: strict({
      clinicPackageId: nullableString,
      type: { type: ["string", "null"], enum: ["payment", "checkout", null] },
      clinicId: nullableString,
    }),
    run: getPaymentLink,
  },
  {
    name: "getSavedClinicsTool",
    description: "Clinics recommended in the patient's assessment, ranked.",
    strict: true,
    parameters: strict(userId),
    run: getSavedClinics,
  },
  {
    name: "issuePromoCodeTool",
    description: "Issue the patient's promo code, if they are on a sent-out promo list.",
    strict: true,
    parameters: strict(userId),
    run: issuePromoCode,
  },
  {
    name: "updateUserTool",
    description: "Set the patient's first and last name.",
    strict: true,
    parameters: strict({ firstName: nullableString, lastName: nullableString, userId: nullableString }),
    run: updateUser,
  },
  {
    // Not strict: the packet types clinicSelection as Record<string, unknown>, which strict mode can't express.
    name: "updateUserClinicPreferencesTool",
    description:
      "Save the patient's clinic/package selection or soft interest, using canonical ids returned by the clinic/package tools.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        clinicSelection: {
          type: "object",
          properties: {
            selectedClinicId: nullableString,
            selectedPackageId: nullableString,
            softClinicInterestIds: { type: ["array", "null"], items: { type: "string" } },
            softPackageInterestIds: { type: ["array", "null"], items: { type: "string" } },
          },
        },
        // The prompt (L1415) tells the model to send this; the packet handler ignores it.
        tentativeProcedureDates: {
          type: "object",
          properties: { text: { type: "string" }, strength: { type: "string", enum: ["strong", "medium", "weak"] } },
        },
        userId: nullableString,
      },
    },
    run: updateUserClinicPreferences,
  },
  {
    // Not strict, same reason: memory is Record<string, unknown> in the packet.
    name: "updateWorkingMemoryTool",
    description: "Store the patient's working memory. Pass the entire JSON object.",
    strict: false,
    parameters: { type: "object", properties: { memory: { type: "object" } } },
    run: updateWorkingMemory,
  },
];

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

/**
 * Runs one model tool call and returns the JSON string sent back as `function_call_output`.
 * Null arguments are dropped first, so each packet function sees the optional fields its signature declares.
 */
export function runTool(name: string, argumentsJson: string): string {
  const tool = byName.get(name);
  if (!tool) return JSON.stringify({ error: `unknown tool ${name}` });
  const args = Object.fromEntries(
    Object.entries(JSON.parse(argumentsJson || "{}") as Record<string, unknown>).filter(([, v]) => v !== null),
  );
  return JSON.stringify(tool.run(args) ?? null);
}
