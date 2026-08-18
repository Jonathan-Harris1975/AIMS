import { CommsHubError } from "./errors.js";
import { channelFamily } from "./domain/channels.js";
import { sha256Hex, stableId } from "./domain/ids.js";
import { resolveConversationAutomationExclusion } from "./domain/automationScope.js";

function text(value, maximum = 10_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function validateWorkflowDefinition(definition) {
  const value = object(definition);
  const states = array(value.states).map((state) => text(state, 80)).filter(Boolean);
  if (!states.length || new Set(states).size !== states.length) {
    throw new CommsHubError(400, "workflow_states_invalid", "Workflow states must be a non-empty unique list.");
  }
  const initialState = text(value.initialState, 80);
  if (!states.includes(initialState)) throw new CommsHubError(400, "workflow_initial_state_invalid", "Workflow initial state is invalid.");
  const terminalStates = array(value.terminalStates).map((state) => text(state, 80));
  if (terminalStates.some((state) => !states.includes(state))) throw new CommsHubError(400, "workflow_terminal_state_invalid", "Workflow terminal state is invalid.");
  const transitions = array(value.transitions).map((transition) => {
    const item = object(transition);
    const from = text(item.from, 80);
    const to = text(item.to, 80);
    const action = text(item.action, 80);
    if (!states.includes(from) || !states.includes(to) || !action) {
      throw new CommsHubError(400, "workflow_transition_invalid", "Workflow transition is invalid.");
    }
    return { from, to, action, roles: array(item.roles).map((role) => text(role, 50)).filter(Boolean), conditions: object(item.conditions) };
  });
  if (!transitions.length) throw new CommsHubError(400, "workflow_transitions_missing", "Workflow requires at least one transition.");
  return Object.freeze({ states, initialState, terminalStates, transitions, metadata: object(value.metadata) });
}

const CONDITION_KEYS = new Set(["channel", "intent", "sender", "keyword", "risk", "status", "time", "priority", "tag"]);
const ACTION_TYPES = new Set(["assign", "status", "tag", "escalate", "schedule", "workflow", "notify"]);

function validateRuleConditions(conditions) {
  const value = object(conditions);
  for (const key of Object.keys(value)) {
    if (!CONDITION_KEYS.has(key)) throw new CommsHubError(400, "routing_rule_condition_invalid", `Unsupported rule condition: ${key}.`);
  }
  return value;
}

function validateRuleActions(actions) {
  const values = array(actions);
  if (!values.length || values.length > 20) throw new CommsHubError(400, "routing_rule_actions_invalid", "Routing rule must contain 1-20 actions.");
  return values.map((entry) => {
    const action = object(entry);
    const type = text(action.type, 50);
    if (!ACTION_TYPES.has(type)) throw new CommsHubError(400, "routing_rule_action_invalid", `Unsupported rule action: ${type}.`);
    return { ...action, type };
  });
}

function includesInsensitive(value, expected) {
  return String(value || "").toLowerCase().includes(String(expected || "").toLowerCase());
}

function valueMatches(actual, expected) {
  if (Array.isArray(expected)) return expected.some((candidate) => valueMatches(actual, candidate));
  const actualValue = String(actual ?? "").toLowerCase();
  const expectedValue = String(expected ?? "").toLowerCase();
  if (actualValue === expectedValue) return true;
  return channelFamily(actualValue) === "social" && channelFamily(expectedValue) === "social";
}

function inAllowedTime(condition, date = new Date()) {
  const value = object(condition);
  const timezone = text(value.timezone, 100) || "Europe/London";
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  } catch {
    return false;
  }
  const days = array(value.days).map((day) => text(day, 3).toLowerCase());
  if (days.length && !days.includes(String(parts.weekday || "").toLowerCase())) return false;
  const current = `${parts.hour}:${parts.minute}`;
  const start = text(value.start, 5) || "00:00";
  const end = text(value.end, 5) || "23:59";
  return start <= end ? current >= start && current <= end : current >= start || current <= end;
}

function ruleMatches(rule, context, date = new Date()) {
  const conditions = rule.conditions || {};
  if (conditions.channel !== undefined && !valueMatches(context.channel, conditions.channel)) return false;
  if (conditions.intent !== undefined && !valueMatches(context.intent, conditions.intent)) return false;
  if (conditions.sender !== undefined && !includesInsensitive(context.sender, conditions.sender)) return false;
  if (conditions.keyword !== undefined) {
    const keywords = array(conditions.keyword).length ? array(conditions.keyword) : [conditions.keyword];
    if (!keywords.some((keyword) => includesInsensitive(context.text, keyword))) return false;
  }
  if (conditions.risk !== undefined && !valueMatches(context.risk, conditions.risk)) return false;
  if (conditions.status !== undefined && !valueMatches(context.status, conditions.status)) return false;
  if (conditions.priority !== undefined && !valueMatches(context.priority, conditions.priority)) return false;
  if (conditions.tag !== undefined) {
    const tags = new Set(array(context.tags).map((tag) => String(tag).toLowerCase()));
    const expectedTags = array(conditions.tag).length ? array(conditions.tag) : [conditions.tag];
    if (!expectedTags.some((tag) => tags.has(String(tag).toLowerCase()))) return false;
  }
  if (conditions.time !== undefined && !inAllowedTime(conditions.time, date)) return false;
  return true;
}

function transitionConditionsMatch(conditions, data) {
  return Object.entries(object(conditions)).every(([key, expected]) => valueMatches(data?.[key], expected));
}

export class CommsHubWorkflowEngineService {
  constructor({ context }) {
    this.context = context;
  }

  async createDefinition({ key, version, name, status = "draft", definition }, identity) {
    const workflowKey = text(key, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
    if (!workflowKey) throw new CommsHubError(400, "workflow_key_invalid", "Workflow key is invalid.");
    const parsedVersion = Number(version);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 1) throw new CommsHubError(400, "workflow_version_invalid", "Workflow version must be a positive integer.");
    if (!new Set(["draft", "active"]).has(status)) throw new CommsHubError(400, "workflow_status_invalid", "Workflow status is invalid.");
    const validated = validateWorkflowDefinition(definition);
    const createdAt = new Date().toISOString();
    const saved = await this.context.operationsRepository.upsertWorkflowDefinition({
      id: stableId("wfd", workflowKey, String(parsedVersion)), key: workflowKey, version: parsedVersion,
      name: text(name || workflowKey, 150), status, definition: validated,
      sha256: sha256Hex(JSON.stringify(validated)), actor: identity.actor, createdAt,
    });
    if (status === "active") await this.context.operationsRepository.activateWorkflowDefinition({ key: workflowKey, version: parsedVersion, actor: identity.actor, at: createdAt });
    await this.context.auditService.record({
      actor: identity.actor, role: identity.role, action: "workflow_definition_created", objectType: "workflow_definition",
      objectId: saved.id, after: { ...saved, definition_json: undefined }, details: { key: workflowKey, version: parsedVersion, status },
    });
    return { ...saved, definition: validated };
  }

  async activateDefinition({ key, version }, identity) {
    const activated = await this.context.operationsRepository.activateWorkflowDefinition({ key: text(key, 80), version: Number(version), actor: identity.actor });
    await this.context.auditService.record({
      actor: identity.actor, role: identity.role, action: "workflow_definition_activated", objectType: "workflow_definition",
      objectId: activated.id, after: activated,
    });
    return activated;
  }

  async startDefinition({ conversationId, key, data = {}, idempotencyKey = "" }, identity) {
    const workflowKey = text(key, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
    const [conversation, definition] = await Promise.all([
      this.context.repository.getConversation(conversationId),
      this.context.operationsRepository.getWorkflowDefinition({ key: workflowKey, activeOnly: true }),
    ]);
    if (!conversation) throw new CommsHubError(404, "conversation_not_found", "Conversation was not found.");
    if (!definition) throw new CommsHubError(404, "workflow_definition_not_active", "No active workflow definition was found.");
    const validated = validateWorkflowDefinition(definition.definition);
    const createdAt = new Date().toISOString();
    const keySeed = text(idempotencyKey, 200) || `workflow:${conversationId}:${workflowKey}:${definition.version}`;
    const run = await this.context.aiRepository.getOrCreateWorkflowRun({
      id: stableId("wfr", conversationId, workflowKey),
      conversationId,
      workflowKey,
      workflowVersion: Number(definition.version),
      state: validated.initialState,
      status: validated.terminalStates.includes(validated.initialState) ? "complete" : "active",
      idempotencyKey: keySeed,
      data: object(data),
      nextActionAt: null,
      createdAt,
    });
    await this.context.auditService.record({
      actor: identity.actor,
      role: identity.role,
      action: "workflow_started",
      objectType: "workflow_run",
      objectId: run.id,
      conversationId,
      details: { workflowKey, workflowVersion: Number(definition.version), state: run.state },
    });
    return { ...run, data: parseJson(run.data_json, {}) };
  }

  async transitionDefinition({ runId, action, data = {}, details = {}, idempotencyKey = "" }, identity) {
    const run = await this.context.aiRepository.getWorkflowRun(runId);
    if (!run) throw new CommsHubError(404, "workflow_run_not_found", "Workflow run was not found.");
    const transitionKey = text(idempotencyKey, 200);
    if (!transitionKey) throw new CommsHubError(400, "workflow_idempotency_required", "An idempotency key is required for workflow transitions.");
    const existingData = parseJson(run.data_json, {});
    const existingEvent = await this.context.aiRepository.getWorkflowEventByIdempotency(run.id, transitionKey);
    if (existingEvent) return { duplicate: true, run: { ...run, data: existingData }, event: existingEvent };
    if (run.status === "complete") throw new CommsHubError(409, "workflow_run_complete", "Workflow run is already complete.");
    if (run.status === "quarantined") throw new CommsHubError(409, "workflow_run_quarantined", "Workflow run is quarantined.");
    const definition = await this.context.operationsRepository.getWorkflowDefinition({
      key: run.workflow_key,
      version: Number(run.workflow_version),
    });
    if (!definition) throw new CommsHubError(409, "workflow_definition_missing", "The workflow definition used by this run is unavailable.");
    const validated = validateWorkflowDefinition(definition.definition);
    const actionKey = text(action, 80);
    const mergedData = { ...existingData, ...object(data) };
    const transition = validated.transitions.find((candidate) => (
      candidate.from === run.state
      && candidate.action === actionKey
      && (!candidate.roles.length || candidate.roles.includes(identity.role))
      && transitionConditionsMatch(candidate.conditions, mergedData)
    ));
    if (!transition) {
      throw new CommsHubError(409, "workflow_transition_not_allowed", "The requested workflow transition is not allowed from the current state.");
    }
    const now = new Date().toISOString();
    const status = validated.terminalStates.includes(transition.to) ? "complete" : "active";
    const result = await this.context.aiRepository.transitionWorkflow({
      runId: run.id,
      eventId: stableId("wfe", run.id, transitionKey),
      fromState: run.state,
      toState: transition.to,
      status,
      actionKey,
      actor: identity.actor,
      idempotencyKey: transitionKey,
      data: mergedData,
      details: object(details),
      nextActionAt: null,
      now,
    });
    await this.context.auditService.record({
      actor: identity.actor,
      role: identity.role,
      action: "workflow_transitioned",
      objectType: "workflow_run",
      objectId: run.id,
      conversationId: run.conversation_id,
      details: { action: actionKey, from: run.state, to: transition.to, status, duplicate: result.duplicate },
    });
    return { ...result, run: result.run ? { ...result.run, data: parseJson(result.run.data_json, {}) } : null };
  }

  async upsertRule({ key, priority = 100, status = "draft", conditions, actions, stopProcessing = false }, identity) {
    const ruleKey = text(key, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
    if (!ruleKey) throw new CommsHubError(400, "routing_rule_key_invalid", "Routing rule key is invalid.");
    const parsedPriority = Number(priority);
    if (!Number.isInteger(parsedPriority) || parsedPriority < 1 || parsedPriority > 10000) throw new CommsHubError(400, "routing_rule_priority_invalid", "Routing rule priority is invalid.");
    if (!new Set(["draft", "active", "disabled"]).has(status)) throw new CommsHubError(400, "routing_rule_status_invalid", "Routing rule status is invalid.");
    const createdAt = new Date().toISOString();
    const saved = await this.context.operationsRepository.upsertRoutingRule({
      id: stableId("rul", ruleKey), key: ruleKey, priority: parsedPriority, status,
      conditions: validateRuleConditions(conditions), actions: validateRuleActions(actions),
      stopProcessing: Boolean(stopProcessing), actor: identity.actor, createdAt,
    });
    await this.context.auditService.record({
      actor: identity.actor, role: identity.role, action: "routing_rule_upserted", objectType: "routing_rule",
      objectId: saved.id, after: { ...saved, conditions_json: undefined, actions_json: undefined },
      details: { key: ruleKey, status, priority: parsedPriority },
    });
    return saved;
  }

  async evaluate({ conversationId, trigger = "manual", date = new Date() }, identity = { actor: "workflow-engine", role: "admin" }) {
    const conversation = await this.context.repository.getConversation(conversationId);
    if (!conversation) throw new CommsHubError(404, "conversation_not_found", "Conversation was not found.");
    const automationExclusion = await resolveConversationAutomationExclusion(this.context, conversation);
    if (automationExclusion) {
      throw new CommsHubError(409, "conversation_automation_excluded", `Email account ${automationExclusion.accountKey} is outside Comms Hub automation.`, {
        failureClass: "permanent",
        publicMessage: "This conversation belongs to a mailbox that is intentionally outside AIMS automation.",
      });
    }
    const [ai, operations, tags] = await Promise.all([
      this.context.aiRepository.getConversationAiState(conversationId).catch(() => null),
      this.context.operationsRepository.ensureConversationOperations(conversationId, identity.actor),
      this.context.operationsRepository.listConversationTags(conversationId),
    ]);
    const context = {
      channel: conversation.channel,
      intent: ai?.state?.intent || ai?.intent || "unknown",
      sender: conversation.messages?.at(-1)?.sender || conversation.contact?.primary_email || "",
      text: conversation.messages?.map((message) => `${message.subject || ""}\n${message.body_text || ""}`).join("\n") || "",
      risk: ai?.state?.risk_level || ai?.risk_level || "unknown",
      status: operations.operational_status,
      priority: ai?.state?.priority_label || ai?.priority_label || "normal",
      tags: tags.map((tag) => tag.tag_key),
    };
    const rules = await this.context.operationsRepository.listActiveRoutingRules();
    const matched = [];
    for (const rule of rules) {
      if (!ruleMatches(rule, context, date)) continue;
      const actionResults = [];
      for (const action of rule.actions) actionResults.push(await this.executeAction({ conversationId, action, rule, trigger }, identity));
      matched.push({ ruleId: rule.id, ruleKey: rule.rule_key, actions: actionResults });
      if (rule.stop_processing) break;
    }
    await this.context.auditService.record({
      actor: identity.actor, role: identity.role, action: "routing_rules_evaluated", objectType: "conversation",
      objectId: conversationId, conversationId, details: { trigger, matchedRuleKeys: matched.map((item) => item.ruleKey) },
    });
    return { conversationId, trigger, evaluated: rules.length, matched };
  }

  async executeAction({ conversationId, action, rule, trigger }, identity) {
    if (action.type === "assign") {
      return this.context.operationsRepository.assignConversation({
        conversationId, ownerType: text(action.ownerType, 50), ownerId: text(action.ownerId, 200),
        teamId: text(action.teamId, 200) || null, actor: identity.actor,
      });
    }
    if (action.type === "status") {
      return this.context.operationsRepository.updateConversationStatus({
        conversationId, status: text(action.status, 50), actor: identity.actor, reason: `rule:${rule.rule_key}`,
      });
    }
    if (action.type === "tag") {
      const tagKey = text(action.key, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      const tag = await this.context.operationsRepository.createTag({
        id: stableId("tag", tagKey), key: tagKey, label: text(action.label || tagKey, 100),
        category: text(action.category || "automation", 80), actor: identity.actor,
      });
      await this.context.operationsRepository.applyTags({ conversationIds: [conversationId], tagIds: [tag.id], actor: identity.actor });
      return tag;
    }
    if (action.type === "escalate") {
      return this.escalate({
        conversationId, category: action.category, severity: action.severity,
        reason: action.reason || `Matched routing rule ${rule.rule_key}.`, source: `rule:${rule.rule_key}`,
        assignedTo: action.assignedTo || null, metadata: { trigger },
      }, identity);
    }
    if (action.type === "schedule") {
      const delayMinutes = Number(action.delayMinutes);
      if (!Number.isFinite(delayMinutes) || delayMinutes < 1 || delayMinutes > 525_600) throw new CommsHubError(400, "delayed_action_delay_invalid", "Rule delayed action interval is invalid.");
      return this.schedule({
        conversationId, actionType: action.actionType || "recheck",
        dueAt: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        payload: object(action.payload), idempotencyKey: `rule:${rule.rule_key}:${conversationId}:${action.actionType || "recheck"}`,
      }, identity);
    }
    if (action.type === "workflow") {
      return this.startDefinition({
        conversationId,
        key: text(action.workflowKey, 80),
        data: { trigger, ruleKey: rule.rule_key, ...(object(action.data)) },
        idempotencyKey: `rule:${rule.rule_key}:${conversationId}:${text(action.workflowKey, 80)}`,
      }, identity);
    }
    if (action.type === "notify") {
      return this.context.notificationService.create({
        actor: text(action.actor, 200) || identity.actor, conversationId, type: "system",
        title: text(action.title, 200) || "Comms Hub rule matched",
        bodyText: text(action.bodyText, 2000) || `Rule ${rule.rule_key} matched.`,
        severity: text(action.severity, 20) || "info",
        idempotencySeed: `${rule.rule_key}:${conversationId}:${trigger}`,
      });
    }
    throw new CommsHubError(400, "routing_rule_action_invalid", `Unsupported rule action: ${action.type}.`);
  }

  async schedule({ conversationId, actionType, dueAt, payload = {}, idempotencyKey = "", maxAttempts = 8 }, identity) {
    const due = Date.parse(dueAt || "");
    if (!Number.isFinite(due) || due <= Date.now()) throw new CommsHubError(400, "delayed_action_due_invalid", "Delayed action due time must be in the future.");
    const createdAt = new Date().toISOString();
    const key = text(idempotencyKey, 200) || `delayed:${conversationId}:${actionType}:${new Date(due).toISOString()}`;
    const action = await this.context.operationsRepository.scheduleDelayedAction({
      id: stableId("dla", key), conversationId, actionType: text(actionType, 50),
      payload: object(payload), dueAt: new Date(due).toISOString(), maxAttempts: Number(maxAttempts) || 8,
      idempotencyKey: key, actor: identity.actor, createdAt,
    });
    await this.context.auditService.record({
      actor: identity.actor, role: identity.role, action: "delayed_action_scheduled", objectType: "delayed_action",
      objectId: action.id, conversationId, after: { ...action, payload_json: undefined },
    });
    return action;
  }

  async escalate({ conversationId, category, severity = "high", reason, source = "manual", assignedTo = null, metadata = {} }, identity) {
    const validCategories = new Set(["legal", "safety", "abuse", "payment", "media", "high_value", "security", "other"]);
    const normalisedCategory = text(category, 50).toLowerCase();
    if (!validCategories.has(normalisedCategory)) throw new CommsHubError(400, "escalation_category_invalid", "Escalation category is invalid.");
    if (!new Set(["high", "critical"]).has(severity)) throw new CommsHubError(400, "escalation_severity_invalid", "Escalation severity is invalid.");
    const createdAt = new Date().toISOString();
    const escalation = await this.context.operationsRepository.createEscalation({
      id: stableId("esc", conversationId, normalisedCategory, createdAt), conversationId,
      category: normalisedCategory, severity, reason: text(reason, 2000), source,
      assignedTo, actor: identity.actor, createdAt, metadata,
    });
    await this.context.operationsRepository.updateConversationStatus({
      conversationId, status: "escalated", actor: identity.actor, reason: escalation.reason,
    });
    if (assignedTo) await this.context.notificationService.create({
      actor: assignedTo, conversationId, type: "escalation",
      title: `${severity === "critical" ? "Critical" : "High"} Comms Hub escalation`,
      bodyText: escalation.reason, severity: severity === "critical" ? "critical" : "warning",
      emailRequested: severity === "critical", idempotencySeed: escalation.id,
      metadata: { escalationId: escalation.id, category: normalisedCategory },
    });
    await this.context.auditService.record({
      actor: identity.actor, role: identity.role, action: "conversation_escalated", objectType: "escalation",
      objectId: escalation.id, conversationId, after: escalation,
    });
    return escalation;
  }

  async applySla(conversationId, identity) {
    const [conversation, ai] = await Promise.all([
      this.context.repository.getConversation(conversationId),
      this.context.aiRepository.getConversationAiState(conversationId).catch(() => null),
    ]);
    if (!conversation) throw new CommsHubError(404, "conversation_not_found", "Conversation was not found.");
    const priorityLabel = ai?.state?.priority_label || ai?.priority_label || "any";
    const policy = await this.context.operationsRepository.findSlaPolicy({ channel: conversation.channel, priorityLabel });
    if (!policy) return { applied: false, reason: "no_policy" };
    const start = Date.parse(conversation.created_at);
    const responseDueAt = new Date(start + Number(policy.first_response_minutes) * 60_000).toISOString();
    const resolutionDueAt = new Date(start + Number(policy.resolution_minutes) * 60_000).toISOString();
    const operations = await this.context.operationsRepository.setConversationSla({ conversationId, responseDueAt, resolutionDueAt, actor: identity.actor });
    const warningAt = new Date(Date.parse(responseDueAt) - Math.min(30, Math.floor(Number(policy.first_response_minutes) / 4)) * 60_000);
    if (warningAt.getTime() > Date.now()) await this.schedule({
      conversationId, actionType: "sla_warning", dueAt: warningAt.toISOString(),
      payload: { policyKey: policy.policy_key, dueAt: responseDueAt },
      idempotencyKey: `sla-warning:${conversationId}:${policy.policy_key}`,
    }, identity);
    if (Date.parse(responseDueAt) > Date.now()) await this.schedule({
      conversationId, actionType: "sla_breach", dueAt: responseDueAt,
      payload: { policyKey: policy.policy_key, dueAt: responseDueAt },
      idempotencyKey: `sla-breach:${conversationId}:${policy.policy_key}`,
    }, identity);
    return { applied: true, policy, operations };
  }

  async upsertSlaPolicy(input, identity) {
    const createdAt = new Date().toISOString();
    const first = Number(input.firstResponseMinutes);
    const resolution = Number(input.resolutionMinutes);
    if (!Number.isInteger(first) || first < 1 || !Number.isInteger(resolution) || resolution < first) {
      throw new CommsHubError(400, "sla_policy_minutes_invalid", "SLA response and resolution minutes are invalid.");
    }
    const key = text(input.key, 80).toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
    const policy = await this.context.operationsRepository.upsertSlaPolicy({
      id: stableId("sla", key), key, channel: text(input.channel || "any", 50),
      priorityLabel: text(input.priorityLabel || "any", 50), firstResponseMinutes: first,
      resolutionMinutes: resolution, businessHours: object(input.businessHours),
      active: input.active !== false, actor: identity.actor, createdAt,
    });
    await this.context.auditService.record({
      actor: identity.actor, role: identity.role, action: "sla_policy_upserted", objectType: "sla_policy",
      objectId: policy.id, after: policy,
    });
    return policy;
  }
}

export { ruleMatches, validateWorkflowDefinition };
export default CommsHubWorkflowEngineService;
