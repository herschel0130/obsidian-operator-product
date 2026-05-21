export type OperatorBackend = "codex" | "claude";

export interface OperatorSettings {
  backend: OperatorBackend;
  codexPath: string;
  claudePath: string;
  repoSource: string;
  availableHours: number;
  vaultOwnerName: string;
  calendarName: string;
  remindersList: string;
  meetingRecordingsBase: string;
  hasAcceptedRunnerWarning: boolean;
  hasOpenedDashboard: boolean;
  lastRun: OperatorRunRecord | null;
}

export interface OperatorRunRecord {
  id: string;
  backend: OperatorBackend;
  prompt: string;
  status: "running" | "success" | "failed" | "cancelled";
  startedAt: string;
  endedAt?: string;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
}

export const DEFAULT_SETTINGS: OperatorSettings = {
  backend: "codex",
  codexPath: "codex",
  claudePath: "claude",
  repoSource: "herschel0130/obsidian-operator-product",
  availableHours: 6,
  vaultOwnerName: "You",
  calendarName: "Operator",
  remindersList: "Operator",
  meetingRecordingsBase: "~/Work/<Project>/Meetings/",
  hasAcceptedRunnerWarning: false,
  hasOpenedDashboard: false,
  lastRun: null,
};
