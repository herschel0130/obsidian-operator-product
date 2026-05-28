import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Platform, type App } from "obsidian";
import { resolveCommandPath } from "./command-resolver";
import { buildCodexLoginStatusCommand, runCommand } from "./runner";
import type { OperatorBackend, OperatorSettings } from "./settings";
import { checkVaultInitialized, type VaultInitializationStatus } from "./vault-init";

export type StatusState = "ready" | "missing" | "warning" | "unknown";

export interface OperatorEnvironmentStatus {
  vault: VaultInitializationStatus;
  codexCli: StatusState;
  codexLogin: StatusState;
  claudeCli: StatusState;
  operatorSkills: StatusState;
  claudeSkills: StatusState;
  gmail: StatusState;
  gemini: StatusState;
  calendar: StatusState;
  multiAgent: StatusState;
  resolvedPaths: {
    codex: string;
    claude: string;
  };
  details: Record<string, string>;
}

export async function checkEnvironment(app: App, settings: OperatorSettings): Promise<OperatorEnvironmentStatus> {
  const resolvedPaths = {
    codex: resolveCommandPath(settings.codexPath),
    claude: resolveCommandPath(settings.claudePath),
  };
  const [codexCli, claudeCli] = await Promise.all([
    commandResponds(resolvedPaths.codex, ["--version"]),
    commandResponds(resolvedPaths.claude, ["--help"]),
  ]);

  const codexLogin = codexCli
    ? await commandSucceeds(buildCodexLoginStatusCommand(resolvedPaths.codex), 8000)
    : false;

  const codexConfig = readCodexConfig();
  const operatorSkills = detectOperatorSkills(settings, codexConfig);
  const claudeSkills = detectClaudeSkills();
  const gmail = await detectGmail(resolvedPaths.codex, codexCli);
  const gemini = detectGemini();
  const multiAgent = codexConfig.includes("multi_agent = true") ? "ready" : "missing";

  return {
    vault: checkVaultInitialized(app),
    codexCli: codexCli ? "ready" : "missing",
    codexLogin: codexLogin ? "ready" : codexCli ? "missing" : "unknown",
    claudeCli: claudeCli ? "ready" : "missing",
    operatorSkills,
    claudeSkills,
    gmail,
    gemini,
    calendar: Platform.isMacOS ? "ready" : "warning",
    multiAgent,
    resolvedPaths,
    details: {
      codexCli: codexCli ? `Codex CLI responds at ${resolvedPaths.codex}.` : `Could not run ${settings.codexPath}.`,
      codexLogin: codexLogin ? "Codex login is active." : "Run codex login before starting agent workflows.",
      claudeCli: claudeCli ? `Claude CLI responds at ${resolvedPaths.claude}.` : `Could not run ${settings.claudePath}.`,
      operatorSkills:
        operatorSkills === "ready"
          ? "Codex Operator plugin is enabled."
          : operatorSkills === "warning"
            ? "Operator marketplace or cache exists, but enable obsidian-operator in Codex before running workflows."
          : "Install the Operator marketplace, then enable the plugin in Codex if prompted.",
      claudeSkills:
        claudeSkills === "ready"
          ? "Claude Code Operator plugin appears installed."
          : claudeSkills === "warning"
            ? "Claude Code Operator files appear cached; confirm the plugin is installed before running workflows."
            : "Install in Claude Code: /plugin marketplace add https://github.com/herschel0130/obsidian-operator-product, then /plugin install obsidian-operator.",
      gmail:
        gmail === "ready"
          ? "Gmail MCP/connector appears configured."
          : "Optional: daily briefings continue without email context.",
      gemini:
        gemini === "ready"
          ? "Gemini transcription key/script detected."
          : "Optional: meeting workflows still accept transcript files or pasted text.",
      calendar: Platform.isMacOS
        ? "Apple Calendar and Reminders workflows can run on this Mac."
        : "Apple Calendar and Reminders automations are macOS-only.",
      multiAgent:
        multiAgent === "ready"
          ? "Codex multi-agent feature flag is enabled."
          : "Optional: deep research can run sequentially without this flag.",
    },
  };
}

export function canRunCodexWorkflows(status: OperatorEnvironmentStatus): boolean {
  return canRunBackendWorkflows(status, "codex");
}

export function canRunBackendWorkflows(status: OperatorEnvironmentStatus, backend: OperatorBackend): boolean {
  return getBackendReadiness(status, backend).ready;
}

export interface BackendReadiness {
  ready: boolean;
  blockers: string[];
  helpText: string;
}

export async function getFreshBackendReadinessForRun(
  refreshStatus: () => Promise<OperatorEnvironmentStatus>,
  backend: OperatorBackend,
  _cachedStatus?: OperatorEnvironmentStatus | null,
): Promise<{ status: OperatorEnvironmentStatus; readiness: BackendReadiness }> {
  const status = await refreshStatus();
  return {
    status,
    readiness: getBackendReadiness(status, backend),
  };
}

export function getBackendReadiness(status: OperatorEnvironmentStatus, backend: OperatorBackend): BackendReadiness {
  const blockers: string[] = [];
  if (!status.vault.ready) {
    blockers.push("Vault setup");
  }

  if (backend === "codex") {
    if (status.codexCli !== "ready") {
      blockers.push("Codex CLI");
    }
    if (status.codexLogin !== "ready") {
      blockers.push("Codex login");
    }
    if (status.operatorSkills !== "ready") {
      blockers.push("Codex Operator skills");
    }
  } else {
    if (status.claudeCli !== "ready") {
      blockers.push("Claude CLI");
    }
    if (status.claudeSkills !== "ready") {
      blockers.push("Claude Operator skills");
    }
  }

  const label = backend === "codex" ? "Codex" : "Claude";
  return (
    {
      ready: blockers.length === 0,
      blockers,
      helpText: blockers.length === 0
        ? `${label} workflows are ready to run.`
        : `${label} workflows need: ${blockers.join(", ")}.`,
    }
  );
}

export function formatWorkflowLockHelp(
  status: OperatorEnvironmentStatus,
  backend: OperatorBackend,
  actionLabel = "Agent workflows",
): string {
  const readiness = getBackendReadiness(status, backend);
  const backendLabel = backend === "codex" ? "Codex" : "Claude";
  if (readiness.ready) {
    return `${actionLabel} can run with ${backendLabel}.`;
  }
  const verb = /\b(workflows|actions|buttons)\b/i.test(actionLabel) ? "need" : "needs";
  return `${actionLabel} ${verb} setup first: ${readiness.blockers.join(", ")}. Open Setup health for the exact fix.`;
}

async function commandResponds(command: string, args: string[]): Promise<boolean> {
  return commandSucceeds({ command, args }, 5000);
}

async function commandSucceeds(spec: { command: string; args: string[] }, timeoutMs: number): Promise<boolean> {
  const running = runCommand(spec, { timeoutMs });
  const result = await running.done;
  return result.exitCode === 0 && !result.timedOut;
}

function readCodexConfig(): string {
  try {
    return readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
  } catch {
    return "";
  }
}

function detectOperatorSkills(settings: OperatorSettings, codexConfig: string): StatusState {
  if (hasEnabledCodexPlugin(codexConfig, "obsidian-operator")) {
    return "ready";
  }

  if (codexConfig.includes("[marketplaces.obsidian-operator]") || codexConfig.includes(settings.repoSource)) {
    return "warning";
  }

  const cacheRoot = join(homedir(), ".codex", "plugins", "cache");
  try {
    if (!existsSync(cacheRoot)) {
      return "missing";
    }
    const entries = readdirSync(cacheRoot);
    return entries.some((entry) => entry.includes("obsidian-operator")) ? "warning" : "missing";
  } catch {
    return "unknown";
  }
}

function hasEnabledCodexPlugin(config: string, pluginName: string): boolean {
  const blockPattern = /\[plugins\."([^"]+)"\]([\s\S]*?)(?=\n\[|$)/g;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(config))) {
    const [, name, body] = match;
    if ((name === pluginName || name.startsWith(`${pluginName}@`)) && /\benabled\s*=\s*true\b/.test(body)) {
      return true;
    }
  }
  return false;
}

function detectClaudeSkills(): StatusState {
  const home = homedir();
  const configFiles = [
    join(home, ".claude.json"),
    join(home, ".claude", "settings.json"),
    join(home, ".claude", "plugins.json"),
    join(home, ".claude", "config.json"),
  ];

  for (const file of configFiles) {
    try {
      if (readFileSync(file, "utf8").includes("obsidian-operator")) {
        return "ready";
      }
    } catch {
      // Config files vary by Claude Code version.
    }
  }

  const pluginRoots = [
    join(home, ".claude", "plugins"),
    join(home, ".claude", "plugins", "cache"),
    join(home, ".claude", "marketplaces"),
  ];
  if (pluginRoots.some((root) => treeContains(root, "obsidian-operator", 5))) {
    return "warning";
  }

  return "missing";
}

function treeContains(root: string, needle: string, maxDepth: number): boolean {
  if (maxDepth < 0) {
    return false;
  }

  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name.includes(needle)) {
        return true;
      }
      if (entry.isDirectory() && treeContains(join(root, entry.name), needle, maxDepth - 1)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

async function detectGmail(codexPath: string, codexCli: boolean): Promise<StatusState> {
  if (!codexCli) {
    return "unknown";
  }
  const result = await runCommand(
    { command: codexPath, args: ["mcp", "list"] },
    { timeoutMs: 8000 },
  ).done;
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (output.includes("gmail") || output.includes("google")) {
    return "ready";
  }
  return "missing";
}

function detectGemini(): StatusState {
  const secretsPath = join(homedir(), ".secrets");
  const scriptPath = join(homedir(), "bin", "gemini-transcribe.sh");
  let hasKey = false;

  try {
    hasKey = readFileSync(secretsPath, "utf8").includes("GEMINI_API_KEY");
  } catch {
    hasKey = false;
  }

  return hasKey && existsSync(scriptPath) ? "ready" : "missing";
}
