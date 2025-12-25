// services/outreach/services/sheetService.js

import { google } from "googleapis";
import { ENV } from "../../../scripts/envBootstrap.js";

const TAB_NAME = "Leads";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: ENV.GOOGLE_CLIENT_EMAIL,
    private_key: ENV.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

export async function appendLeadRows(rows = []) {
  if (!rows.length) return;

  return sheets.spreadsheets.values.append({
    spreadsheetId: ENV.GOOGLE_SHEET_ID,
    range: `${TAB_NAME}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}
