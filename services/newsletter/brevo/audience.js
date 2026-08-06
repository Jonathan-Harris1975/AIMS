// services/newsletter/brevo/audience.js
//
// Resolves the real Brevo audience used for newsletter delivery. Production
// delivery is fail-closed: AIMS must select an existing populated list unless
// NEWSLETTER_BREVO_ALLOW_LIST_CREATE=true is deliberately enabled.

import { info, warn } from "../../../logger.js";
import {
  getFolders,
  createFolder,
  getLists,
  getList,
  createList,
  addContactsToList,
} from "./client.js";

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function normaliseName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function audienceCounts(list = {}) {
  const hasTotal = Number.isFinite(Number(list.totalSubscribers));
  const hasUnique = Number.isFinite(Number(list.uniqueSubscribers));
  const totalSubscribers = hasTotal ? Math.max(0, Number(list.totalSubscribers)) : 0;
  const totalBlacklisted = Number.isFinite(Number(list.totalBlacklisted))
    ? Math.max(0, Number(list.totalBlacklisted))
    : 0;
  const uniqueSubscribers = hasUnique
    ? Math.max(0, Number(list.uniqueSubscribers))
    : totalSubscribers;
  const activeSubscribers = hasTotal
    ? Math.max(0, totalSubscribers - totalBlacklisted)
    : uniqueSubscribers;
  return { totalSubscribers, totalBlacklisted, uniqueSubscribers, activeSubscribers };
}

export function audienceNameAliases(name) {
  const base = String(name || "").trim();
  const stripped = base.replace(/\s+subscribers?$/i, "").trim();
  return [...new Set([
    base,
    stripped,
    stripped ? `${stripped} Subscribers` : "",
    stripped ? `${stripped} Newsletter` : "",
  ].filter(Boolean).map(normaliseName))];
}

/**
 * Picks the best exact-name match, preferring the populated list when Brevo
 * contains both an old empty list and the live audience with an alias name.
 */
export function chooseExistingList(lists = [], { name, aliases = [] } = {}) {
  const accepted = new Set([
    ...audienceNameAliases(name),
    ...aliases.flatMap((alias) => audienceNameAliases(alias)),
  ]);
  const candidates = lists
    .filter((list) => accepted.has(normaliseName(list?.name)))
    .map((list) => ({ ...list, ...audienceCounts(list) }))
    .sort((a, b) => b.activeSubscribers - a.activeSubscribers || b.uniqueSubscribers - a.uniqueSubscribers);
  return candidates[0] || null;
}

async function findFolderByName(name) {
  const result = await getFolders({ limit: 50 });
  if (!result.ok) return { ok: false, error: result.error, providerStatus: result.status, providerCode: result.code };
  const match = (result.data?.folders || []).find((folder) => normaliseName(folder.name) === normaliseName(name));
  return { ok: true, folder: match || null };
}

async function findExistingList({ id = null, name, folderName }) {
  if (id) {
    const result = await getList(id);
    if (!result.ok) {
      return {
        ok: false,
        status: "audience_not_configured",
        providerStatus: result.status,
        providerCode: result.code,
        error: `Configured Brevo list ${id} could not be loaded: ${result.error}`,
      };
    }
    return { ok: true, list: result.data, source: "configured-id" };
  }

  // Search all lists rather than only one folder. Existing Brevo accounts can
  // retain the live list in a legacy folder, and delivery must choose data over
  // silently creating an empty duplicate.
  const result = await getLists({ limit: 50 });
  if (!result.ok) {
    return { ok: false, status: "audience_lookup_failed", error: result.error, providerStatus: result.status, providerCode: result.code };
  }
  const list = chooseExistingList(result.data?.lists || [], {
    name,
    aliases: [folderName, "AI Edge", "AI Edge Subscribers"],
  });
  return { ok: true, list, source: "existing-name" };
}

export async function ensureFolder(name) {
  const found = await findFolderByName(name);
  if (!found.ok) return found;
  if (found.folder) return { ok: true, folderId: found.folder.id, created: false };

  const created = await createFolder(name);
  if (!created.ok) return { ok: false, error: created.error, providerStatus: created.status, providerCode: created.code };
  info("newsletter.brevo.folder_created", { name, folderId: created.data?.id });
  return { ok: true, folderId: created.data?.id, created: true };
}

/**
 * Resolves a delivery audience. By default this honours
 * NEWSLETTER_BREVO_ALLOW_LIST_CREATE; readiness callers pass allowCreate:false
 * so their probe is guaranteed side-effect-free.
 */
export async function ensureList({ id = null, name, folderName }, { allowCreate = envFlag("NEWSLETTER_BREVO_ALLOW_LIST_CREATE", false) } = {}) {
  const found = await findExistingList({ id, name, folderName });
  if (!found.ok) return found;

  if (found.list) {
    // List collection responses can omit subscriber totals. Fetch the detail
    // record before deciding whether the audience is populated.
    let detail = found.list;
    if (detail.id && detail.totalSubscribers === undefined && detail.uniqueSubscribers === undefined) {
      const loaded = await getList(detail.id);
      if (!loaded.ok) {
        return { ok: false, status: "audience_lookup_failed", error: loaded.error, providerStatus: loaded.status, providerCode: loaded.code };
      }
      detail = loaded.data;
    }
    return {
      ok: true,
      listId: Number(detail.id),
      name: detail.name || name,
      created: false,
      source: found.source,
      ...audienceCounts(detail),
    };
  }

  if (!allowCreate) {
    return {
      ok: false,
      status: "audience_not_configured",
      error:
        `No existing Brevo list matched '${name}'. Configure NEWSLETTER_AI_EDGE_BREVO_LIST_ID ` +
        "with the populated list ID; automatic production list creation is disabled.",
    };
  }

  const folder = await ensureFolder(folderName);
  if (!folder.ok) return { ...folder, status: folder.status || "audience_create_failed" };

  const created = await createList({ name, folderId: folder.folderId });
  if (!created.ok) {
    return { ok: false, status: "audience_create_failed", error: created.error, providerStatus: created.status, providerCode: created.code };
  }
  info("newsletter.brevo.list_created", { name, listId: created.data?.id, folderId: folder.folderId });
  return {
    ok: true,
    listId: Number(created.data?.id),
    name,
    created: true,
    source: "created",
    totalSubscribers: 0,
    totalBlacklisted: 0,
    uniqueSubscribers: 0,
    activeSubscribers: 0,
  };
}

export async function inspectAudience(options) {
  return ensureList(options, { allowCreate: false });
}

/**
 * Syncs a batch of subscriber emails onto the profile's list.
 */
export async function syncAudience({ listId, subscribers = [] }) {
  if (!listId) return { ok: false, error: "No Brevo list configured/created for this profile." };
  if (!subscribers.length) return { ok: true, synced: 0, skipped: true };

  const emails = subscribers.map((subscriber) => subscriber.emailAddress).filter(Boolean);
  const result = await addContactsToList(listId, emails);
  if (!result.ok) {
    warn("newsletter.brevo.audience_sync_failed", { listId, error: result.error });
    return { ok: false, error: result.error };
  }

  info("newsletter.brevo.audience_synced", { listId, requested: emails.length });
  return { ok: true, synced: emails.length };
}

export default {
  audienceNameAliases,
  chooseExistingList,
  ensureFolder,
  ensureList,
  inspectAudience,
  syncAudience,
};
