import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { OperatorBackend } from "./settings";

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RunCommandOptions {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  timeoutMs?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
  timedOut: boolean;
}

export interface RunningProcess {
  child: ChildProcessWithoutNullStreams;
  cancel: () => void;
  done: Promise<ProcessResult>;
}

export function buildCodexExecCommand(
  codexPath: string,
  vaultPath: string,
  prompt: string,
  options: { search?: boolean } = {},
): CommandSpec {
  const args = [
    "exec",
    "--cd",
    vaultPath,
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "never",
  ];

  if (options.search) {
    args.push("--search");
  }

  args.push(prompt);
  return { command: codexPath, args, cwd: vaultPath };
}

export function buildClaudeCommand(claudePath: string, vaultPath: string, prompt: string): CommandSpec {
  return { command: claudePath, args: ["-p", prompt], cwd: vaultPath };
}

export function buildBackendCommand(
  backend: OperatorBackend,
  paths: { codexPath: string; claudePath: string; vaultPath: string },
  prompt: string,
  options: { search?: boolean } = {},
): CommandSpec {
  if (backend === "claude") {
    return buildClaudeCommand(paths.claudePath, paths.vaultPath, prompt);
  }

  return buildCodexExecCommand(paths.codexPath, paths.vaultPath, prompt, options);
}

export function buildCodexLoginStatusCommand(codexPath: string): CommandSpec {
  return { command: codexPath, args: ["login", "status"] };
}

export function buildCodexMarketplaceAddCommand(codexPath: string, repoSource: string): CommandSpec {
  return { command: codexPath, args: ["plugin", "marketplace", "add", repoSource] };
}

export function buildCodexMarketplaceUpgradeCommand(codexPath: string, marketplaceName?: string): CommandSpec {
  const args = ["plugin", "marketplace", "upgrade"];
  if (marketplaceName) {
    args.push(marketplaceName);
  }
  return { command: codexPath, args };
}

export function truncateOutput(value: string, maxLength = 12000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 120)}\n\n[Output truncated: ${value.length - maxLength + 120} more characters]`;
}

export function runCommand(spec: CommandSpec, options: RunCommandOptions = {}): RunningProcess {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    shell: false,
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  let cancelled = false;
  let timedOut = false;
  let timeout: NodeJS.Timeout | undefined;

  if (options.timeoutMs && options.timeoutMs > 0) {
    timeout = setTimeout(() => {
      timedOut = true;
      cancelled = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);
  }

  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    options.onStdout?.(chunk);
  });

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    options.onStderr?.(chunk);
  });

  const done = new Promise<ProcessResult>((resolve) => {
    child.on("error", (error: Error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      stderr += `${error.message}\n`;
      resolve({
        stdout,
        stderr,
        exitCode: 127,
        signal: null,
        cancelled,
        timedOut,
      });
    });

    child.on("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({
        stdout,
        stderr,
        exitCode,
        signal,
        cancelled,
        timedOut,
      });
    });
  });

  return {
    child,
    cancel: () => {
      cancelled = true;
      if (!child.killed) {
        child.kill("SIGTERM");
      }
    },
    done,
  };
}
