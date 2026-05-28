import { strict as assert } from "node:assert";
import test from "node:test";
import {
  canRunBackendWorkflows,
  getBackendReadiness,
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
