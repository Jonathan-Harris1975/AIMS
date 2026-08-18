import { CommsHubError } from "./errors.js";
import { channelFamily, isSocialChannel } from "./domain/channels.js";
import { stableId } from "./domain/ids.js";

function text(value, maximum = 10_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function requireArray(value, name, { maximum = 100 } = {}) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
    throw new CommsHubError(400, `${name}_invalid`, `${name} must contain between 1 and ${maximum} items.`);
  }
  return [...new Set(value.map((item) => text(item, 200)).filter(Boolean))];
}

function requireConversationIds(value) {
  const ids = requireArray(value, "conversation_ids", { maximum: 100 });
  if (ids.some((id) => !/^cnv_[0-9a-hjkmnp-tv-z]{26}$/.test(id))) {
    throw new CommsHubError(400, "conversation_ids_invalid", "One or more conversation IDs are invalid.");
  }
  return ids;
}

function cleanTagKey(value) {
  const key = text(value, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(key)) throw new CommsHubError(400, "tag_key_invalid", "Tag key is invalid.");
  return key;
}

function variablesFromTemplate(template) {
  return [...new Set([...String(template || "").matchAll(/\{\{\s*([a-zA-Z0-9_.-]{1,80})\s*\}\}/g)].map((match) => match[1]))];
}

function renderTemplate(template, values, allowedVariables) {
  const allowed = new Set(allowedVariables);
  for (const key of Object.keys(values || {})) {
    if (!allowed.has(key)) throw new CommsHubError(400, "saved_reply_variable_not_allowed", `Variable '${key}' is not allowed by this saved reply.`);
  }
  const rendered = String(template || "").replace(/\{\{\s*([a-zA-Z0-9_.-]{1,80})\s*\}\}/g, (_match, key) => {
    const value = values?.[key];
    if (value === undefined || value === null) throw new CommsHubError(400, "saved_reply_variable_missing", `Variable '${key}' is required.`);
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  });
  return rendered;
}

export class CommsHubOperationsService {
  constructor({ context }) {
    this.context = context;
  }

  identity(req) {
    return req.commsIdentity || { actor: "system", role: "admin" };
  }

  async queue(filters, req) {
    const result = await this.context.operationsRepository.listUnifiedQueue(filters);
    await this.context.auditService.record({
      actor: this.identity(req).actor,
      role: this.identity(req).role,
      action: "queue_read",
      objectType: "queue",
      requestId: req.id || null,
      details: { filters: { ...filters, query: undefined }, resultCount: result.length },
    });
    return result;
  }

  async workspace(conversationId, req) {
    const [conversation, workspace, ai] = await Promise.all([
      this.context.repository.getConversation(conversationId),
      this.context.operationsRepository.getConversationWorkspace(conversationId),
      this.context.aiRepository.getConversationAiState(conversationId).catch(() => null),
    ]);
    if (!conversation) throw new CommsHubError(404, "conversation_not_found", "Conversation was not found.");
    await this.context.auditService.record({
      actor: this.identity(req).actor,
      role: this.identity(req).role,
      action: "conversation_read",
      objectType: "conversation",
      objectId: conversationId,
      conversationId,
      requestId: req.id || null,
    });
    return { conversation, ...workspace, ai };
  }

  async updateStatus({ conversationId, status, snoozedUntil = null, reason = "", expectedVersion = null }, req) {
    const actor = this.identity(req);
    if (status === "snoozed") {
      const timestamp = Date.parse(snoozedUntil || "");
      if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new CommsHubError(400, "snooze_time_invalid", "Snooze time must be in the future.");
      snoozedUntil = new Date(timestamp).toISOString();
    }
    const before = await this.context.operationsRepository.getConversationOperations(conversationId);
    const normalisedStatus = text(status, 50).toLowerCase();
    if (normalisedStatus === "archived" && !["resolved", "archived"].includes(before?.operational_status)) {
      throw new CommsHubError(409, "conversation_archive_requires_resolution", "Only completed conversations can be archived.", {
        publicMessage: "Mark the conversation as resolved before archiving it.",
      });
    }
    const updated = await this.context.operationsRepository.updateConversationStatus({
      conversationId,
      status: normalisedStatus,
      actor: actor.actor,
      expectedVersion,
      snoozedUntil,
      reason,
    });
    if (["resolved", "archived", "quarantined"].includes(updated.operational_status)) {
      await this.context.aiRepository.cancelFollowUpsForConversation({
        conversationId,
        cancelledAt: new Date().toISOString(),
        reason: `conversation_${updated.operational_status}`,
      }).catch(() => null);
    }
    await this.context.auditService.record({
      actor: actor.actor,
      role: actor.role,
      action: "conversation_status_updated",
      objectType: "conversation",
      objectId: conversationId,
      conversationId,
      requestId: req.id || null,
      before,
      after: updated,
      details: { reason: text(reason, 1000) || null },
    });
    return updated;
  }

  async assign({ conversationId, ownerType, ownerId, teamId = null, expectedVersion = null }, req) {
    const actor = this.identity(req);
    const before = await this.context.operationsRepository.getConversationOperations(conversationId);
    const updated = await this.context.operationsRepository.assignConversation({
      conversationId,
      ownerType: text(ownerType, 50).toLowerCase(),
      ownerId: text(ownerId, 200),
      teamId: text(teamId, 200) || null,
      expectedVersion,
      actor: actor.actor,
    });
    await this.context.notificationService.create({
      actor: updated.owner_id,
      conversationId,
      type: "assignment",
      title: "Conversation assigned",
      bodyText: `Conversation ${conversationId} has been assigned to you.`,
      severity: "info",
      idempotencySeed: `${conversationId}:${updated.version}`,
      metadata: { ownerType: updated.owner_type, assignedBy: actor.actor },
    });
    await this.context.auditService.record({
      actor: actor.actor, role: actor.role, action: "conversation_assigned",
      objectType: "conversation", objectId: conversationId, conversationId,
      requestId: req.id || null, before, after: updated,
    });
    return updated;
  }

  async createTag({ key, label, category = "general" }, req) {
    const actor = this.identity(req);
    const tagKey = cleanTagKey(key || label);
    const tag = await this.context.operationsRepository.createTag({
      id: stableId("tag", tagKey),
      key: tagKey,
      label: text(label || key, 100),
      category: cleanTagKey(category || "general"),
      actor: actor.actor,
    });
    await this.context.auditService.record({
      actor: actor.actor, role: actor.role, action: "tag_upserted", objectType: "tag",
      objectId: tag.id, requestId: req.id || null, after: tag,
    });
    return tag;
  }

  async applyTags({ conversationIds, tagIds }, req) {
    const actor = this.identity(req);
    const conversations = requireConversationIds(conversationIds);
    const tags = requireArray(tagIds, "tag_ids", { maximum: 50 });
    const count = await this.context.operationsRepository.applyTags({ conversationIds: conversations, tagIds: tags, actor: actor.actor });
    await this.context.auditService.record({
      actor: actor.actor, role: actor.role, action: "conversation_tags_applied", objectType: "conversation_batch",
      objectId: stableId("bat", actor.actor, Date.now(), conversations.join(",")), requestId: req.id || null,
      details: { conversationIds: conversations, tagIds: tags, count },
    });
    return { count };
  }

  async addNote({ conversationId, bodyText, mentions = [] }, req) {
    const actor = this.identity(req);
    const body = text(bodyText, 10_000);
    if (!body) throw new CommsHubError(400, "internal_note_empty", "Internal note cannot be empty.");
    const mentionActors = Array.isArray(mentions) ? [...new Set(mentions.map((item) => text(item, 200)).filter(Boolean))].slice(0, 50) : [];
    const createdAt = new Date().toISOString();
    const note = await this.context.operationsRepository.addInternalNote({
      id: stableId("note", conversationId, actor.actor, createdAt, body),
      conversationId,
      bodyText: body,
      actor: actor.actor,
      mentions: mentionActors,
      at: createdAt,
    });
    const conversation = await this.context.repository.getConversation(conversationId);
    await this.context.operationsRepository.indexSearchDocument({
      id: stableId("srch", "note", note.id), objectType: "note", objectId: note.id,
      conversationId, contactId: conversation?.contact_id || null, channel: conversation?.channel || null,
      searchableText: body, metadata: { author: actor.actor }, updatedAt: createdAt,
    });
    for (const mentionedActor of mentionActors) {
      await this.context.notificationService.create({
        actor: mentionedActor,
        conversationId,
        type: "mention",
        title: "You were mentioned",
        bodyText: `${actor.actor} mentioned you in a private conversation note.`,
        severity: "info",
        idempotencySeed: `${note.id}:${mentionedActor}`,
        metadata: { noteId: note.id, mentionedBy: actor.actor },
      });
    }
    await this.context.auditService.record({
      actor: actor.actor, role: actor.role, action: "internal_note_created", objectType: "internal_note",
      objectId: note.id, conversationId, requestId: req.id || null,
      after: { ...note, body_text: undefined }, details: { mentionCount: mentionActors.length },
    });
    return note;
  }

  async upsertSavedReply({ key, label, channel = "any", bodyTemplate }, req) {
    const actor = this.identity(req);
    const replyKey = cleanTagKey(key || label);
    const template = text(bodyTemplate, 20_000);
    if (!template) throw new CommsHubError(400, "saved_reply_template_empty", "Saved reply template cannot be empty.");
    const requestedChannel = String(channel || "any").toLowerCase();
    if (!new Set(["any", "email", "social", "social_dm", "social_comment", "chat", "form"]).has(requestedChannel)) throw new CommsHubError(400, "saved_reply_channel_invalid", "Saved reply channel is invalid.");
    const storedChannel = isSocialChannel(requestedChannel) ? "social" : requestedChannel;
    const variables = variablesFromTemplate(template);
    const reply = await this.context.operationsRepository.upsertSavedReply({
      id: stableId("srp", replyKey), key: replyKey, label: text(label || key, 150), channel: storedChannel,
      bodyTemplate: template, variables, actor: actor.actor,
    });
    await this.context.auditService.record({
      actor: actor.actor, role: actor.role, action: "saved_reply_upserted", objectType: "saved_reply",
      objectId: reply.id, requestId: req.id || null, after: { ...reply, body_template: undefined },
      details: { variables, channel: requestedChannel, storedChannel },
    });
    return { ...reply, variables };
  }

  async renderSavedReply({ key, channel, values = {} }, req) {
    const reply = await this.context.operationsRepository.getSavedReply(cleanTagKey(key));
    if (!reply) throw new CommsHubError(404, "saved_reply_not_found", "Saved reply was not found.");
    const requestedChannel = String(channel || "").toLowerCase();
    const requestedFamily = channelFamily(requestedChannel);
    if (reply.channel !== "any" && reply.channel !== requestedChannel && reply.channel !== requestedFamily) throw new CommsHubError(409, "saved_reply_channel_mismatch", "Saved reply is not valid for this channel.");
    const variables = JSON.parse(reply.variables_json || "[]");
    const bodyText = renderTemplate(reply.body_template, values, variables);
    const limits = { social: 2000, chat: 4000, email: 20_000, form: 20_000 };
    if (bodyText.length > (limits[requestedFamily] || 20_000)) throw new CommsHubError(422, "saved_reply_render_too_long", "Rendered saved reply exceeds the channel limit.");
    await this.context.auditService.record({
      actor: this.identity(req).actor, role: this.identity(req).role, action: "saved_reply_rendered",
      objectType: "saved_reply", objectId: reply.id, requestId: req.id || null,
      details: { channel, variablesUsed: Object.keys(values) },
    });
    return { id: reply.id, key: reply.reply_key, channel, bodyText };
  }

  async bulk({ conversationIds, action, payload = {} }, req) {
    const conversations = requireConversationIds(conversationIds);
    const actor = this.identity(req);
    const results = [];
    if (action === "assign") {
      for (const conversationId of conversations) results.push(await this.assign({ conversationId, ...payload }, req));
    } else if (action === "status") {
      for (const conversationId of conversations) results.push(await this.updateStatus({ conversationId, ...payload }, req));
    } else if (action === "tag") {
      await this.applyTags({ conversationIds: conversations, tagIds: payload.tagIds }, req);
      results.push(...conversations.map((conversationId) => ({ conversationId, tagged: true })));
    } else if (action === "quarantine") {
      for (const conversationId of conversations) results.push(await this.updateStatus({ conversationId, status: "quarantined", reason: payload.reason || "bulk_quarantine" }, req));
    } else {
      throw new CommsHubError(400, "bulk_action_invalid", "Bulk action is invalid.");
    }
    await this.context.auditService.record({
      actor: actor.actor, role: actor.role, action: "bulk_action_completed", objectType: "conversation_batch",
      objectId: stableId("bat", action, actor.actor, Date.now(), conversations.join(",")), requestId: req.id || null,
      details: { action, conversationIds: conversations, resultCount: results.length },
    });
    return { action, count: results.length, results };
  }

  async contactProfile(contactId, req) {
    const profile = await this.context.operationsRepository.getContactProfile(contactId);
    if (!profile) throw new CommsHubError(404, "contact_not_found", "Contact was not found.");
    await this.context.auditService.record({
      actor: this.identity(req).actor, role: this.identity(req).role, action: "contact_read",
      objectType: "contact", objectId: contactId, requestId: req.id || null,
    });
    return profile;
  }

  async proposeIdentityLink({ sourceContactId, targetContactId, confidence, reason, metadata = {} }, req) {
    const actor = this.identity(req);
    if (sourceContactId === targetContactId) throw new CommsHubError(400, "identity_link_self", "A contact cannot be linked to itself.");
    const score = Number(confidence);
    if (!Number.isFinite(score) || score < 0 || score > 1) throw new CommsHubError(400, "identity_confidence_invalid", "Identity confidence must be between 0 and 1.");
    const createdAt = new Date().toISOString();
    const link = await this.context.operationsRepository.proposeIdentityLink({
      id: stableId("ilk", sourceContactId, targetContactId, createdAt), sourceContactId, targetContactId,
      confidence: score, reason: text(reason, 1000), actor: actor.actor, createdAt, metadata,
    });
    await this.context.auditService.record({
      actor: actor.actor, role: actor.role, action: "identity_link_proposed", objectType: "identity_link",
      objectId: link.id, requestId: req.id || null, after: link,
    });
    return link;
  }

  async reviewIdentityLink({ id, decision, reason = "" }, req) {
    const actor = this.identity(req);
    const link = await this.context.operationsRepository.reviewIdentityLink({ id, decision, actor: actor.actor, reason: text(reason, 1000) });
    if (!link) throw new CommsHubError(404, "identity_link_not_found", "Identity link was not found or cannot be changed.");
    await this.context.auditService.record({
      actor: actor.actor, role: actor.role, action: `identity_link_${link.status}`, objectType: "identity_link",
      objectId: link.id, requestId: req.id || null, after: link,
    });
    return link;
  }

  async search(filters, req) {
    const query = text(filters.query, 500);
    if (query.length < 2) throw new CommsHubError(400, "search_query_too_short", "Search query must contain at least two characters.");
    const results = await this.context.operationsRepository.search({ ...filters, query });
    await this.context.auditService.record({
      actor: this.identity(req).actor, role: this.identity(req).role, action: "search_performed",
      objectType: "search", requestId: req.id || null,
      details: { queryLength: query.length, filters: { ...filters, query: undefined }, resultCount: results.length },
    });
    return results;
  }
}

export default CommsHubOperationsService;
