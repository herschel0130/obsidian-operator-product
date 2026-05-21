import { strict as assert } from "node:assert";
import test from "node:test";
import {
  buildBackendCommand,
  buildCodexExecCommand,
  buildCodexMarketplaceAddCommand,
  buildClaudeCommand,
  runCommand,
  truncateOutput,
} from "../src/runner";

test("builds codex daily command without shell interpolation", () => {
  const spec = buildCodexExecCommand("codex", "/tmp/My Vault", "/daily-init 6", { search: true });

  assert.equal(spec.command, "codex");
  assert.deepEqual(spec.args, [
    "exec",
    "--cd",
    "/tmp/My Vault",
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "never",
    "--search",
    "/daily-init 6",
  ]);
  assert.equal(spec.cwd, "/tmp/My Vault");
});

test("builds codex marketplace add command", () => {
  const spec = buildCodexMarketplaceAddCommand("codex", "herschel0130/obsidian-operator-product");

  assert.equal(spec.command, "codex");
  assert.deepEqual(spec.args, [
    "plugin",
    "marketplace",
    "add",
    "herschel0130/obsidian-operator-product",
  ]);
});

test("builds backend-specific command", () => {
  const spec = buildBackendCommand(
    "codex",
    { codexPath: "codex", claudePath: "claude", vaultPath: "/vault" },
    "/project-init Alpha",
  );

  assert.equal(spec.command, "codex");
  assert.equal(spec.args.at(-1), "/project-init Alpha");

  const claudeSpec = buildClaudeCommand("claude", "/vault", "/project-init Alpha");
  assert.deepEqual(claudeSpec.args, ["-p", "/project-init Alpha"]);
});

test("truncates long output with context", () => {
  const output = truncateOutput("x".repeat(200), 80);

  assert.ok(output.length > 80);
  assert.match(output, /Output truncated/);
});

test("can cancel a running process", async () => {
  const running = runCommand({
    command: process.execPath,
    args: ["-e", "setTimeout(() => console.log('late'), 5000)"],
  });

  setTimeout(() => running.cancel(), 100);
  const result = await running.done;

  assert.equal(result.cancelled, true);
  assert.notEqual(result.signal, null);
});
