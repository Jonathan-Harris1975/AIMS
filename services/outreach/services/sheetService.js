// services/outreach/services/sheetService.js

import { google } from "googleapis";

const TAB_NAME = "Leads";
const googleClientEmail = process.env.GOOGLE_CLIENT_EMAIL;
const googlePrivateKey = process.env.GOOGLE_PRIVATE_KEY;
const googleSheetId = process.env.GOOGLE_SHEET_ID;

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: googleClientEmail,
    private_key: googlePrivateKey?.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

function normalizeSpreadsheetId(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || raw;
}

export async function appendLeadRows(rows = []) {
  if (!rows.length) return;

  return sheets.spreadsheets.values.append({
    spreadsheetId: normalizeSpreadsheetId(googleSheetId),
    range: `${TAB_NAME}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}
