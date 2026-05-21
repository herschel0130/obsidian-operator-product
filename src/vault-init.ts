import { App, normalizePath, TFile } from "obsidian";
import agentTemplate from "../plugins/obsidian-operator/skills/vault-init/assets/CLAUDE.md";
import backlogTemplate from "../plugins/obsidian-operator/skills/vault-init/assets/vault-template/05_Content/Backlog.md";
import voiceGuideTemplate from "../plugins/obsidian-operator/skills/vault-init/assets/vault-template/05_Content/Voice Guide.md";
import type { OperatorSettings } from "./settings";

const CORE_FOLDERS = [
  "00_Strategy",
  "01_Execution",
  "02_Projects",
  "03_Thinking",
  "04_Knowledge",
  "04_Knowledge/AI-Weekly",
  "04_Knowledge/Academic",
  "04_Knowledge/GitHub",
  "05_Content",
  "05_Content/Archived",
  "05_Content/Drafts",
  "05_Content/Published",
];

const REQUIRED_FILES = ["CLAUDE.md", "AGENTS.md", "05_Content/Backlog.md", "05_Content/Voice Guide.md"];

export interface VaultInitializationStatus {
  ready: boolean;
  missingFolders: string[];
  missingFiles: string[];
}

export interface VaultInitializationResult {
  createdFolders: string[];
  skippedFolders: string[];
  createdFiles: string[];
  updatedFiles: string[];
  skippedFiles: string[];
}

export function checkVaultInitialized(app: App): VaultInitializationStatus {
  const missingFolders = CORE_FOLDERS.filter((folder) => !app.vault.getAbstractFileByPath(folder));
  const missingFiles = REQUIRED_FILES.filter((file) => !(app.vault.getAbstractFileByPath(file) instanceof TFile));

  return {
    ready: missingFolders.length === 0 && missingFiles.length === 0,
    missingFolders,
    missingFiles,
  };
}

export async function initializeVault(app: App, settings: OperatorSettings): Promise<VaultInitializationResult> {
  const result: VaultInitializationResult = {
    createdFolders: [],
    skippedFolders: [],
    createdFiles: [],
    updatedFiles: [],
    skippedFiles: [],
  };

  for (const folder of CORE_FOLDERS) {
    const created = await ensureFolder(app, folder);
    result[created ? "createdFolders" : "skippedFolders"].push(folder);
  }

  const agentConfig = applyCustomization(agentTemplate, settings);
  await ensureOrUpdateAgentFile(app, "CLAUDE.md", agentConfig, settings, result);
  await ensureOrUpdateAgentFile(app, "AGENTS.md", agentConfig, settings, result);
  await ensureFile(app, "05_Content/Backlog.md", backlogTemplate, result);
  await ensureFile(app, "05_Content/Voice Guide.md", voiceGuideTemplate, result);

  return result;
}

export function applyCustomization(template: string, settings: OperatorSettings): string {
  return [
    ["Vault owner name", settings.vaultOwnerName],
    ["Apple Calendar name", settings.calendarName],
    ["Apple Reminders list", settings.remindersList],
    ["Meeting recordings base", settings.meetingRecordingsBase],
  ].reduce((content, [setting, value]) => replaceCustomizationRow(content, setting, value), template);
}

async function ensureFolder(app: App, path: string): Promise<boolean> {
  const normalized = normalizePath(path);
  if (app.vault.getAbstractFileByPath(normalized)) {
    return false;
  }

  await app.vault.createFolder(normalized);
  return true;
}

async function ensureFile(
  app: App,
  path: string,
  content: string,
  result: VaultInitializationResult,
): Promise<void> {
  const normalized = normalizePath(path);
  if (app.vault.getAbstractFileByPath(normalized)) {
    result.skippedFiles.push(normalized);
    return;
  }

  await app.vault.create(normalized, content);
  result.createdFiles.push(normalized);
}

async function ensureOrUpdateAgentFile(
  app: App,
  path: string,
  content: string,
  settings: OperatorSettings,
  result: VaultInitializationResult,
): Promise<void> {
  const normalized = normalizePath(path);
  const existing = app.vault.getAbstractFileByPath(normalized);

  if (existing instanceof TFile) {
    await app.vault.process(existing, (current) => applyCustomization(current, settings));
    result.updatedFiles.push(normalized);
    return;
  }

  if (existing) {
    result.skippedFiles.push(normalized);
    return;
  }

  await app.vault.create(normalized, content);
  result.createdFiles.push(normalized);
}

function replaceCustomizationRow(markdown: string, setting: string, value: string): string {
  const escaped = escapeRegExp(setting);
  const pattern = new RegExp(`(\\|\\s*${escaped}\\s*\\|\\s*)\`[^\`]*\`(\\s*\\|[^\\n]*\\|)`, "m");
  return markdown.replace(pattern, `$1\`${value}\`$2`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
