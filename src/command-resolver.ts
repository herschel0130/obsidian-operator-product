import { accessSync, constants, readdirSync } from "fs";
import { homedir } from "os";
import { delimiter, isAbsolute, join } from "path";

export interface CommandResolutionOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  extraDirs?: string[];
}

const DEFAULT_EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

export function resolveCommandPath(command: string, options: CommandResolutionOptions = {}): string {
  const trimmed = command.trim();
  if (!trimmed || isAbsolute(trimmed) || trimmed.includes("/")) {
    return command;
  }

  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const candidates = [
    ...pathDirs(env.PATH),
    ...(options.extraDirs ?? DEFAULT_EXTRA_DIRS),
    ...nvmBinDirs(homeDir),
  ];

  for (const dir of unique(candidates)) {
    const candidate = join(dir, trimmed);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  return command;
}

function pathDirs(pathValue: string | undefined): string[] {
  if (!pathValue) {
    return [];
  }
  return pathValue.split(delimiter).filter(Boolean);
}

function nvmBinDirs(homeDir: string): string[] {
  const versionsRoot = join(homeDir, ".nvm", "versions", "node");
  try {
    return readdirSync(versionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => join(versionsRoot, version, "bin"));
  } catch {
    return [];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
