import test from "node:test";
import assert from "node:assert/strict";
import { TASK_KEYS, evaluateStart, evaluateReliabilityCompletion } from "../ops_controller/gates.mjs";

const base = {
  tasks: {
    [TASK_KEYS.auditor]: { enabled: true, state: "READY", prerequisites: [] },
    [TASK_KEYS.reliability]: { enabled: true, state: "READY", prerequisites: ["archive_verification:PASS"] },
    [TASK_KEYS.efficiency]: { enabled: true, state: "READY", prerequisites: ["reliability_24h:PASS"] },
  },
  gates: {},
  activeRuns: [],
};

test("auditor starts only when enabled and is constrained to read-only mode", () => {
  assert.deepEqual(evaluateStart(TASK_KEYS.auditor, base), {
    allowed: true, reason: "READY", mode: "READ_ONLY"
  });
});

test("reliability is blocked until archive verification passes", () => {
  assert.equal(evaluateStart(TASK_KEYS.reliability, base).reason, "PREREQUISITE_NOT_MET");
  const ready = { ...base, gates: { archive_verification: "PASS" } };
  assert.equal(evaluateStart(TASK_KEYS.reliability, ready).allowed, true);
});

test("efficiency is blocked until reliability passes", () => {
  assert.equal(evaluateStart(TASK_KEYS.efficiency, base).reason, "PREREQUISITE_NOT_MET");
  const ready = { ...base, gates: { reliability_24h: "PASS" } };
  assert.equal(evaluateStart(TASK_KEYS.efficiency, ready).allowed, true);
});

test("disabled tasks and duplicate active runs cannot start", () => {
  const disabled = { ...base, tasks: { ...base.tasks, [TASK_KEYS.auditor]: { ...base.tasks[TASK_KEYS.auditor], enabled: false } } };
  assert.equal(evaluateStart(TASK_KEYS.auditor, disabled).reason, "DISABLED");
  const active = { ...base, activeRuns: [TASK_KEYS.auditor] };
  assert.equal(evaluateStart(TASK_KEYS.auditor, active).reason, "RUN_ALREADY_ACTIVE");
});

test("reliability cannot pass before a full 24-hour window", () => {
  const result = evaluateReliabilityCompletion("2026-11-05T12:00:00Z", "2026-11-06T11:59:59Z", ["PASS", "PASS"]);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "OBSERVATION_WINDOW_INCOMPLETE");
});

test("reliability passes only after 24 hours and all checks pass", () => {
  const result = evaluateReliabilityCompletion("2026-11-05T12:00:00Z", "2026-11-06T12:00:00Z", ["PASS", "PASS"]);
  assert.equal(result.status, "PASS");
  assert.equal(result.complete, true);
});

test("reliability fails if any observation check fails", () => {
  const result = evaluateReliabilityCompletion("2026-11-05T12:00:00Z", "2026-11-06T12:00:00Z", ["PASS", "FAIL"]);
  assert.equal(result.status, "FAIL");
});
