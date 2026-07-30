// services/newsletter/brevo/audience.js
//
// AIMS owns list creation in Brevo (no pre-existing list is assumed — see
// services/newsletter/config/profiles.js). These helpers are idempotent:
// they look an existing folder/list up by name before creating one, so
// calling ensureList() on every send is safe and requires no local state.

import { info, warn } from "../../../logger.js";
import { getFolders, createFolder, getLists, createList, addContactsToList } from "./client.js";

async function findFolderByName(name) {
  const result = await getFolders({ limit: 50 });
  if (!result.ok) return { ok: false, error: result.error };
  const match = (result.data?.folders || []).find((f) => f.name === name);
  return { ok: true, folder: match || null };
}

async function findListByName(name, folderId = null) {
  const result = await getLists({ limit: 50, folderId });
  if (!result.ok) return { ok: false, error: result.error };
  const match = (result.data?.lists || []).find((l) => l.name === name);
  return { ok: true, list: match || null };
}

export async function ensureFolder(name) {
  const found = await findFolderByName(name);
  if (!found.ok) return found;
  if (found.folder) return { ok: true, folderId: found.folder.id, created: false };

  const created = await createFolder(name);
  if (!created.ok) return { ok: false, error: created.error };
  info("newsletter.brevo.folder_created", { name, folderId: created.data?.id });
  return { ok: true, folderId: created.data?.id, created: true };
}

export async function ensureList({ id = null, name, folderName }) {
  if (id) return { ok: true, listId: Number(id), created: false, source: "configured-id" };

  const folder = await ensureFolder(folderName);
  if (!folder.ok) return { ok: false, error: folder.error };

  const found = await findListByName(name, folder.folderId);
  if (!found.ok) return found;
  if (found.list) return { ok: true, listId: found.list.id, created: false, folderId: folder.folderId };

  const created = await createList({ name, folderId: folder.folderId });
  if (!created.ok) return { ok: false, error: created.error };
  info("newsletter.brevo.list_created", { name, listId: created.data?.id, folderId: folder.folderId });
  return { ok: true, listId: created.data?.id, created: true };
}

/**
 * Syncs a batch of subscriber emails onto the profile's list. Optional —
 * most of the time list membership already flows in via the existing
 * signup funnel (JotForm -> MailChimp-equivalent) writing to Brevo
 * directly; this exists for cases where AIMS itself is the source of
 * truth for a subscriber batch.
 */
export async function syncAudience({ listId, subscribers = [] }) {
  if (!listId) return { ok: false, error: "No Brevo list configured/created for this profile." };
  if (!subscribers.length) return { ok: true, synced: 0, skipped: true };

  const emails = subscribers.map((s) => s.emailAddress).filter(Boolean);
  const result = await addContactsToList(listId, emails);
  if (!result.ok) {
    warn("newsletter.brevo.audience_sync_failed", { listId, error: result.error });
    return { ok: false, error: result.error };
  }

  info("newsletter.brevo.audience_synced", { listId, requested: emails.length });
  return { ok: true, synced: emails.length };
}

export default { ensureFolder, ensureList, syncAudience };
