import { stableId, sha256Hex } from "./ids.js";

const IDENTITY_TYPES = new Set(["control_email", "control_phone", "control_fullname", "control_address"]);
const FILE_TYPES = new Set(["control_fileupload"]);

function cleanText(value, max = 100_000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function normaliseValue(value, depth = 0) {
  if (value === null || value === undefined) return null;
  if (depth > 5) return cleanText(value, 2000);
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => normaliseValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, item]) => [cleanText(key, 100), normaliseValue(item, depth + 1)])
    );
  }
  return cleanText(value);
}

function displayValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return cleanText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.values(value).map(displayValue).filter(Boolean).join(" ");
  }
  return cleanText(value);
}

function semantic(answer) {
  return `${answer.name || ""} ${answer.label || ""} ${answer.type || ""}`.toLowerCase();
}

export function normaliseJotformAnswers(submission) {
  const source = submission?.answers;
  if (!source || typeof source !== "object" || Array.isArray(source)) return [];
  return Object.entries(source)
    .map(([questionId, answer]) => ({
      questionId: cleanText(questionId, 50),
      name: cleanText(answer?.name, 200) || null,
      label: cleanText(answer?.text, 500) || null,
      type: cleanText(answer?.type, 100).toLowerCase() || null,
      value: normaliseValue(answer?.answer ?? answer?.prettyFormat ?? null),
    }))
    .filter((answer) => answer.questionId)
    .sort((left, right) => {
      const a = Number(left.questionId);
      const b = Number(right.questionId);
      if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
      return left.questionId.localeCompare(right.questionId);
    });
}

function fullName(value) {
  if (typeof value === "string") return cleanText(value, 300);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return [value.prefix, value.first, value.middle, value.last, value.suffix]
    .map((part) => cleanText(part, 100))
    .filter(Boolean)
    .join(" ")
    .slice(0, 300);
}

function firstAnswer(answers, predicate) {
  return answers.find((answer) => predicate(answer) && displayValue(answer.value));
}

export function extractJotformContact(answers) {
  const emailAnswer = firstAnswer(answers, (answer) => answer.type === "control_email");
  const phoneAnswer = firstAnswer(answers, (answer) => answer.type === "control_phone");
  const nameAnswer = firstAnswer(answers, (answer) => answer.type === "control_fullname");

  const email = displayValue(emailAnswer?.value).toLowerCase().slice(0, 320) || null;
  const phone = displayValue(phoneAnswer?.value).slice(0, 100) || null;
  const name = (nameAnswer?.type === "control_fullname" ? fullName(nameAnswer.value) : displayValue(nameAnswer?.value).slice(0, 300)) || null;
  return Object.freeze({ email, phone, name });
}

function safeUrl(value) {
  const raw = cleanText(value, 4000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function extractJotformAttachments(answers) {
  const attachments = [];
  for (const answer of answers.filter((item) => FILE_TYPES.has(item.type))) {
    const values = Array.isArray(answer.value) ? answer.value : [answer.value];
    for (const value of values) {
      const url = safeUrl(typeof value === "object" ? value?.url || value?.link : value);
      if (!url) continue;
      attachments.push({
        id: stableId("att", answer.questionId, url),
        questionId: answer.questionId,
        label: answer.label || answer.name || `Question ${answer.questionId}`,
        providerUrl: url,
        filename: (() => {
          const rawName = new URL(url).pathname.split("/").pop() || "attachment";
          try { return cleanText(decodeURIComponent(rawName), 500); } catch { return cleanText(rawName, 500); }
        })(),
      });
    }
  }
  return attachments;
}

export function extractJotformMessage(answers, route) {
  const subjectAnswer = firstAnswer(answers, (answer) => /subject|title|topic/.test(semantic(answer)));
  const bodyLines = [];

  for (const answer of answers) {
    if (IDENTITY_TYPES.has(answer.type) || FILE_TYPES.has(answer.type)) continue;
    const value = displayValue(answer.value);
    if (!value) continue;
    const label = answer.label || answer.name || `Question ${answer.questionId}`;
    bodyLines.push(`${label}: ${value}`);
  }

  return Object.freeze({
    subject: displayValue(subjectAnswer?.value).slice(0, 500) || route.subject,
    bodyText: (bodyLines.join("\n\n") || route.subject).slice(0, 500_000),
  });
}

function submittedAt(submission, fallback) {
  const raw = cleanText(submission?.created_at || submission?.createdAt, 100);
  if (!raw) return fallback;
  const candidate = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const date = new Date(candidate);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}

export function buildJotformIntake({ formId, submissionId, route, submission, correlationId, now = new Date() }) {
  const processedAt = now.toISOString();
  const receivedAt = submittedAt(submission, processedAt);
  const answers = normaliseJotformAnswers(submission);
  const contact = extractJotformContact(answers);
  const attachments = extractJotformAttachments(answers);
  const message = extractJotformMessage(answers, route);
  const contactSeed = contact.email || `${formId}:${submissionId}`;
  const contactId = stableId("ctc", "jotform", contactSeed);
  const conversationId = stableId("cnv", "jotform", formId, submissionId);
  const messageId = stableId("msg", "jotform", formId, submissionId);
  const eventId = stableId("evt", "jotform", formId, submissionId);
  const archiveKey = `receipts/${processedAt.slice(0, 10).replaceAll("-", "/")}/${eventId}.json`;
  const sourceReference = `jotform:${formId}:${submissionId}`;

  const payload = {
    schemaVersion: 1,
    source: {
      provider: "jotform",
      formId,
      submissionId,
      status: cleanText(submission?.status, 100) || null,
      submittedAt: cleanText(submission?.created_at, 100) || null,
      updatedAt: cleanText(submission?.updated_at, 100) || null,
    },
    route: { key: route.key, workflow: route.workflow },
    contact,
    message,
    attachments,
    answers,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadSha256 = sha256Hex(payloadJson);
  const storageSummary = Object.freeze({
    formKey: route.key,
    workflow: route.workflow,
    answerCount: answers.length,
    attachmentCount: attachments.length,
    hasEmail: Boolean(contact.email),
    hasName: Boolean(contact.name),
    acknowledgementProvider: "jotform",
  });

  return Object.freeze({
    eventId,
    sourceReference,
    contactId,
    conversationId,
    messageId,
    archiveKey,
    payloadJson,
    payloadSha256,
    storageSummary,
    processedAt,
    receivedAt,
    contact,
    message,
    attachments,
    route,
    formId,
    submissionId,
    correlationId,
  });
}
