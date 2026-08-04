import { stableId } from "./domain/ids.js";
import { CommsHubError } from "./errors.js";

const WORKFLOW_KEY = "podcast_contribution";
const WORKFLOW_VERSION = 1;

const TRANSITIONS = Object.freeze({
  received: Object.freeze({ precheck: "precheck_complete" }),
  precheck_complete: Object.freeze({ request_assets: "awaiting_assets", submit_for_review: "awaiting_review" }),
  awaiting_assets: Object.freeze({ assets_received: "awaiting_review" }),
  awaiting_review: Object.freeze({ approve: "accepted", reject: "rejected" }),
  accepted: Object.freeze({ publish_episode: "episode_link_sent" }),
  episode_link_sent: Object.freeze({ request_backlink: "backlink_requested" }),
  backlink_requested: Object.freeze({ offer_social_post: "social_offer_sent" }),
  social_offer_sent: Object.freeze({ complete: "complete" }),
});

function nextStatus(state) {
  if (["complete", "rejected"].includes(state)) return "complete";
  if (["awaiting_assets", "awaiting_review"].includes(state)) return "waiting";
  return "active";
}

function requireHttps(value, name) {
  let parsed;
  try { parsed = new URL(String(value || "")); } catch { throw new CommsHubError(400, "podcast_workflow_url_invalid", `${name} must be a valid HTTPS URL.`); }
  if (parsed.protocol !== "https:") throw new CommsHubError(400, "podcast_workflow_url_invalid", `${name} must use HTTPS.`);
  return parsed.toString();
}

export class PodcastContributionWorkflowService {
  constructor({ context }) { this.context = context; }

  async start(conversationId) {
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation) throw new CommsHubError(404, "conversation_not_found", "Conversation was not found.");
    if (conversation.workflow !== "podcast_enquiry_intake") {
      throw new CommsHubError(422, "podcast_workflow_mismatch", "Conversation is not a podcast enquiry.");
    }
    const now = new Date().toISOString();
    return this.context.aiRepository.getOrCreateWorkflowRun({
      id: stableId("wfr", conversationId, WORKFLOW_KEY),
      conversationId,
      workflowKey: WORKFLOW_KEY,
      workflowVersion: WORKFLOW_VERSION,
      state: "received",
      status: "active",
      idempotencyKey: `workflow:${WORKFLOW_KEY}:${conversationId}`,
      data: { guestBookingOffered: false, automatedPipeline: true },
      createdAt: now,
    });
  }

  async advance({ conversationId, action, idempotencyKey, actor = "aims:comms-hub", data = {} }) {
    if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(String(idempotencyKey || ""))) {
      throw new CommsHubError(400, "workflow_idempotency_invalid", "A valid idempotency key is required.");
    }
    const current = await this.start(conversationId);
    const existingEvent = await this.context.aiRepository.getWorkflowEventByIdempotency(current.id, idempotencyKey);
    if (existingEvent) return { duplicate: true, run: current };
    const normalisedAction = String(action || "").trim().toLowerCase();
    const toState = TRANSITIONS[current.state]?.[normalisedAction];
    if (!toState) {
      throw new CommsHubError(409, "workflow_transition_invalid", `Action '${normalisedAction}' is not valid from '${current.state}'.`, {
        publicMessage: "Workflow transition is not valid from the current state.",
      });
    }
    const merged = { ...(JSON.parse(current.data_json || "{}")), ...data, guestBookingOffered: false, automatedPipeline: true };
    if (normalisedAction === "publish_episode") merged.episodeUrl = requireHttps(data.episodeUrl, "episodeUrl");
    if (normalisedAction === "precheck") {
      const conversation = await this.context.repository.getConversation(conversationId);
      merged.precheck = {
        attachmentCount: conversation.attachments.length,
        hasSupportingMaterial: conversation.attachments.length > 0 || /https:\/\//i.test(conversation.messages.map((message) => message.body_text).join("\n")),
        checkedAt: new Date().toISOString(),
      };
    }
    const now = new Date().toISOString();
    return this.context.aiRepository.transitionWorkflow({
      runId: current.id,
      eventId: stableId("wfe", current.id, idempotencyKey),
      fromState: current.state,
      toState,
      status: nextStatus(toState),
      actionKey: normalisedAction,
      actor: String(actor || "aims:comms-hub").slice(0, 200),
      idempotencyKey,
      data: merged,
      details: { suppliedKeys: Object.keys(data || {}), guestBookingOffered: false },
      nextActionAt: null,
      now,
    });
  }
}

export default PodcastContributionWorkflowService;
