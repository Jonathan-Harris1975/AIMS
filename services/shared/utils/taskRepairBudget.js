import { AsyncLocalStorage } from "node:async_hooks";

const tasks = new AsyncLocalStorage();

export function createTaskRepairBudget({ repairs = 4, recoveries = 4 } = {}) {
  const used = { repairs: 0, recoveries: 0 };
  const limits = { repairs, recoveries };
  return {
    claim(kind) {
      if (used[kind] >= limits[kind]) return false;
      used[kind] += 1;
      return true;
    },
    snapshot: () => ({ limits: { ...limits }, used: { ...used } }),
  };
}

export const currentTaskRepairBudget = () => tasks.getStore();

export function withTaskRepairBudget(work, options) {
  // Nested gates share their parent's allowance; independent jobs stay isolated.
  return tasks.getStore() ? work() : tasks.run(createTaskRepairBudget(options), work);
}

// Observational evaluations must never consume the publishing task's allowance.
export function withIsolatedTaskRepairBudget(work, options) {
  return tasks.run(createTaskRepairBudget(options), work);
}

export function claimRepairAction(kind = "repairs") {
  const budget = currentTaskRepairBudget();
  if (!budget || budget.claim(kind)) return;
  const error = new Error(`Task ${kind} budget exhausted; remaining quality gates still apply`);
  error.code = "AI_TASK_REPAIR_BUDGET_EXHAUSTED";
  error.nonRetryable = true;
  throw error;
}
