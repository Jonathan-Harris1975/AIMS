import { CommsHubError } from "./errors.js";

const ARCHIVE_FLAG = "\\archive";
const CONFLICTING_FLAGS = Object.freeze(["\\trash", "\\junk", "\\spam", "\\sent", "\\drafts", "\\all", "\\flagged"]);

function flags(folder) {
  return new Set((Array.isArray(folder?.flags) ? folder.flags : [])
    .map((flag) => String(flag || "").trim().toLowerCase())
    .filter(Boolean));
}

export function resolveArchiveMailbox(folders) {
  const candidates = (Array.isArray(folders) ? folders : []).filter((folder) => {
    const name = String(folder?.name || "").trim();
    const advertised = flags(folder);
    return folder?.selectable === true
      && name
      && name.toLowerCase() !== "inbox"
      && advertised.has(ARCHIVE_FLAG)
      && !CONFLICTING_FLAGS.some((flag) => advertised.has(flag));
  });
  if (candidates.length !== 1) {
    throw new CommsHubError(
      503,
      "email_archive_special_use_folder_unresolved",
      "The one.com server did not advertise exactly one safe selectable Archive folder.",
      {
        retryable: false,
        failureClass: "permanent",
        publicMessage: "The Info mailbox Archive folder could not be resolved safely.",
      }
    );
  }
  return candidates[0].name;
}

export class CommsHubEmailArchiveService {
  constructor({ context }) {
    this.context = context;
    this.running = false;
  }

  async run({ dryRun = false, now = new Date() } = {}) {
    const config = this.context.config;
    if (!config.emailArchiveEnabled) return { ok: true, skipped: true, reason: "disabled", candidates: 0, moved: 0, reconciled: 0 };
    const account = config.emailAccounts?.info;
    const client = this.context.oneComMailAccounts?.info;
    if (!account?.enabled || !client) {
      return { ok: true, skipped: true, reason: "info_mailbox_disabled", candidates: 0, moved: 0, reconciled: 0 };
    }
    if (this.running) {
      throw new CommsHubError(409, "email_archive_already_running", "Info mailbox archival is already running.", {
        retryable: true,
        failureClass: "temporary",
      });
    }

    this.running = true;
    try {
      const at = now instanceof Date ? now : new Date(now);
      const cutoff = new Date(at.getTime() - config.emailArchiveAfterDays * 86400000).toISOString();
      const candidates = await this.context.housekeepingRepository.listInfoArchiveCandidates({
        mailbox: account.mailbox,
        before: cutoff,
        limit: config.emailArchiveBatchSize,
      });
      if (!candidates.length || dryRun) {
        return {
          ok: true,
          dryRun,
          cutoff,
          candidates: candidates.length,
          moved: 0,
          reconciled: 0,
          mailbox: account.mailbox,
        };
      }

      const archiveMailbox = resolveArchiveMailbox(await client.listMailboxes());
      const result = await client.moveMessages({
        mailbox: account.mailbox,
        uids: candidates.map((candidate) => candidate.uid),
        destination: archiveMailbox,
      });
      const completedAt = new Date().toISOString();
      const movedMessages = await this.context.housekeepingRepository.markInfoMessagesArchived({
        mailbox: account.mailbox,
        uids: result.movedUids,
        archiveMailbox,
        at: completedAt,
      });
      const reconciledMessages = await this.context.housekeepingRepository.markInfoMessagesArchived({
        mailbox: account.mailbox,
        uids: result.missingUids,
        archiveMailbox,
        at: completedAt,
        reconciledOnly: true,
      });
      return {
        ok: true,
        dryRun: false,
        cutoff,
        candidates: candidates.length,
        moved: result.movedUids.length,
        movedMessages,
        reconciled: result.missingUids.length,
        reconciledMessages,
        mailbox: account.mailbox,
        archiveMailbox,
      };
    } finally {
      this.running = false;
    }
  }
}

export default CommsHubEmailArchiveService;
