// services/newsletter/brevo/audience.js
//
// Resolves the Brevo audience list without silently treating an empty,
// newly-created list as production-ready. Campaign sends are only safe when
// the selected list exists and contains at least one active subscriber.

import { info, warn } from "../../../logger.js";
import { getFolders, createFolder, getLists, getList, createList, addContactsToList } from "./client.js";

async function findFolderByName(name) {
  const result = await getFolders({ limit: 50 });
  if (!result.ok) return { ok: false, error: result.error, providerStatus: result.status, providerCode: result.code };
  const match = (result.data?.folders || []).find((f) => f.name === name);
  return { ok: true, folder: match || null };
}

async function findListByName(name, folderId = null) {
  const result = await getLists({ limit: 50, folderId });
  if (!result.ok) return { ok: false, error: result.error, providerStatus: result.status, providerCode: result.code };
  const match = (result.data?.lists || []).find((l) => l.name === name);
  return { ok: true, list: match || null };
}

function subscriberCounts(data = {}) {
  const totalSubscribers = Number(data?.totalSubscribers ?? 0);
  const uniqueSubscribers = Number(data?.uniqueSubscribers ?? totalSubscribers);
  const totalBlacklisted = Number(data?.totalBlacklisted ?? 0);
  return {
    totalSubscribers: Number.isFinite(totalSubscribers) ? Math.max(0, totalSubscribers) : 0,
    uniqueSubscribers: Number.isFinite(uniqueSubscribers) ? Math.max(0, uniqueSubscribers) : 0,
    totalBlacklisted: Number.isFinite(totalBlacklisted) ? Math.max(0, totalBlacklisted) : 0,
  };
}

export async function inspectList(listId) {
  if (!Number.isFinite(Number(listId)) || Number(listId) <= 0) {
    return { ok: false, error: "A valid Brevo list ID is required." };
  }

  const result = await getList(Number(listId));
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      providerStatus: result.status,
      providerCode: result.code,
      listId: Number(listId),
    };
  }

  return {
    ok: true,
    listId: Number(result.data?.id || listId),
    name: String(result.data?.name || "").trim(),
    folderId: result.data?.folderId ?? null,
    ...subscriberCounts(result.data),
  };
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

export async function ensureList({ id = null, name, folderName, allowCreate = true }) {
  let resolved;

  if (id) {
    resolved = { ok: true, listId: Number(id), created: false, source: "configured-id" };
  } else {
    const foundFolder = await findFolderByName(folderName);
    if (!foundFolder.ok) return { ...foundFolder, stage: "folder-lookup" };

    let folderId = foundFolder.folder?.id || null;
    if (!folderId && !allowCreate) {
      return {
        ok: false,
        status: "audience_not_configured",
        stage: "folder-lookup",
        error: `Brevo folder '${folderName}' was not found. Configure NEWSLETTER_AI_EDGE_BREVO_LIST_ID to the existing populated list before production sending.`,
      };
    }
    if (!folderId) {
      const folder = await ensureFolder(folderName);
      if (!folder.ok) return { ...folder, stage: "folder-create" };
      folderId = folder.folderId;
    }

    const found = await findListByName(name, folderId);
    if (!found.ok) return { ...found, stage: "list-lookup" };
    if (found.list) {
      resolved = {
        ok: true,
        listId: Number(found.list.id),
        created: false,
        folderId,
        source: "matched-name",
      };
    } else if (!allowCreate) {
      return {
        ok: false,
        status: "audience_not_configured",
        stage: "list-lookup",
        error: `Brevo list '${name}' was not found. Configure NEWSLETTER_AI_EDGE_BREVO_LIST_ID to the existing populated list before production sending.`,
      };
    } else {
      const created = await createList({ name, folderId });
      if (!created.ok) {
        return {
          ok: false,
          error: created.error,
          providerStatus: created.status,
          providerCode: created.code,
          stage: "list-create",
        };
      }
      info("newsletter.brevo.list_created", { name, listId: created.data?.id, folderId });
      resolved = {
        ok: true,
        listId: Number(created.data?.id),
        created: true,
        folderId,
        source: "created",
      };
    }
  }

  const details = await inspectList(resolved.listId);
  if (!details.ok) return { ...details, stage: "list-details", source: resolved.source };
  return { ...resolved, ...details };
}

/**
 * Syncs a batch of subscriber emails onto the profile's list. Optional.
 */
export async function syncAudience({ listId, subscribers = [] }) {
  if (!listId) return { ok: false, error: "No Brevo list configured/created for this profile." };
  if (!subscribers.length) return { ok: true, synced: 0, skipped: true };

  const emails = subscribers.map((s) => s.emailAddress).filter(Boolean);
  const result = await addContactsToList(listId, emails);
  if (!result.ok) {
    warn("newsletter.brevo.audience_sync_failed", { listId, error: result.error });
    return { ok: false, error: result.error, providerStatus: result.status, providerCode: result.code };
  }

  info("newsletter.brevo.audience_synced", { listId, requested: emails.length });
  return { ok: true, synced: emails.length };
}

export default { ensureFolder, ensureList, inspectList, syncAudience };
