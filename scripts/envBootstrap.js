// scripts/envBootstrap.js
import process from "process";

const req = (k) => {
  if (!process.env[k] || process.env[k].trim() === "") {
    throw new Error(`Missing env: ${k}`);
  }
  return process.env[k];
};

const opt = (k, d) => process.env[k] ?? d;

const num = (k) => {
  const v = Number(req(k));
  if (Number.isNaN(v)) throw new Error(`Env ${k} must be numeric`);
  return v;
};

const bool = (k) =>
  ["1","true","yes","on"].includes(req(k).toLowerCase());

export const ENV = {
  NODE_ENV: req("NODE_ENV"),
  PORT: num("PORT"),
  LOG_LEVEL: opt("LOG_LEVEL","info"),
  APP_TITLE: req("APP_TITLE"),
  APP_URL: opt("APP_URL"),
  RAPIDAPI_HOST: req("RAPIDAPI_HOST"),
  RAPIDAPI_KEY: req("RAPIDAPI_KEY")
};
