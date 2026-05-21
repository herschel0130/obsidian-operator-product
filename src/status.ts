import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Platform, type App } from "obsidian";
import { buildCodexLoginStatusCommand, runCommand } from "./runner";
import type { OperatorSettings } from "./settings";
import { checkVaultInitialized, type VaultInitializationStatus } from "./vault-init";

export type StatusState = "ready" | "missing" | "warning" | "unknown";

export interface OperatorEnvironmentStatus {
  vault: VaultInitializationStatus;
  codexCli: StatusState;
  codexLogin: StatusState;
  claudeCli: StatusState;
  operatorSkills: StatusState;
  gmail: StatusState;
  gemini: StatusState;
  calendar: StatusState;
  multiAgent: StatusState;
  details: Record<string, string>;
}

export async function checkEnvironment(app: App, settings: OperatorSettings): Promise<OperatorEnvironmentStatus> {
  const [codexCli, claudeCli] = await Promise.all([
    commandResponds(settings.codexPath, ["--version"]),
    commandResponds(settings.claudePath, ["--help"]),
  ]);

  const codexLogin = codexCli
    ? await commandSucceeds(buildCodexLoginStatusCommand(settings.codexPath), 8000)
    : false;

  const codexConfig = readCodexConfig();
  const operatorSkills = detectOperatorSkills(settings, codexConfig);
  const gmail = await detectGmail(settings, codexCli);
  const gemini = detectGemini();
  const multiAgent = codexConfig.includes("multi_agent = true") ? "ready" : "missing";

  return {
    vault: checkVaultInitialized(app),
    codexCli: codexCli ? "ready" : "missing",
    codexLogin: codexLogin ? "ready" : codexCli ? "missing" : "unknown",
    claudeCli: claudeCli ? "ready" : "missing",
    operatorSkills,
    gmail,
    gemini,
    calendar: Platform.isMacOS ? "ready" : "warning",
    multiAgent,
    details: {
      codexCli: codexCli ? "Codex CLI responds on PATH." : `Could not run ${settings.codexPath}.`,
      codexLogin: codexLogin ? "Codex login is active." : "Run codex login before starting agent workflows.",
      claudeCli: claudeCli ? "Claude CLI detected." : "Claude backend is hidden until claude is available.",
      operatorSkills:
        operatorSkills === "ready"
          ? "Operator marketplace/cache detected for Codex."
          : operatorSkills === "warning"
            ? "Operator cache exists, but enable the plugin in Codex before running workflows."
          : "Install the Operator marketplace, then enable the plugin in Codex if prompted.",
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
  return (
    status.codexCli === "ready" &&
    status.codexLogin === "ready" &&
    status.operatorSkills === "ready" &&
    status.vault.ready
  );
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
  const needles = ["obsidian-operator", "operator-control", settings.repoSource];
  if (needles.some((needle) => codexConfig.includes(needle))) {
    return "ready";
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

async function detectGmail(settings: OperatorSettings, codexCli: boolean): Promise<StatusState> {
  if (!codexCli) {
    return "unknown";
  }
  const result = await runCommand(
    { command: settings.codexPath, args: ["mcp", "list"] },
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
