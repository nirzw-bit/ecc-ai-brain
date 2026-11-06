// Pure, deterministic gate evaluator. No network, database, or production side effects.
export const TASK_KEYS = Object.freeze({
  auditor: "independent_auditor",
  reliability: "reliability_24h",
  efficiency: "efficiency_challenge",
});

export function evaluateStart(taskKey, snapshot) {
  const task = snapshot?.tasks?.[taskKey];
  if (!task) return { allowed: false, reason: "UNKNOWN_TASK" };
  if (task.enabled !== true) return { allowed: false, reason: "DISABLED" };
  if (task.state !== "READY") return { allowed: false, reason: "TASK_NOT_READY" };
  if (snapshot.activeRuns?.includes(taskKey)) {
    return { allowed: false, reason: "RUN_ALREADY_ACTIVE" };
  }

  for (const requirement of task.prerequisites ?? []) {
    const [gateKey, expected] = requirement.split(":");
    if (snapshot.gates?.[gateKey] !== expected) {
      return { allowed: false, reason: "PREREQUISITE_NOT_MET", requirement };
    }
  }

  return {
    allowed: true,
    reason: "READY",
    mode: taskKey === TASK_KEYS.auditor ? "READ_ONLY" : "CONTROLLED",
  };
}

export function evaluateReliabilityCompletion(startedAt, now, checks) {
  const start = Date.parse(startedAt);
  const end = Date.parse(now);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { complete: false, status: "FAIL", reason: "INVALID_TIME_RANGE" };
  }
  if (end - start < 24 * 60 * 60 * 1000) {
    return { complete: false, status: "BLOCKED", reason: "OBSERVATION_WINDOW_INCOMPLETE" };
  }
  if (!Array.isArray(checks) || checks.length === 0 || checks.some(x => x !== "PASS")) {
    return { complete: false, status: "FAIL", reason: "OBSERVATION_CHECKS_NOT_ALL_PASS" };
  }
  return { complete: true, status: "PASS", reason: "24_HOUR_WINDOW_AND_CHECKS_PASS" };
}
