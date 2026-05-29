import { describePrompt } from "./workflows";
import type { OperatorBackend } from "./settings";

export function buildCliHandoff(
  vaultPath: string | null,
  prompt: string,
  date = new Date(),
  backend: OperatorBackend = "codex",
  paths: { codexPath?: string; claudePath?: string } = {},
): string {
  const rawPrompt = prompt.trim() || "/daily-init 6";
  const spec = describePrompt(rawPrompt, date);
  const targetVault = vaultPath ?? "<your-vault-path>";
  const cdLine = `cd ${shellQuote(targetVault)}`;
  if (backend === "claude") {
    return [
      cdLine,
      [shellQuote(paths.claudePath ?? "claude"), "-p", shellQuote(spec.prompt)].join(" "),
    ].join("\n");
  }

  const args = [
    shellQuote(paths.codexPath ?? "codex"),
    "exec",
    "--cd",
    shellQuote(targetVault),
    "--skip-git-repo-check",
    "--sandbox",
    "workspace-write",
    "--ask-for-approval",
    "on-request",
  ];
  if (spec.search) {
    args.push("--search");
  }
  args.push(shellQuote(spec.prompt));
  return [
    cdLine,
    args.join(" "),
  ].join("\n");
}

function shellQuote(value: string): string {
  if (!value.includes("/") && /^[A-Za-z0-9_.:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
