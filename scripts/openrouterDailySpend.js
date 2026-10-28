import "../config/loadEnv.js";
import { collectOpenRouterDailySpend } from "../services/ops/openrouterSpend.js";

const argument = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const rate = argument("--usd-gbp-rate");
const fx = rate === undefined ? null : { rate: Number(rate), date: argument("--fx-date"), source: argument("--fx-source") };
try {
  const report = await collectOpenRouterDailySpend({ date: argument("--date"), fx });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
