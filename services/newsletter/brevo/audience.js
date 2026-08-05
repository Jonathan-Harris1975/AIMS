// services/newsletter/brevo/audience.js
//
// Resolves the Brevo audience list without silently treating an empty,
// newly-created list as production-ready. Campaign sends are only safe when
// the selected list exists and contains at least one active subscriber.

import { info, warn } from "../../../logger.js";
import { getFolders, createFolder, getLists, getList, createList, addContactsToList } from "./client.js";

function normaliseName(value = "") {
  return String(value || "").trim().toLocaleLowerCase("en-GB");
}

async function collectFolders() {
  const folders = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const result = await getFolders({ limit: 50, offset });
    if (!result.ok) return { ok: false, error: result.error, providerStatus: result.status, providerCode: result.code };
    const page = Array.isArray(result.data?.folders) ? result.data.folders : [];
    folders.push(...page);
    if (page.length < 50) break;
  }
  return { ok: true, folders };
}

async function collectLists(folderId = null) {
  const lists = [];
  for (let offset = 0; offset < 500; offset += 50) {
    const result = await getLists({ limit: 50, offset, folderId });
    if (!result.ok) return { ok: false, error: result.error, providerStatus: result.status, providerCode: result.code };
    const page = Array.isArray(result.data?.lists) ? result.data.lists : [];
    lists.push(...page);
    if (page.length < 50) break;
  }
  return { ok: true, lists };
}

async function findFolderByName(name) {
  const result = await collectFolders();
  if (!result.ok) return result;
  const wanted = normaliseName(name);
  const match = result.folders.find((folder) => normaliseName(folder.name) === wanted);
  return { ok: true, folder: match || null };
}

function audienceNameAliases(name = "") {
  const cleaned = String(name || "").trim();
  if (!cleaned) return [];
  const aliases = new Set([cleaned]);
  if (/\s+subscribers$/i.test(cleaned)) {
    aliases.add(cleaned.replace(/\s+subscribers$/i, "").trim());
  } else {
    aliases.add(`${cleaned} Subscribers`);
  }
  return [...aliases].map(normaliseName).filter(Boolean);
}

async function findListsByName(name, folderId = null) {
  const result = await collectLists(folderId);
  if (!result.ok) return result;
  const wanted = new Set(audienceNameAliases(name));
  return {
    ok: true,
    lists: result.lists.filter((list) => wanted.has(normaliseName(list.name))),
  };
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

async function chooseExistingList(candidates = []) {
  const inspected = [];
  for (const candidate of candidates) {
    const details = await inspectList(candidate?.id);
    if (!details.ok) continue;
    inspected.push(details);
  }

  if (!inspected.length) return null;
  inspected.sort((left, right) => (
    Number(right.totalSubscribers || 0) - Number(left.totalSubscribers || 0)
    || Number(right.uniqueSubscribers || 0) - Number(left.uniqueSubscribers || 0)
    || Number(left.listId || 0) - Number(right.listId || 0)
  ));
  return inspected[0];
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
  if (id) {
    const details = await inspectList(Number(id));
    if (!details.ok) return { ...details, stage: "list-details", source: "configured-id" };
    return { ...details, created: false, source: "configured-id" };
  }

  // Search every Brevo folder first. The production list may have been moved,
  // renamed only by case, or duplicated during an earlier setup attempt. When
  // duplicate names exist, choose the populated list rather than an empty one.
  // Accept both "AI Edge" and the 30/31 July legacy "AI Edge Subscribers"
  // name so a deployment does not create or select the wrong audience.
  const globalMatches = await findListsByName(name);
  if (!globalMatches.ok) return { ...globalMatches, stage: "global-list-lookup" };
  const globalList = await chooseExistingList(globalMatches.lists);
  if (globalList) {
    return {
      ...globalList,
      created: false,
      source: "matched-name-global",
    };
  }

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

  const folderMatches = await findListsByName(name, folderId);
  if (!folderMatches.ok) return { ...folderMatches, stage: "list-lookup" };
  const folderList = await chooseExistingList(folderMatches.lists);
  if (folderList) {
    return {
      ...folderList,
      created: false,
      folderId,
      source: "matched-name",
    };
  }

  if (!allowCreate) {
    return {
      ok: false,
      status: "audience_not_configured",
      stage: "list-lookup",
      error: `Brevo list '${name}' was not found. Configure NEWSLETTER_AI_EDGE_BREVO_LIST_ID to the existing populated list before production sending.`,
    };
  }

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
  const details = await inspectList(Number(created.data?.id));
  if (!details.ok) return { ...details, stage: "list-details", source: "created" };
  return {
    ...details,
    created: true,
    folderId,
    source: "created",
  };
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
