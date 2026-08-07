import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { COMMS_HUB_FORM_ROUTES, getCommsHubReadiness, loadCommsHubConfig } from "../services/comms-hub/config.js";
import { JotformClient } from "../services/comms-hub/clients/jotformClient.js";
import { buildJotformIntake, extractJotformAttachments, extractJotformContact, normaliseJotformAnswers } from "../services/comms-hub/domain/submission.js";
import { redactDiagnosticText } from "../services/comms-hub/domain/redaction.js";
import { parseMultipartFields, resolveJotformWebhook } from "../services/comms-hub/domain/webhook.js";
import { processJotformIntake } from "../services/comms-hub/intakeService.js";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../services/comms-hub/migrations/manifest.js";
import { CommsHubRepository } from "../services/comms-hub/repositories/commsRepository.js";
import { CommsHubArchiveWorker } from "../services/comms-hub/workers/archiveWorker.js";

function baseEnv() {
  return {
    COMMS_HUB_ENABLED: "true",
    D1_UUID: "database-id",
    D1_API_KEY: "d1-token",
    JOTFORM_API_KEY: "jotform-token",
    R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "r2-access",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET_COMMS_HUB: "comms-hub",
    R2_PUBLIC_BASE_URL_COMMS_HUB: "https://example.r2.dev",
  };
}

function submission({ formId = "260281179574362", submissionId = "900001", email = "person@example.com" } = {}) {
  return {
    id: submissionId,
    form_id: formId,
    status: "ACTIVE",
    created_at: "2026-07-31 00:00:00",
    answers: {
      "1": { name: "fullName", text: "Name", type: "control_fullname", answer: { first: "Jane", last: "Person" } },
      "2": { name: "email", text: "Email", type: "control_email", answer: email },
      "3": { name: "phone", text: "Telephone", type: "control_phone", answer: "+44 7700 900123" },
      "4": { name: "subject", text: "Subject", type: "control_textbox", answer: "A real enquiry" },
      "5": { name: "message", text: "Message", type: "control_textarea", answer: "Please tell me more." },
      "6": { name: "file", text: "Supporting file", type: "control_fileupload", answer: ["https://files.example.com/evidence.pdf"] },
    },
  };
}

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const migration of [
      "0001_comms_hub.sql",
      "0002_zernio_social.sql",
      "0003_ai_workflows.sql",
      "0004_hardening.sql",
      "0005_operations_and_channels.sql",
    ]) {
      this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}`, import.meta.url), "utf8"));
    }
  }

  query(sql, params = []) {
    const statement = this.db.prepare(sql);
    return { success: true, results: statement.all(...params) };
  }

  batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map(({ sql, params = [] }) => this.query(sql, params));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function buildIntake(options = {}) {
  const formId = options.formId || "260281179574362";
  const submissionId = options.submissionId || "900001";
  return buildJotformIntake({
    formId,
    submissionId,
    route: COMMS_HUB_FORM_ROUTES[formId],
    submission: submission({ formId, submissionId, email: options.email }),
    correlationId: options.correlationId || "corr-phase1",
    now: new Date("2026-07-31T00:05:00.000Z"),
  });
}

test("Comms Hub remains deployment-safe when disabled", () => {
  const readiness = getCommsHubReadiness({ COMMS_HUB_ENABLED: "false" });
  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, "disabled");
  assert.deepEqual(readiness.missing, []);
});

test("Phase 1 readiness requires real storage and Jotform credentials", () => {
  const readiness = getCommsHubReadiness({ ...baseEnv(), JOTFORM_API_KEY: "{{secret.JOTFORM_API_KEY}}" });
  assert.equal(readiness.ready, false);
  assert.ok(readiness.missing.includes("JOTFORM_API_KEY"));
});

test("Only the three supplied Jotforms are registered", () => {
  assert.deepEqual(Object.keys(COMMS_HUB_FORM_ROUTES).sort(), [
    "260281179574362", "262063136008044", "262097861889073",
  ]);
  assert.equal(COMMS_HUB_FORM_ROUTES["262063136008044"].workflow, "case_study_intake");
  assert.equal(COMMS_HUB_FORM_ROUTES["262097861889073"].workflow, "podcast_enquiry_intake");
});

test("Jotform webhook resolution accepts canonical identifiers and rawRequest", () => {
  assert.equal(resolveJotformWebhook({ formID: "260281179574362", submissionID: "900001" }).route.key, "contact");
  const resolved = resolveJotformWebhook({ rawRequest: JSON.stringify({ formID: "262063136008044", submissionID: "900002" }) });
  assert.equal(resolved.route.key, "case_study");
});

test("Newsletter and unknown form IDs are rejected at the intake boundary", () => {
  assert.throws(
    () => resolveJotformWebhook({ formID: "999999999999999", submissionID: "900003" }),
    (error) => error.code === "jotform_form_not_allowed" && error.statusCode === 403
  );
});

test("Multipart parsing extracts identifiers but ignores uploaded file bodies", () => {
  const boundary = "----aims-test-boundary";
  const body = [
    `--${boundary}\r\nContent-Disposition: form-data; name="formID"\r\n\r\n260281179574362\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="submissionID"\r\n\r\n900004\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="upload"; filename="secret.txt"\r\n\r\nprivate bytes\r\n`,
    `--${boundary}--\r\n`,
  ].join("");
  const fields = parseMultipartFields(Buffer.from(body), `multipart/form-data; boundary=${boundary}`);
  assert.deepEqual(fields, { formID: "260281179574362", submissionID: "900004" });
});

test("Jotform identity extraction trusts field types rather than guessed labels", () => {
  const answers = normaliseJotformAnswers(submission().answers ? submission() : {});
  const contact = extractJotformContact(answers);
  assert.deepEqual(contact, { email: "person@example.com", phone: "+44 7700 900123", name: "Jane Person" });
});

test("Jotform attachment extraction accepts HTTP(S) references only", () => {
  const answers = [
    { questionId: "1", name: "file", label: "File", type: "control_fileupload", value: [
      "https://files.example.com/a.pdf", "javascript:alert(1)", "file:///etc/passwd",
    ] },
  ];
  const attachments = extractJotformAttachments(answers);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].providerUrl, "https://files.example.com/a.pdf");
});

test("Jotform intake identifiers are deterministic and scoped by form", () => {
  const first = buildIntake();
  const replay = buildIntake();
  const otherForm = buildIntake({ formId: "262063136008044" });
  assert.equal(first.eventId, replay.eventId);
  assert.equal(first.conversationId, replay.conversationId);
  assert.notEqual(first.conversationId, otherForm.conversationId);
  assert.match(first.archiveKey, /^receipts\/2026\/07\/31\/evt_/);
});

test("Jotform client uses the API key and verifies both provider identifiers", async () => {
  const requests = [];
  const config = loadCommsHubConfig(baseEnv(), { requireEnabled: true });
  const client = new JotformClient(config, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ responseCode: 200, content: submission() }), { status: 200 });
    },
  });
  const result = await client.verifySubmission({ formId: "260281179574362", submissionId: "900001" });
  assert.equal(result.id, "900001");
  assert.equal(requests[0].init.headers.APIKEY, "jotform-token");
});

test("Jotform provider mismatch is rejected before persistence", async () => {
  const config = loadCommsHubConfig(baseEnv(), { requireEnabled: true });
  const client = new JotformClient(config, {
    fetchImpl: async () => new Response(JSON.stringify({
      responseCode: 200,
      content: submission({ formId: "262063136008044" }),
    }), { status: 200 }),
  });
  await assert.rejects(
    () => client.verifySubmission({ formId: "260281179574362", submissionId: "900001" }),
    (error) => error.code === "jotform_form_mismatch" && error.statusCode === 403
  );
});

test("Jotform repository writes one conversation and deduplicates replayed delivery", async () => {
  const d1 = new SqliteD1();
  const repository = new CommsHubRepository(d1);
  const intake = buildIntake();
  assert.deepEqual(await repository.persistJotformIntake(intake), { duplicate: false });
  assert.deepEqual(await repository.persistJotformIntake(intake), { duplicate: true });
  const conversation = await repository.getConversation(intake.conversationId);
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.attachments.length, 1);
  assert.equal(conversation.contact.primary_email, "person@example.com");
});

test("Shared intake service verifies provider data before the D1 write", async () => {
  const calls = [];
  const result = await processJotformIntake({
    envelope: { formID: "260281179574362", submissionID: "900001" },
    correlationId: "corr-service",
    now: new Date("2026-07-31T00:05:00.000Z"),
    context: {
      jotform: { async verifySubmission(ids) { calls.push({ verify: ids }); return submission(); } },
      repository: { async persistJotformIntake(intake) { calls.push({ persist: intake }); return { duplicate: false }; } },
    },
  });
  assert.equal(calls[0].verify.formId, "260281179574362");
  assert.equal(calls[1].persist.correlationId, "corr-service");
  assert.equal(result.persistence.duplicate, false);
});

test("Archive worker stores a redacted integrity receipt and completes its lease", async () => {
  const intake = buildIntake();
  const uploaded = [];
  const completions = [];
  const repository = {
    claimed: false,
    async claimArchiveJob() {
      if (this.claimed) return null;
      this.claimed = true;
      return {
        event_id: intake.eventId,
        conversation_id: intake.conversationId,
        provider: "jotform",
        form_id: intake.formId,
        submission_id: intake.submissionId,
        received_at: intake.receivedAt,
        processed_at: intake.processedAt,
        payload_sha256: intake.payloadSha256,
        archive_key: intake.archiveKey,
        archive_attempts: 1,
      };
    },
    async completeArchiveJob(value) { completions.push(value); },
    async failArchiveJob() { throw new Error("unexpected failure"); },
  };
  const worker = new CommsHubArchiveWorker({
    repository,
    uploadText: async (...args) => uploaded.push(args),
    workerId: "worker-phase1",
    logger: { info() {}, warn() {}, error() {} },
    config: { archiveBatchSize: 10, archiveLeaseMs: 120000, archiveMaxAttempts: 10 },
  });
  const result = await worker.runOnce();
  assert.deepEqual(result, { skipped: false, processed: 1, completed: 1, failed: 0 });
  assert.equal(completions.length, 1);
  const receipt = uploaded[0][2];
  assert.doesNotMatch(receipt, /person@example\.com|Jane Person|Please tell me more|7700 900123/);
  assert.match(receipt, new RegExp(intake.payloadSha256));
});

test("Diagnostic redaction removes email, phone and long token values", () => {
  const output = redactDiagnosticText("person@example.com +44 7700 900123 abcdefghijklmnopqrstuvwxyz1234567890");
  assert.doesNotMatch(output, /person@example\.com|7700 900123|abcdefghijklmnopqrstuvwxyz/);
});

test("Migration manifest requires all delivered Comms Hub phases", () => {
  assert.deepEqual(COMMS_HUB_REQUIRED_MIGRATIONS, [
    "0001_comms_hub",
    "0002_zernio_social",
    "0003_ai_workflows",
    "0004_hardening",
    "0005_operations_and_channels",
  ]);
});
