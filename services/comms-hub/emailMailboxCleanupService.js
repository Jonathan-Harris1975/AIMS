import { CommsHubError } from "./errors.js";

export const EMAIL_MAILBOX_CLEANUP_CONFIRMATION = "permanently-delete-trash-and-spam";
export const EMAIL_MAILBOX_CLEANUP_ACCOUNT_KEYS = Object.freeze(["info", "admin", "newsletter"]);

const SPECIAL_USE_FLAGS = Object.freeze({
  trash: Object.freeze(["\\trash"]),
  spam: Object.freeze(["\\junk", "\\spam"]),
});
const PROTECTED_SPECIAL_USE_FLAGS = Object.freeze(["\\sent", "\\drafts", "\\archive", "\\all", "\\flagged"]);

function folderFlags(folder) {
  return new Set((Array.isArray(folder?.flags) ? folder.flags : [])
    .map((flag) => String(flag || "").trim().toLowerCase())
    .filter(Boolean));
}

function foldersForRole(folders, role) {
  const expected = SPECIAL_USE_FLAGS[role] || [];
  return folders.filter((folder) => {
    const name = String(folder?.name || "").trim();
    if (!folder?.selectable || !name || name.toLowerCase() === "inbox") return false;
    const flags = folderFlags(folder);
    if (PROTECTED_SPECIAL_USE_FLAGS.some((flag) => flags.has(flag))) return false;
    return expected.some((flag) => flags.has(flag));
  });
}

export function resolveCleanupMailboxes(folders) {
  const available = Array.isArray(folders) ? folders : [];
  const trash = foldersForRole(available, "trash");
  const spam = foldersForRole(available, "spam");
  if (trash.length !== 1 || spam.length !== 1) {
    throw new CommsHubError(
      503,
      "email_cleanup_special_use_folders_unresolved",
      "The one.com server did not advertise exactly one selectable Trash folder and one selectable Junk/Spam folder.",
      {
        retryable: false,
        failureClass: "permanent",
        publicMessage: "Mailbox cleanup folders could not be resolved safely.",
      }
    );
  }
  if (trash[0].name.toLowerCase() === spam[0].name.toLowerCase()) {
    throw new CommsHubError(503, "email_cleanup_special_use_folders_overlap", "Trash and Junk/Spam resolved to the same mailbox.", {
      retryable: false,
      failureClass: "permanent",
      publicMessage: "Mailbox cleanup folders could not be resolved safely.",
    });
  }
  return Object.freeze({
    trash: trash[0].name,
    spam: spam[0].name,
  });
}

function cleanupAccount(config, key) {
  if (key === "info") return config.emailAccounts?.info || null;
  return config.manualEmailAccounts?.[key] || null;
}

function cleanupClient(context, key) {
  if (key === "info") return context.oneComMailAccounts?.info || null;
  return context.manualMailAccounts?.[key] || null;
}

function safeFailure(error) {
  return {
    code: String(error?.code || "email_cleanup_account_failed").slice(0, 120),
    stage: String(error?.providerStage || error?.cause?.providerStage || "mailbox_cleanup").slice(0, 120),
    retryable: error?.retryable === true,
  };
}

export class CommsHubEmailMailboxCleanupService {
  constructor({ context }) {
    this.context = context;
    this.running = false;
  }

  async run({ confirmation } = {}) {
    if (!this.context.config.emailCleanupEnabled) {
      throw new CommsHubError(409, "email_cleanup_disabled", "Monthly email cleanup is disabled.", {
        publicMessage: "Monthly email cleanup is disabled.",
      });
    }
    if (confirmation !== EMAIL_MAILBOX_CLEANUP_CONFIRMATION) {
      throw new CommsHubError(422, "email_cleanup_confirmation_required", "Permanent mailbox cleanup requires the exact confirmation value.", {
        publicMessage: "Permanent mailbox cleanup was not confirmed.",
      });
    }
    if (this.running) {
      throw new CommsHubError(409, "email_cleanup_already_running", "Monthly email cleanup is already running.", {
        retryable: true,
        failureClass: "temporary",
        publicMessage: "Monthly email cleanup is already running.",
      });
    }

    this.running = true;
    const startedAt = new Date().toISOString();
    const accounts = [];
    try {
      for (const accountKey of EMAIL_MAILBOX_CLEANUP_ACCOUNT_KEYS) {
        const account = cleanupAccount(this.context.config, accountKey);
        const client = cleanupClient(this.context, accountKey);
        if (!account?.enabled || !client) {
          accounts.push({
            accountKey,
            address: account?.address || null,
            ok: false,
            deletedMessages: 0,
            failure: {
              code: "email_cleanup_account_unconfigured",
              stage: "configuration",
              retryable: false,
            },
          });
          continue;
        }

        const folders = [];
        try {
          const mailboxes = resolveCleanupMailboxes(await client.listMailboxes());
          for (const role of ["spam", "trash"]) {
            const result = await client.deleteAllMessages({ mailbox: mailboxes[role] });
            folders.push({
              role,
              mailbox: mailboxes[role],
              deletedMessages: Number(result?.deletedCount || 0),
            });
          }
          accounts.push({
            accountKey,
            address: account.address,
            ok: true,
            deletedMessages: folders.reduce((total, folder) => total + folder.deletedMessages, 0),
            folders,
          });
        } catch (error) {
          accounts.push({
            accountKey,
            address: account.address,
            ok: false,
            deletedMessages: folders.reduce((total, folder) => total + folder.deletedMessages, 0),
            ...(folders.length ? { folders } : {}),
            failure: safeFailure(error),
          });
        }
      }

      const accountsSucceeded = accounts.filter((account) => account.ok).length;
      const deletedMessages = accounts.reduce((total, account) => total + Number(account.deletedMessages || 0), 0);
      return {
        ok: accountsSucceeded === EMAIL_MAILBOX_CLEANUP_ACCOUNT_KEYS.length,
        provider: "one.com",
        permanent: true,
        startedAt,
        completedAt: new Date().toISOString(),
        accountsTotal: EMAIL_MAILBOX_CLEANUP_ACCOUNT_KEYS.length,
        accountsSucceeded,
        accountsFailed: EMAIL_MAILBOX_CLEANUP_ACCOUNT_KEYS.length - accountsSucceeded,
        deletedMessages,
        accounts,
      };
    } finally {
      this.running = false;
    }
  }
}
