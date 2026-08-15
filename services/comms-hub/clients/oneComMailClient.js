import tls from "node:tls";
import { CommsHubError } from "../errors.js";
import { buildRawEmail, parseRawEmail } from "../domain/email.js";

function quoteImap(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function text(value, maximum = 1000) {
  return String(value ?? "").trim().slice(0, maximum);
}

class BufferedSocketReader {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.chunks = [];
    this.length = 0;
    this.ended = false;
    this.error = null;
    this.waiters = new Set();
    socket.on("data", (chunk) => {
      const value = Buffer.from(chunk);
      if (!value.length) return;
      this.chunks.push(value);
      this.length += value.length;
      this.wake();
    });
    socket.on("end", () => { this.ended = true; this.wake(); });
    socket.on("close", () => { this.ended = true; this.wake(); });
    socket.on("error", (error) => { this.error = error; this.wake(); });
  }

  wake() {
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  async waitForData(previousLength = this.length) {
    if (this.error) throw this.error;
    if (this.length > previousLength || this.ended) return;
    await new Promise((resolve, reject) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
      timer = setTimeout(() => {
        this.waiters.delete(done);
        reject(new Error("Socket read timed out."));
      }, this.timeoutMs);
    });
    if (this.error) throw this.error;
  }

  findCrlf() {
    let offset = 0;
    let previousWasCr = false;
    for (const chunk of this.chunks) {
      for (let index = 0; index < chunk.length; index += 1) {
        const byte = chunk[index];
        if (previousWasCr && byte === 10) return offset - 1;
        previousWasCr = byte === 13;
        offset += 1;
      }
    }
    return -1;
  }

  consume(length) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.length) {
      throw new Error("Socket buffer consume length is invalid.");
    }
    if (length === 0) return Buffer.alloc(0);
    const output = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      const chunk = this.chunks[0];
      const needed = length - written;
      if (chunk.length <= needed) {
        chunk.copy(output, written);
        written += chunk.length;
        this.chunks.shift();
      } else {
        chunk.copy(output, written, 0, needed);
        this.chunks[0] = chunk.subarray(needed);
        written += needed;
      }
    }
    this.length -= length;
    return output;
  }

  startsWith(bytes) {
    const expected = Buffer.from(bytes);
    if (this.length < expected.length) return false;
    let matched = 0;
    for (const chunk of this.chunks) {
      const take = Math.min(chunk.length, expected.length - matched);
      if (!chunk.subarray(0, take).equals(expected.subarray(matched, matched + take))) return false;
      matched += take;
      if (matched === expected.length) return true;
    }
    return false;
  }

  discardPrefix(bytes) {
    const expected = Buffer.from(bytes);
    if (!this.startsWith(expected)) return false;
    this.consume(expected.length);
    return true;
  }

  async readLine() {
    while (true) {
      const index = this.findCrlf();
      if (index >= 0) {
        const line = this.consume(index).toString("utf8");
        this.consume(2);
        return line;
      }
      if (this.error) throw this.error;
      if (this.ended) throw new Error("Socket ended before a complete line was received.");
      const previousLength = this.length;
      await this.waitForData(previousLength);
    }
  }

  async readBytes(length) {
    while (this.length < length) {
      if (this.error) throw this.error;
      if (this.ended) throw new Error("Socket ended before the declared literal was received.");
      const previousLength = this.length;
      await this.waitForData(previousLength);
    }
    return this.consume(length);
  }
}

function createTlsSocket({ host, port, servername, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: servername || host,
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("TLS connection timed out."));
    }, timeoutMs);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      socket.setTimeout(timeoutMs, () => socket.destroy(new Error("Socket operation timed out.")));
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

class ImapSession {
  constructor(socket, timeoutMs) {
    this.socket = socket;
    this.reader = new BufferedSocketReader(socket, timeoutMs);
    this.sequence = 0;
    this.stage = "connected";
  }

  async greeting() {
    this.stage = "greeting";
    const line = await this.reader.readLine();
    if (!/^\*\s+(OK|PREAUTH)\b/i.test(line)) throw new Error(`Unexpected IMAP greeting: ${line.slice(0, 200)}`);
    return line;
  }

  async command(command) {
    this.sequence += 1;
    const commandText = String(command || "").trim();
    const upper = commandText.toUpperCase();
    this.stage = upper.startsWith("UID SEARCH") ? "uid_search"
      : upper.startsWith("UID FETCH") ? "uid_fetch"
        : upper.startsWith("LOGIN") ? "login"
          : upper.startsWith("EXAMINE") ? "examine"
            : upper.startsWith("LOGOUT") ? "logout"
              : upper.split(/\s+/)[0].toLowerCase() || "command";
    const tag = `A${String(this.sequence).padStart(4, "0")}`;
    this.socket.write(`${tag} ${command}\r\n`);
    const lines = [];
    const literals = [];
    while (true) {
      const line = await this.reader.readLine();
      lines.push(line);
      const literalMatch = line.match(/\{(\d+)\}$/);
      if (literalMatch) {
        const length = Number(literalMatch[1]);
        if (!Number.isSafeInteger(length) || length < 0 || length > 50_000_000) throw new Error("Invalid IMAP literal length.");
        literals.push(await this.reader.readBytes(length));
        this.reader.discardPrefix("\r\n");
      }
      if (line.startsWith(`${tag} `)) {
        if (!new RegExp(`^${tag} OK\\b`, "i").test(line)) {
          throw new Error(`IMAP command failed: ${line.slice(0, 500)}`);
        }
        return { lines, literals };
      }
    }
  }

  close() {
    this.socket.end();
  }
}

async function readSmtpResponse(reader) {
  const lines = [];
  let code = 0;
  while (true) {
    const line = await reader.readLine();
    lines.push(line);
    const match = line.match(/^(\d{3})([ -])(.*)$/);
    if (!match) throw new Error(`Invalid SMTP response: ${line.slice(0, 200)}`);
    code = Number(match[1]);
    if (match[2] === " ") return { code, lines, message: lines.join("\n") };
  }
}

async function smtpCommand(socket, reader, command, expectedCodes) {
  if (command !== null) socket.write(`${command}\r\n`);
  const response = await readSmtpResponse(reader);
  if (!expectedCodes.includes(response.code)) throw new Error(`SMTP command failed (${response.code}): ${response.message.slice(0, 500)}`);
  return response;
}

export class OneComMailClient {
  constructor(config) {
    this.config = config;
  }

  assertConfigured() {
    const required = [
      this.config.oneComEmailAccountKey,
      this.config.oneComEmailAddress,
      this.config.oneComEmailUsername,
      this.config.oneComEmailPassword,
      this.config.oneComImapHost,
      this.config.oneComSmtpHost,
    ];
    if (required.some((value) => !text(value))) {
      throw new CommsHubError(503, "onecom_email_unconfigured", "one.com email credentials or endpoints are not configured.", {
        failureClass: "permanent",
        publicMessage: "Email integration is not configured.",
      });
    }
  }

  async withImapSession(callback) {
    this.assertConfigured();
    let socket;
    let session;
    let providerStage = "tls_connect";
    try {
      socket = await createTlsSocket({
        host: this.config.oneComImapHost,
        port: this.config.oneComImapPort,
        servername: this.config.oneComImapHost,
        timeoutMs: this.config.oneComEmailTimeoutMs,
      });
      session = new ImapSession(socket, this.config.oneComEmailTimeoutMs);
      providerStage = "greeting";
      await session.greeting();
      providerStage = "login";
      await session.command(`LOGIN ${quoteImap(this.config.oneComEmailUsername)} ${quoteImap(this.config.oneComEmailPassword)}`);
      providerStage = "mailbox_operation";
      const result = await callback(session);
      providerStage = "logout";
      await session.command("LOGOUT").catch(() => null);
      session.close();
      return result;
    } catch (cause) {
      socket?.destroy();
      const error = new CommsHubError(502, "onecom_imap_failed", "one.com IMAP operation failed.", {
        cause,
        retryable: true,
        failureClass: "temporary",
        publicMessage: "Email inbox is temporarily unavailable.",
      });
      error.providerStage = session?.stage || providerStage;
      throw error;
    }
  }

  async getMailboxCursor({ mailbox = "INBOX" } = {}) {
    return this.withImapSession(async (session) => {
      const selected = await session.command(`EXAMINE ${quoteImap(mailbox)}`);
      const uidValidityLine = selected.lines.find((line) => /UIDVALIDITY/i.test(line)) || "";
      const uidValidity = Number(uidValidityLine.match(/UIDVALIDITY\s+(\d+)/i)?.[1] || 0) || null;

      // UIDNEXT is monotonic for a mailbox generation. Unlike "highest UID
      // currently returned by SEARCH", it does not move backwards when a mail
      // client/rule moves or expunges recent messages. That makes UIDNEXT - 1
      // the safe watermark for our no-historical-backfill boundary.
      const uidNextLine = selected.lines.find((line) => /UIDNEXT/i.test(line)) || "";
      const uidNext = Number(uidNextLine.match(/UIDNEXT\s+(\d+)/i)?.[1] || 0) || null;
      if (uidNext) return { mailbox, uidValidity, highestUid: Math.max(uidNext - 1, 0), uidNext, cursorSource: "uidnext" };

      // Standards-compliant servers normally advertise UIDNEXT. Keep a
      // conservative SEARCH fallback for providers that omit it.
      const search = await session.command("UID SEARCH ALL");
      const searchLine = search.lines.find((line) => /^\* SEARCH\b/i.test(line)) || "";
      const uids = searchLine.replace(/^\* SEARCH\s*/i, "").split(/\s+/).map(Number).filter((value) => Number.isInteger(value) && value > 0);
      return {
        mailbox,
        uidValidity,
        highestUid: uids.length ? Math.max(...uids) : 0,
        uidNext: null,
        cursorSource: "search_fallback",
      };
    });
  }

  async fetchMessages({ mailbox = "INBOX", afterUid = 0, limit = 25 } = {}) {
    const boundedLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    return this.withImapSession(async (session) => {
      const selected = await session.command(`EXAMINE ${quoteImap(mailbox)}`);
      const uidValidityLine = selected.lines.find((line) => /UIDVALIDITY/i.test(line)) || "";
      const uidValidity = Number(uidValidityLine.match(/UIDVALIDITY\s+(\d+)/i)?.[1] || 0) || null;
      const search = await session.command(`UID SEARCH UID ${Math.max(Number(afterUid) + 1, 1)}:*`);
      const searchLine = search.lines.find((line) => /^\* SEARCH\b/i.test(line)) || "";
      const uids = searchLine.replace(/^\* SEARCH\s*/i, "").split(/\s+/).map(Number).filter((value) => Number.isInteger(value) && value > afterUid).sort((a, b) => a - b).slice(0, boundedLimit);
      const messages = [];
      for (const uid of uids) {
        const fetched = await session.command(`UID FETCH ${uid} (UID BODY.PEEK[])`);
        const raw = fetched.literals[0];
        if (!raw) continue;
        session.stage = "message_parse";
        messages.push({ uid, parsed: parseRawEmail(raw) });
      }
      return { mailbox, uidValidity, messages, highestUid: uids.length ? Math.max(...uids) : Number(afterUid) || 0 };
    });
  }

  async sendMessage({ to, cc = [], subject, bodyText, bodyHtml = null, inReplyTo = "", references = [], attachments = [], messageId = "" }) {
    this.assertConfigured();
    const recipientList = [...new Set([...to, ...cc].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
    if (!recipientList.length) throw new CommsHubError(400, "email_recipients_missing", "At least one email recipient is required.");
    const built = buildRawEmail({
      from: this.config.oneComEmailAddress,
      to,
      cc,
      subject,
      bodyText,
      bodyHtml,
      inReplyTo,
      references,
      attachments,
      messageId,
    });
    let socket;
    try {
      socket = await createTlsSocket({
        host: this.config.oneComSmtpHost,
        port: this.config.oneComSmtpPort,
        servername: this.config.oneComSmtpHost,
        timeoutMs: this.config.oneComEmailTimeoutMs,
      });
      const reader = new BufferedSocketReader(socket, this.config.oneComEmailTimeoutMs);
      await smtpCommand(socket, reader, null, [220]);
      await smtpCommand(socket, reader, `EHLO ${this.config.oneComSmtpEhloName}`, [250]);
      const authPayload = Buffer.from(`\0${this.config.oneComEmailUsername}\0${this.config.oneComEmailPassword}`, "utf8").toString("base64");
      await smtpCommand(socket, reader, `AUTH PLAIN ${authPayload}`, [235]);
      await smtpCommand(socket, reader, `MAIL FROM:<${this.config.oneComEmailAddress}>`, [250]);
      for (const recipient of recipientList) await smtpCommand(socket, reader, `RCPT TO:<${recipient}>`, [250, 251]);
      await smtpCommand(socket, reader, "DATA", [354]);
      const dotStuffed = built.raw.replace(/(^|\r\n)\./g, "$1..");
      socket.write(`${dotStuffed.replace(/\r?\n/g, "\r\n").replace(/\r\n$/, "")}\r\n.\r\n`);
      const dataResponse = await readSmtpResponse(reader);
      if (dataResponse.code !== 250) throw new Error(`SMTP DATA failed (${dataResponse.code}): ${dataResponse.message}`);
      await smtpCommand(socket, reader, "QUIT", [221]).catch(() => null);
      socket.end();
      return Object.freeze({
        provider: "one.com",
        messageId: built.messageId,
        acceptedRecipients: recipientList,
        response: dataResponse.message,
      });
    } catch (cause) {
      socket?.destroy();
      throw new CommsHubError(502, "onecom_smtp_failed", "one.com SMTP operation failed.", {
        cause,
        retryable: true,
        failureClass: "temporary",
        publicMessage: "Email could not be sent at this time.",
      });
    }
  }
}

export default OneComMailClient;
