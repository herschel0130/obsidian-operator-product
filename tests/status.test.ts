import { strict as assert } from "node:assert";
import test from "node:test";
import {
  canRunBackendWorkflows,
  formatWorkflowLockHelp,
  getBackendReadiness,
  getFreshBackendReadinessForRun,
  type OperatorEnvironmentStatus,
} from "../src/status";

test("Claude backend readiness does not require Codex login", () => {
  const status = createStatus({
    codexLogin: "missing",
    operatorSkills: "missing",
    claudeCli: "ready",
    claudeSkills: "ready",
  });

  assert.equal(canRunBackendWorkflows(status, "claude"), true);
  assert.equal(canRunBackendWorkflows(status, "codex"), false);
  assert.deepEqual(getBackendReadiness(status, "claude").blockers, []);
  assert.deepEqual(getBackendReadiness(status, "codex").blockers, [
    "Codex login",
    "Codex Operator skills",
  ]);
});

test("Claude backend reports missing Claude Operator skills", () => {
  const status = createStatus({
    claudeCli: "ready",
    claudeSkills: "missing",
  });

  const readiness = getBackendReadiness(status, "claude");

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers, ["Claude Operator skills"]);
  assert.match(readiness.helpText, /Claude Operator skills/);
});

test("workflow lock help is backend-specific", () => {
  const claudeStatus = createStatus({
    codexLogin: "missing",
    operatorSkills: "missing",
    claudeCli: "ready",
    claudeSkills: "missing",
  });

  const claudeHelp = formatWorkflowLockHelp(claudeStatus, "claude", "More workflows");

  assert.match(claudeHelp, /More workflows need setup first/);
  assert.match(claudeHelp, /Claude Operator skills/);
  assert.doesNotMatch(claudeHelp, /Codex login/);

  const codexHelp = formatWorkflowLockHelp(createStatus({
    codexLogin: "missing",
    operatorSkills: "ready",
  }), "codex", "Start my day");

  assert.match(codexHelp, /Start my day needs setup first/);
  assert.match(codexHelp, /Codex login/);
});

test("workflow run readiness always uses freshly refreshed status", async () => {
  let refreshes = 0;
  const staleStatus = createStatus({
    codexLogin: "missing",
  });
  const freshStatus = createStatus({
    codexLogin: "ready",
  });

  const result = await getFreshBackendReadinessForRun(async () => {
    refreshes += 1;
    return freshStatus;
  }, "codex", staleStatus);

  assert.equal(refreshes, 1);
  assert.equal(result.status, freshStatus);
  assert.equal(result.readiness.ready, true);
});

function createStatus(overrides: Partial<OperatorEnvironmentStatus>): OperatorEnvironmentStatus {
  return {
    vault: {
      ready: true,
      missingFiles: [],
      missingFolders: [],
    },
    codexCli: "ready",
    codexLogin: "ready",
    claudeCli: "missing",
    operatorSkills: "ready",
    claudeSkills: "missing",
    gmail: "missing",
    gemini: "missing",
    calendar: "ready",
    multiAgent: "missing",
    resolvedPaths: {
      codex: "codex",
      claude: "claude",
    },
    details: {},
    ...overrides,
  };
}
