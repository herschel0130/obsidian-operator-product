import {
  App,
  ButtonComponent,
  DropdownComponent,
  FileSystemAdapter,
  ItemView,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TextComponent,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import { clearInputAfterSuccessfulCapture } from "./capture-ui";
import { startAlignedMinuteRefresh } from "./clock-refresh";
import { formatDashboardRunContext, formatDateKey, getLocalMinuteKey, hasLocalDateChanged, hasLocalMinuteChanged } from "./dates";
import { buildCliHandoff } from "./cli-handoff";
import { appendQuickCapture, readOperatorHomeState, updateMarkdownTaskState, type OperatorHomeState } from "./home-state";
import { createNativeProject, normalizeProjectName, type NativeProjectInput } from "./projects";
import { attachActiveRunAndRender } from "./run-lifecycle";
import {
  buildBackendCommand,
  buildCodexMarketplaceAddCommand,
  buildCodexMarketplaceUpgradeCommand,
  runCommand,
  truncateOutput,
  type RunningProcess,
} from "./runner";
import { formatExpectedNoteStatus, formatRunCompletionNotice } from "./run-notices";
import { DEFAULT_SETTINGS, type OperatorRunRecord, type OperatorSettings } from "./settings";
import {
  canRunBackendWorkflows,
  checkEnvironment,
  formatWorkflowUnavailableHelp,
  getBackendReadiness,
  getFreshBackendReadinessForRun,
  getFreshWorkflowLaunchGate,
  type OperatorEnvironmentStatus,
  type StatusState,
} from "./status";
import { buildTodayScheduleLines } from "./today-surface";
import type { MarkdownActionItem } from "./vault-parsers";
import { initializeVault, type VaultInitializationResult } from "./vault-init";
import {
  buildAdvancedPromptPlaceholder,
  buildDefaultDailyPrompt,
  buildStrategyPeriodPlaceholder,
  buildStartDaySpec,
  buildWeeklyPeriodPlaceholder,
  buildWorkflowSpec,
  describePrompt,
  normalizeDailyHours,
  resolveAdvancedPrompt,
  resolveAnnualShortcutInput,
  resolveAnnualYearInput,
  resolveAvailableHoursInput,
  resolveEditedPreviewSpec,
  resolveQuarterlyPeriodInput,
  resolveWeeklyPeriodInput,
  type OperatorWorkflowRunSpec,
} from "./workflows";

const VIEW_TYPE_OPERATOR = "operator-control-view";
const CLAUDE_INSTALL_COMMANDS = [
  "/plugin marketplace add https://github.com/herschel0130/obsidian-operator-product",
  "/plugin install obsidian-operator",
].join("\n");

export default class OperatorControlPlugin extends Plugin {
  settings: OperatorSettings = { ...DEFAULT_SETTINGS };
  status: OperatorEnvironmentStatus | null = null;
  activeRun: RunningProcess | null = null;
  activeRunBuffer: OperatorRunRecord | null = null;
  private renderedDateKey = formatDateKey(new Date());
  private renderedMinuteKey = getLocalMinuteKey(new Date());

  async onload(): Promise<void> {
    await this.loadSettings();
    this.startClockRefresh();

    this.registerView(VIEW_TYPE_OPERATOR, (leaf) => new OperatorDashboardView(leaf, this));

    this.addRibbonIcon("layout-dashboard", "Open Operator", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open dashboard",
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: "run-daily-briefing",
      name: "Run daily briefing",
      callback: () => void this.runDailyBriefing(this.settings.availableHours),
    });

    this.addCommand({
      id: "initialize-vault",
      name: "Initialize vault",
      callback: () => void this.initializeVaultFromUi(),
    });

    this.addSettingTab(new OperatorSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (!this.settings.hasOpenedDashboard) {
        this.settings.hasOpenedDashboard = true;
        void this.saveSettings();
        void this.activateView();
      }
    });
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<OperatorSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      optionalModules: {
        ...DEFAULT_SETTINGS.optionalModules,
        ...(loaded?.optionalModules ?? {}),
      },
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private startClockRefresh(): void {
    this.register(startAlignedMinuteRefresh(() => this.refreshViewsAfterClockTick(), {
      now: () => new Date(),
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => window.clearTimeout(handle),
    }));
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_OPERATOR)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_OPERATOR, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async refreshStatus(options: { render: boolean } = { render: true }): Promise<OperatorEnvironmentStatus> {
    this.status = await checkEnvironment(this.app, this.settings);
    if (options.render) {
      this.renderViews();
    }
    return this.status;
  }

  getVaultPath(): string | null {
    if (!Platform.isDesktopApp) {
      return null;
    }

    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
    return null;
  }

  async initializeVaultFromUi(): Promise<void> {
    try {
      const result = await initializeVault(this.app, this.settings);
      new Notice(summarizeInitialization(result));
      await this.refreshStatus();
    } catch (error) {
      new Notice(`Operator setup failed: ${formatError(error)}`);
    }
  }

  async installOrUpdateCodexMarketplace(): Promise<void> {
    if (this.activeRun) {
      new Notice("Operator is already running a command.");
      return;
    }

    const status = this.status ?? (await this.refreshStatus());
    const installed = status.operatorSkills === "ready" || status.operatorSkills === "warning";
    const spec = installed
      ? buildCodexMarketplaceUpgradeCommand(status.resolvedPaths.codex)
      : buildCodexMarketplaceAddCommand(status.resolvedPaths.codex, this.settings.repoSource);

    const startedAt = new Date().toISOString();
    this.activeRunBuffer = {
      id: `marketplace-${Date.now()}`,
      backend: "codex",
      prompt: spec.args.join(" "),
      status: "running",
      startedAt,
      stdout: "",
      stderr: "",
    };
    this.settings.lastRun = this.activeRunBuffer;
    await this.saveSettings();

    const running = runCommand(spec, {
      onStdout: (chunk) => this.appendActiveOutput("stdout", chunk),
      onStderr: (chunk) => this.appendActiveOutput("stderr", chunk),
    });
    attachActiveRunAndRender(this, running);

    const result = await running.done;
    await this.finishActiveRun(result.exitCode === 0 ? "success" : "failed", result);
    await this.refreshStatus();
  }

  async runDailyBriefing(hours: number, manualItems = ""): Promise<void> {
    const safeHours = normalizeDailyHours(hours || this.settings.availableHours);
    this.settings.availableHours = safeHours;
    await this.saveSettings();
    await this.previewAndRunWorkflow(buildStartDaySpec(safeHours, manualItems, new Date(), this.settings.optionalModules));
  }

  async runProjectInit(projectName: string): Promise<void> {
    const trimmed = projectName.trim();
    if (!trimmed) {
      new Notice("Enter a project name first.");
      return;
    }
    await this.openProjectCreation(trimmed);
  }

  async openProjectCreation(projectName = ""): Promise<void> {
    new NativeProjectModal(this.app, projectName, (input) => {
      if (input) {
        void this.createProjectFromUi(input);
      }
    }).open();
  }

  async createProjectFromUi(input: NativeProjectInput): Promise<void> {
    try {
      const result = await createNativeProject(this.app, input);
      new Notice(`Project created at ${result.notePath}.`);
      await this.openVaultPath(result.notePath);
      await this.refreshStatus();
    } catch (error) {
      new Notice(`Project setup failed: ${formatError(error)}`);
    }
  }

  async updateTaskFromUi(path: string, item: MarkdownActionItem, marker: " " | "x" | ">"): Promise<void> {
    try {
      await updateMarkdownTaskState(this.app, path, item.raw, marker);
      new Notice(marker === "x" ? "Task marked done." : marker === ">" ? "Task carried forward." : "Task reopened.");
      this.renderViews();
    } catch (error) {
      new Notice(`Task update failed: ${formatError(error)}`);
    }
  }

  async previewAndRunWorkflow(spec: OperatorWorkflowRunSpec): Promise<void> {
    const gate = await getFreshWorkflowLaunchGate(
      () => this.refreshStatus(),
      this.settings.backend,
      spec.label,
    );
    if (!gate.ready) {
      new Notice(gate.noticeText);
      return;
    }

    const confirmed = await this.confirmRunPreview(spec);
    if (!confirmed) {
      return;
    }
    await this.runOperatorPrompt(confirmed.prompt, { search: confirmed.search, workflow: confirmed });
  }

  async runOperatorPrompt(prompt: string, options: { search?: boolean; workflow?: OperatorWorkflowRunSpec }): Promise<void> {
    if (this.activeRun) {
      new Notice("Operator is already running.");
      return;
    }

    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      new Notice("Operator can only run workflows in the desktop app.");
      return;
    }

    const { status, readiness } = await getFreshBackendReadinessForRun(
      () => this.refreshStatus(),
      this.settings.backend,
      this.status,
    );
    if (!readiness.ready) {
      new Notice(`Finish setup first: ${readiness.helpText}`);
      return;
    }

    if (!(await this.ensureRunnerConsent())) {
      return;
    }

    const spec = buildBackendCommand(
      this.settings.backend,
      {
        codexPath: status.resolvedPaths.codex,
        claudePath: status.resolvedPaths.claude,
        vaultPath,
      },
      prompt,
      options,
    );

    const startedAt = new Date().toISOString();
    this.activeRunBuffer = {
      id: `operator-${Date.now()}`,
      backend: this.settings.backend,
      prompt,
      workflowLabel: options.workflow?.label,
      expectedOpenPath: options.workflow?.expectedOpenPath,
      readAreas: options.workflow?.readAreas,
      writeAreas: options.workflow?.writeAreas,
      status: "running",
      startedAt,
      stdout: "",
      stderr: "",
    };
    this.settings.lastRun = this.activeRunBuffer;
    await this.saveSettings();

    const running = runCommand(spec, {
      onStdout: (chunk) => this.appendActiveOutput("stdout", chunk),
      onStderr: (chunk) => this.appendActiveOutput("stderr", chunk),
    });
    attachActiveRunAndRender(this, running);

    const result = await running.done;
    const statusName = result.cancelled ? "cancelled" : result.exitCode === 0 ? "success" : "failed";
    await this.finishActiveRun(statusName, result);
    await this.refreshStatus();
  }

  async appendCapture(kind: "idea" | "task" | "meeting" | "research", text: string): Promise<boolean> {
    try {
      const path = await appendQuickCapture(this.app, kind, text);
      new Notice(`Captured to ${path}.`);
      this.renderViews();
      return true;
    } catch (error) {
      new Notice(`Capture failed: ${formatError(error)}`);
      return false;
    }
  }

  async openVaultPath(path: string): Promise<boolean> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(`Note not found: ${path}`);
      return false;
    }
    await this.app.workspace.getLeaf(false).openFile(file);
    return true;
  }

  cancelActiveRun(): void {
    if (!this.activeRun) {
      return;
    }
    this.activeRun.cancel();
    new Notice("Stopping Operator run...");
  }

  private appendActiveOutput(stream: "stdout" | "stderr", chunk: string): void {
    if (!this.activeRunBuffer) {
      return;
    }
    this.activeRunBuffer[stream] = truncateOutput(this.activeRunBuffer[stream] + chunk);
    this.settings.lastRun = this.activeRunBuffer;
    this.renderViews();
  }

  private async finishActiveRun(
    status: OperatorRunRecord["status"],
    result: { stdout: string; stderr: string; exitCode: number | null; signal: NodeJS.Signals | null },
  ): Promise<void> {
    if (this.activeRunBuffer) {
      this.activeRunBuffer.status = status;
      this.activeRunBuffer.endedAt = new Date().toISOString();
      this.activeRunBuffer.stdout = truncateOutput(result.stdout);
      this.activeRunBuffer.stderr = truncateOutput(result.stderr);
      this.activeRunBuffer.exitCode = result.exitCode;
      this.activeRunBuffer.signal = result.signal;
      this.settings.lastRun = this.activeRunBuffer;
    }

    this.activeRun = null;
    this.activeRunBuffer = null;
    await this.saveSettings();
    let openedExpectedNote = false;
    if (status === "success" && this.settings.lastRun?.expectedOpenPath) {
      const file = this.app.vault.getAbstractFileByPath(this.settings.lastRun.expectedOpenPath);
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(file);
        openedExpectedNote = true;
      }
    }
    this.renderViews();
    new Notice(formatRunCompletionNotice(status, this.settings.lastRun?.expectedOpenPath, openedExpectedNote));
  }

  private async confirmRunPreview(spec: OperatorWorkflowRunSpec): Promise<OperatorWorkflowRunSpec | null> {
    const vaultPath = this.getVaultPath() ?? "Current Obsidian vault";
    return new Promise<OperatorWorkflowRunSpec | null>((resolve) => {
      new RunPreviewModal(this.app, spec, this.settings.backend, vaultPath, resolve).open();
    });
  }

  private async ensureRunnerConsent(): Promise<boolean> {
    if (this.settings.hasAcceptedRunnerWarning) {
      return true;
    }

    const accepted = await new Promise<boolean>((resolve) => {
      new RunnerConsentModal(this.app, resolve).open();
    });

    if (accepted) {
      this.settings.hasAcceptedRunnerWarning = true;
      await this.saveSettings();
    }

    return accepted;
  }

  renderViews(): void {
    const now = new Date();
    this.renderedDateKey = formatDateKey(now);
    this.renderedMinuteKey = getLocalMinuteKey(now);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_OPERATOR)) {
      const view = leaf.view;
      if (view instanceof OperatorDashboardView) {
        void view.render();
      }
    }
  }

  private refreshViewsAfterClockTick(): void {
    const now = new Date();
    if (hasLocalDateChanged(this.renderedDateKey, now)) {
      this.renderedDateKey = formatDateKey(now);
      this.renderedMinuteKey = getLocalMinuteKey(now);
      this.renderViews();
      return;
    }

    if (!hasLocalMinuteChanged(this.renderedMinuteKey, now)) {
      return;
    }

    this.renderedMinuteKey = getLocalMinuteKey(now);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_OPERATOR)) {
      const view = leaf.view;
      if (view instanceof OperatorDashboardView) {
        view.updateHeaderClock(now);
      }
    }
  }
}

class OperatorDashboardView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: OperatorControlPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_OPERATOR;
  }

  getDisplayText(): string {
    return "Operator";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    await this.plugin.refreshStatus({ render: false });
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("operator-control-view");

    const renderDate = new Date();
    const status = this.plugin.status ?? (await this.plugin.refreshStatus());
    const home = await readOperatorHomeState(this.app, renderDate);

    const root = container.createDiv({ cls: "operator-control" });
    const header = root.createDiv({ cls: "operator-hero" });
    const titleWrap = header.createDiv();
    titleWrap.createEl("p", { cls: "operator-eyebrow", text: "Operator" });
    titleWrap.createEl("h2", { text: "Today in your vault" });
    const headerMeta = titleWrap.createEl("p", {
      cls: "operator-muted",
      text: status.vault.ready
        ? `${formatDashboardRunContext(renderDate)} · ${home.dailyNotePath}`
        : "Initialize the Markdown structure once, then use the vault itself as the interface.",
    });
    if (status.vault.ready) {
      headerMeta.addClass("operator-clock-meta");
      headerMeta.setAttr("data-daily-note-path", home.dailyNotePath);
    }

    const headerActions = header.createDiv({ cls: "operator-hero-actions" });
    createButton(headerActions, "refresh-cw", "Refresh", () => void this.plugin.refreshStatus());
    if (this.plugin.activeRun) {
      createButton(headerActions, "square", "Cancel run", () => this.plugin.cancelActiveRun(), "operator-danger");
    }

    if (!status.vault.ready) {
      this.renderOnboarding(root, status);
      this.renderSetup(root, status, true);
      this.renderRunLog(root);
      return;
    }

    this.renderToday(root, status, home);
    this.renderQuickCapture(root, home);
    this.renderHomePanels(root, status, home);
    this.renderWorkflowShortcuts(root, status, home, renderDate);
    this.renderSetup(root, status, true);
    this.renderRunLog(root);
  }

  private renderOnboarding(root: HTMLElement, status: OperatorEnvironmentStatus): void {
    const section = createSection(root, "Get started", "Set up the Markdown system once, then use Operator Home as a light native control layer.");
    const steps = section.createDiv({ cls: "operator-onboarding-grid" });
    const backend = this.plugin.settings.backend;
    const backendLabel = backend === "codex" ? "Codex" : "Claude";
    const backendSkillsReady = backend === "codex" ? status.operatorSkills === "ready" : status.claudeSkills === "ready";
    const readiness = getBackendReadiness(status, backend);

    renderStepCard(
      steps,
      "1",
      `Install ${backendLabel} skills`,
      backendSkillsReady ? `${backendLabel} Operator skills are installed.` : `Install the Operator skills for ${backendLabel}.`,
      backendSkillsReady ? "ready" : "needed",
    );
    renderStepCard(
      steps,
      "2",
      "Initialize vault",
      status.vault.ready ? "Core folders and agent config are present." : "Create the folders, AGENTS.md, CLAUDE.md, and starter content files.",
      status.vault.ready ? "ready" : "needed",
    );
    renderStepCard(
      steps,
      "3",
      "Start day",
      readiness.ready ? "Daily briefing is ready to run." : readiness.helpText,
      readiness.ready ? "ready" : "locked",
    );

    this.renderSetupControls(section, status);

    if (!readiness.ready) {
      section.createEl("p", {
        cls: "operator-help",
        text: `${readiness.helpText} Setup health below shows the exact missing piece.`,
      });
    }
  }

  private renderSetup(root: HTMLElement, status: OperatorEnvironmentStatus, collapsed: boolean): void {
    const section = collapsed
      ? createDisclosureSection(root, "Setup health", "Selected backend readiness first; optional integrations are labeled optional.")
      : createSection(root, "Setup", "Make the hidden agent pieces visible before you run anything.");
    const grid = section.createDiv({ cls: "operator-status-grid" });

    renderStatusTile(grid, "Vault", status.vault.ready ? "ready" : "missing", status.vault.ready
      ? "Core folders and agent config are present."
      : `Missing ${status.vault.missingFolders.length + status.vault.missingFiles.length} setup item(s).`);
    if (this.plugin.settings.backend === "codex") {
      renderStatusTile(grid, "Codex CLI", status.codexCli, status.details.codexCli);
      renderStatusTile(grid, "Codex login", status.codexLogin, status.details.codexLogin);
      renderStatusTile(grid, "Codex Operator skills", status.operatorSkills, status.details.operatorSkills);
      renderStatusTile(grid, "Claude CLI", status.claudeCli, status.details.claudeCli, true);
      renderStatusTile(grid, "Claude Operator skills", status.claudeSkills, status.details.claudeSkills, true);
    } else {
      renderStatusTile(grid, "Claude CLI", status.claudeCli, status.details.claudeCli);
      renderStatusTile(grid, "Claude Operator skills", status.claudeSkills, status.details.claudeSkills);
      renderStatusTile(grid, "Codex CLI", status.codexCli, status.details.codexCli, true);
      renderStatusTile(grid, "Codex login", status.codexLogin, status.details.codexLogin, true);
      renderStatusTile(grid, "Codex Operator skills", status.operatorSkills, status.details.operatorSkills, true);
    }
    renderStatusTile(grid, "Gmail", status.gmail, status.details.gmail, true);
    renderStatusTile(grid, "Gemini", status.gemini, status.details.gemini, true);
    renderStatusTile(grid, "Calendar", status.calendar, status.details.calendar, true);
    renderStatusTile(grid, "Multi-agent", status.multiAgent, status.details.multiAgent, true);

    this.renderSetupControls(section, status);
  }

  private renderSetupControls(section: HTMLElement, status: OperatorEnvironmentStatus): void {
    const controls = section.createDiv({ cls: "operator-controls-row" });
    const setupLockHelp = this.plugin.activeRun
      ? "Operator is already running. Use Cancel run before changing setup."
      : undefined;
    if (this.plugin.settings.backend === "codex") {
      const codexSkillsDisabled = status.codexCli !== "ready" || !!this.plugin.activeRun;
      const codexSkillsHelp = status.codexCli !== "ready"
        ? "Set a working Codex executable before installing Codex skills."
        : setupLockHelp;
      createButton(controls, "download", status.operatorSkills === "ready" || status.operatorSkills === "warning" ? "Update Codex skills" : "Install Codex skills", () => {
        void this.plugin.installOrUpdateCodexMarketplace();
      }, undefined, codexSkillsDisabled, codexSkillsHelp);
    } else {
      createButton(controls, "copy", "Copy Claude install", () => {
        void copyTextToClipboard(CLAUDE_INSTALL_COMMANDS, "Claude install commands copied.");
      }, undefined, !!this.plugin.activeRun, setupLockHelp);
    }
    createButton(controls, "folder-check", status.vault.ready ? "Refresh vault setup" : "Initialize vault", () => {
      void this.plugin.initializeVaultFromUi();
    }, "mod-cta", !!this.plugin.activeRun, setupLockHelp);
  }

  private renderToday(root: HTMLElement, status: OperatorEnvironmentStatus, home: OperatorHomeState): void {
    const section = createSection(root, "Today", home.daily.exists
      ? "Markdown remains the workspace. Operator only surfaces the note's current state."
      : "No daily note yet. Start a briefing or capture something to create it.");
    section.addClass("operator-today-section");

    const row = section.createDiv({ cls: "operator-command-strip" });
    const hoursWrap = row.createDiv({ cls: "operator-field" });
    hoursWrap.createEl("label", { text: "Available hours" });
    const hoursInput = hoursWrap.createEl("input", {
      attr: {
        type: "number",
        min: "1",
        max: "16",
        step: "0.5",
        value: String(this.plugin.settings.availableHours),
      },
    });
    hoursInput.addEventListener("change", () => {
      const resolvedHours = resolveAvailableHoursInput(hoursInput.value, this.plugin.settings.availableHours);
      this.plugin.settings.availableHours = resolvedHours;
      hoursInput.value = String(resolvedHours);
      this.updateAdvancedPromptPlaceholders(resolvedHours);
      void this.plugin.saveSettings();
    });

    const manualWrap = row.createDiv({ cls: "operator-field operator-grow" });
    manualWrap.createEl("label", { text: "Manual items" });
    const manualInput = manualWrap.createEl("textarea", {
      cls: "operator-manual-input",
      attr: {
        rows: "2",
        placeholder: "Optional: one item per line",
      },
    });

    const canRun = this.canRun(status);
    const lockHelp = canRun
      ? undefined
      : formatWorkflowUnavailableHelp(status, this.plugin.settings.backend, "Start my day", !!this.plugin.activeRun);
    createButton(row, "sun", "Start my day", () => {
      const resolvedHours = resolveAvailableHoursInput(hoursInput.value, this.plugin.settings.availableHours);
      void this.plugin.runDailyBriefing(resolvedHours, manualInput.value);
    }, "mod-cta", !canRun, lockHelp);
    createButton(row, "file-text", "Open today", () => void this.plugin.openVaultPath(home.dailyNotePath), undefined, !home.daily.exists);
    createButton(row, "list-checks", "Open week", () => void this.plugin.openVaultPath(home.weeklyTodoPath), undefined, !home.weeklyTodo.exists);

    section.createEl("p", {
      cls: "operator-help",
      text: "Start my day keeps weekly, monthly, and quarterly planning current when needed.",
    });

    if (!canRun) {
      section.createEl("p", {
        cls: "operator-help",
        text: lockHelp,
      });
    }

    const grid = section.createDiv({ cls: "operator-today-grid" });
    const focus = grid.createDiv({ cls: "operator-note-panel operator-focus-panel" });
    focus.createEl("h4", { text: "Focus" });
    renderTextList(focus, home.daily.focus, home.daily.exists ? "No ## Focus section yet." : "Start my day will write today's focus.");

    const tasks = grid.createDiv({ cls: "operator-note-panel" });
    tasks.createEl("h4", { text: "Next actions" });
    const actions = home.daily.tasks.slice(0, 8);
    this.renderActionItems(tasks, actions, home.dailyNotePath, home.weeklyTodo.openTasks.length > 0
      ? "Today's note has no open tasks. Check the weekly list below."
      : "No open tasks found yet.");

    const schedule = grid.createDiv({ cls: "operator-note-panel" });
    schedule.createEl("h4", { text: "Schedule" });
    renderTextList(schedule, buildTodayScheduleLines(home.daily.schedule, home.blockers.meetings), "No schedule lines or meetings for today.");

    if (home.weeklyTodo.openTasks.length > 0) {
      const week = grid.createDiv({ cls: "operator-note-panel" });
      week.createEl("h4", { text: "Weekly queue" });
      this.renderActionItems(week, home.weeklyTodo.openTasks.slice(0, 6), home.weeklyTodoPath, "Weekly Todo has no open tasks.");
    }
  }

  private renderActionItems(parent: HTMLElement, items: MarkdownActionItem[], sourcePath: string, emptyText: string): void {
    if (items.length === 0) {
      parent.createEl("p", { cls: "operator-muted", text: emptyText });
      return;
    }

    const list = parent.createEl("ul", { cls: "operator-list" });
    for (const item of items) {
      const row = list.createEl("li");
      row.createEl("span", { text: item.text });
      const actions = row.createDiv({ cls: "operator-inline-actions" });
      createButton(actions, "check", "Done", () => {
        void this.plugin.updateTaskFromUi(sourcePath, item, "x");
      });
      createButton(actions, "corner-down-right", "Carry", () => {
        void this.plugin.updateTaskFromUi(sourcePath, item, ">");
      });
    }
  }

  private renderHomePanels(root: HTMLElement, status: OperatorEnvironmentStatus, home: OperatorHomeState): void {
    const canRun = this.canRun(status);
    const lockHelp = canRun
      ? undefined
      : formatWorkflowUnavailableHelp(status, this.plugin.settings.backend, "Current Work", !!this.plugin.activeRun);
    const section = createSection(root, "Current Work", `${home.weekFolder} supplies project context, blockers, and meeting prep.`);
    const grid = section.createDiv({ cls: "operator-home-grid" });

    const projects = grid.createDiv({ cls: "operator-home-panel" });
    const projectsHeader = projects.createDiv({ cls: "operator-panel-title-row" });
    projectsHeader.createEl("h4", { text: "Active projects" });
    createButton(projectsHeader, "folder-plus", "New", () => void this.plugin.openProjectCreation(), "operator-quiet-button");
    if (home.activeProjects.length === 0) {
      projects.createEl("p", { cls: "operator-muted", text: "No active project notes found. Create one natively, then sync when it has context." });
    } else {
      const list = projects.createEl("ul", { cls: "operator-list" });
      for (const project of home.activeProjects.slice(0, 5)) {
        const item = list.createEl("li");
        item.createEl("strong", { text: project.name });
        item.createEl("span", { text: project.nextActions.join(" ") });
        const actions = item.createDiv({ cls: "operator-inline-actions" });
        createButton(actions, "file-text", "Open", () => void this.plugin.openVaultPath(project.notePath));
        createButton(actions, "refresh-cw", "Sync", () => {
          void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("project-sync", project.name));
        }, undefined, !canRun, lockHelp);
      }
    }

    const meetings = grid.createDiv({ cls: "operator-home-panel" });
    meetings.createEl("h4", { text: "Meetings" });
    const visibleMeetings = home.blockers.meetings.filter((meeting) => meeting.timing !== "past").slice(0, 5);
    if (visibleMeetings.length === 0) {
      meetings.createEl("p", { cls: "operator-muted", text: "No upcoming unchecked meetings found in this week's Blockers.md." });
    } else {
      const list = meetings.createEl("ul", { cls: "operator-list" });
      for (const meeting of visibleMeetings) {
        const item = list.createEl("li");
        item.createEl("strong", { text: meeting.timing });
        item.createEl("span", { text: meeting.dateIso ? `${meeting.dateIso} - ${meeting.text}` : meeting.text });
        const actions = item.createDiv({ cls: "operator-inline-actions" });
        createButton(actions, "check", "Done", () => {
          void this.plugin.updateTaskFromUi(home.blockersPath, meeting, "x");
        });
        if (meeting.project) {
          const args = [meeting.project, meeting.dateIso].filter(Boolean).join(" ");
          createButton(actions, "clipboard-list", "Prep", () => {
            void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("meeting-prep", args));
          }, undefined, !canRun, lockHelp);
        }
      }
    }
    createButton(meetings, "file-text", "Open blockers", () => void this.plugin.openVaultPath(home.blockersPath), undefined, !home.blockersExists);

    const waiting = grid.createDiv({ cls: "operator-home-panel" });
    waiting.createEl("h4", { text: "Waiting on" });
    if (home.blockers.waitingOn.length === 0) {
      waiting.createEl("p", { cls: "operator-muted", text: "No unchecked Waiting On items in this week's Blockers.md." });
    } else {
      const list = waiting.createEl("ul", { cls: "operator-list" });
      for (const item of home.blockers.waitingOn.slice(0, 6)) {
        const row = list.createEl("li");
        row.createEl("span", { text: item.text });
        const actions = row.createDiv({ cls: "operator-inline-actions" });
        createButton(actions, "check", "Done", () => {
          void this.plugin.updateTaskFromUi(home.blockersPath, item, "x");
        });
      }
    }
  }

  private renderWorkflowShortcuts(root: HTMLElement, status: OperatorEnvironmentStatus, home: OperatorHomeState, date: Date): void {
    const section = createDisclosureSection(root, "More workflows", "Native actions handle fixed structure; agent workflows and CLI-style prompts stay available here.");
    const canRun = this.canRun(status);
    const lockHelp = canRun
      ? undefined
      : formatWorkflowUnavailableHelp(status, this.plugin.settings.backend, "More workflows", !!this.plugin.activeRun);
    if (lockHelp) {
      section.createEl("p", { cls: "operator-help", text: lockHelp });
    }
    const createAgentWorkflowButton = (
      parent: HTMLElement,
      icon: string,
      label: string,
      onClick: () => void,
      extraClass?: string,
    ) => createButton(parent, icon, label, onClick, extraClass, !canRun, lockHelp);
    const grid = section.createDiv({ cls: "operator-workflow-grid" });

    const now = date;
    const planWeek = createWorkflowCard(grid, "Plan week", "Open or review the current execution layer.");
    const weekInput = createInlineInput(planWeek, "Week", buildWeeklyPeriodPlaceholder(now));
    createAgentWorkflowButton(planWeek, "calendar-plus", "Weekly setup", () => {
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("weekly-init", resolveWeeklyPeriodInput("init", weekInput.value)));
    });
    createAgentWorkflowButton(planWeek, "list-checks", "Weekly review", () => {
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("weekly-review", resolveWeeklyPeriodInput("review", weekInput.value)));
    });

    const strategy = createWorkflowCard(grid, "Strategy review", "Annual vision/review, quarterly plans, monthly pulses, and quarter reviews stay one click away.");
    const annualYearInput = createInlineInput(strategy, "Year", "YYYY; vision accepts next; review accepts last");
    const strategyPeriodInput = createInlineInput(strategy, "Period", buildStrategyPeriodPlaceholder(now));
    createAgentWorkflowButton(strategy, "compass", "Annual vision", () => {
      const annual = resolveAnnualShortcutInput("vision", annualYearInput.value);
      annualYearInput.value = annual.nextInputValue;
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("annual-vision", annual.year));
    });
    createAgentWorkflowButton(strategy, "book-open-check", "Annual review", () => {
      const annual = resolveAnnualShortcutInput("review", annualYearInput.value);
      annualYearInput.value = annual.nextInputValue;
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("annual-vision", `review ${annual.year}`));
    });
    createAgentWorkflowButton(strategy, "milestone", "Quarter plan", () => {
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("quarterly-plan", resolveQuarterlyPeriodInput("init", strategyPeriodInput.value)));
    });
    createAgentWorkflowButton(strategy, "activity", "Monthly pulse", () => {
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("quarterly-plan", resolveQuarterlyPeriodInput("pulse", strategyPeriodInput.value)));
    });
    createAgentWorkflowButton(strategy, "history", "Quarter review", () => {
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("quarterly-plan", resolveQuarterlyPeriodInput("review", strategyPeriodInput.value)));
    });

    const project = createWorkflowCard(grid, "Work on project", "Create structure natively, or run agent workflows when context needs synthesis.");
    const projectInput = createInlineInput(project, "Project name", "Customer Discovery", home.activeProjects[0]?.name ?? "");
    createButton(project, "folder-plus", "New project", () => void this.plugin.openProjectCreation(projectInput.value));
    createAgentWorkflowButton(project, "terminal", "Run /project-init", () => {
      const projectName = requireInput(projectInput, "a project name");
      if (projectName) {
        void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("project-init", projectName));
      }
    });
    createAgentWorkflowButton(project, "refresh-cw", "Sync", () => {
      const projectName = requireInput(projectInput, "a project name");
      if (projectName) {
        void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("project-sync", projectName));
      }
    });
    createAgentWorkflowButton(project, "target", "Deadline plan", () => {
      const projectName = requireInput(projectInput, "a project name");
      if (projectName) {
        void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("deadline-plan", projectName));
      }
    });

    const meeting = createWorkflowCard(grid, "Process meeting", "Prep before, process transcript after.");
    const meetingProject = createInlineInput(meeting, "Project", "ProjectAlpha", home.activeProjects[0]?.name ?? "");
    const meetingDate = createInlineInput(meeting, "Date", "YYYY-MM-DD", formatDateKey(now));
    const meetingInput = createBlockInput(meeting, "Transcript path or text", "Paste transcript text, or enter a local transcript/audio path");
    createAgentWorkflowButton(meeting, "clipboard-list", "Prep", () => {
      const projectName = requireInput(meetingProject, "a project name");
      if (projectName) {
        void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("meeting-prep", `${projectName} ${meetingDate.value}`));
      }
    });
    createAgentWorkflowButton(meeting, "mic", "Process", () => {
      const meetingSource = requireInput(meetingInput, "a transcript path or pasted transcript");
      if (meetingSource) {
        void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("meeting", meetingSource));
      }
    });

    const optionalSection = createDisclosureSection(section, "Optional modules", "Enable interest-specific workflows deliberately; they are not required for the daily concierge.");
    const optionalModules = optionalSection.createDiv({ cls: "operator-workflow-grid" });

    const content = createWorkflowCard(optionalModules, "Content", "Mine notes, draft, or run a deeper research brief when this workflow fits your day.");
    const topicInput = createInlineInput(content, "Topic or backlog item", "");
    createAgentWorkflowButton(content, "sparkles", "Extract ideas", () => {
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("content-extract"));
    });
    createAgentWorkflowButton(content, "pen-line", "Draft", () => {
      const topic = requireInput(topicInput, "a topic or backlog item");
      if (topic) {
        void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("content-draft", topic));
      }
    });
    createAgentWorkflowButton(content, "search", "Deep research", () => {
      const topic = requireInput(topicInput, "a research topic");
      if (topic) {
        void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("deep-research", topic));
      }
    });

    const intelligence = createWorkflowCard(optionalModules, "Intelligence", "Run optional GitHub, arXiv, and AI landscape scans.");
    const intelligenceInput = createInlineInput(intelligence, "Filter", "last, rust weekly 15, or robotics");
    createAgentWorkflowButton(intelligence, "newspaper", "AI weekly", () => {
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("ai-weekly-digest", intelligenceInput.value));
    });
    createAgentWorkflowButton(intelligence, "github", "GitHub trends", () => {
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("daily-github", intelligenceInput.value));
    });
    createAgentWorkflowButton(intelligence, "graduation-cap", "Academic scan", () => {
      void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("daily-academic", intelligenceInput.value));
    });

    const events = createWorkflowCard(optionalModules, "Calendar / events", "Batch-add commitments so weekly setup can route them into Blockers and project notes.");
    const eventsInput = createBlockInput(events, "Events", "Paste one event or deadline per line");
    createAgentWorkflowButton(events, "calendar-plus", "Add events", () => {
      const eventsText = requireInput(eventsInput, "event details");
      if (eventsText) {
        void this.plugin.previewAndRunWorkflow(buildWorkflowSpec("add-events", eventsText));
      }
    });

    const advanced = createWorkflowCard(grid, "Agent prompt / CLI command", "Run any slash command or freeform agent prompt without leaving Obsidian.");
    const custom = advanced.createEl("textarea", {
      cls: "operator-prompt-input",
      attr: { rows: "3", placeholder: buildAdvancedPromptPlaceholder(this.plugin.settings.availableHours) },
    });
    createButton(advanced, "copy", "Copy CLI handoff", () => {
      const prompt = resolveAdvancedPrompt(custom.value, this.plugin.settings.availableHours);
      void copyTextToClipboard(buildCliHandoff(this.plugin.getVaultPath(), prompt, new Date(), this.plugin.settings.backend, {
        codexPath: this.plugin.status?.resolvedPaths.codex ?? this.plugin.settings.codexPath,
        claudePath: this.plugin.status?.resolvedPaths.claude ?? this.plugin.settings.claudePath,
      }), "CLI handoff copied.");
    });
    createAgentWorkflowButton(advanced, "terminal", "Preview and run", () => {
      const prompt = resolveAdvancedPrompt(custom.value, this.plugin.settings.availableHours);
      void this.plugin.previewAndRunWorkflow(describePrompt(prompt));
    }, "mod-cta");
  }

  private updateAdvancedPromptPlaceholders(hours: number): void {
    const placeholder = buildAdvancedPromptPlaceholder(hours);
    for (const promptInput of Array.from(this.contentEl.querySelectorAll<HTMLTextAreaElement>(".operator-prompt-input"))) {
      promptInput.placeholder = placeholder;
    }
  }

  private renderQuickCapture(root: HTMLElement, home: OperatorHomeState): void {
    const section = createSection(root, "Quick Capture", home.daily.captureCount > 0
      ? `${home.daily.captureCount} captured item(s) in today's note.`
      : "Append lightweight inputs to today's note without starting an agent run.");
    const row = section.createDiv({ cls: "operator-form-row" });
    const select = row.createEl("select", { cls: "operator-select" });
    select.createEl("option", { attr: { value: "idea" }, text: "Idea" });
    select.createEl("option", { attr: { value: "task" }, text: "Task" });
    select.createEl("option", { attr: { value: "meeting" }, text: "Meeting note" });
    select.createEl("option", { attr: { value: "research" }, text: "Research question" });
    const field = row.createDiv({ cls: "operator-field operator-grow" });
    field.createEl("label", { text: "Capture" });
    const input = field.createEl("textarea", {
      cls: "operator-manual-input",
      attr: { rows: "2", placeholder: "Something worth keeping..." },
    });
    createButton(row, "plus", "Capture", () => {
      void clearInputAfterSuccessfulCapture(input, () => {
        return this.plugin.appendCapture(select.value as "idea" | "task" | "meeting" | "research", input.value);
      });
    });
  }

  private renderRunLog(root: HTMLElement): void {
    const lastRun = this.plugin.settings.lastRun;
    if (!lastRun) {
      return;
    }

    const section = createSection(root, "Last Run", `${lastRun.workflowLabel ?? "Operator prompt"} (${lastRun.status})`);
    const meta = section.createDiv({ cls: "operator-run-meta" });
    meta.createSpan({ text: `Backend: ${lastRun.backend}` });
    meta.createSpan({ text: `Started: ${new Date(lastRun.startedAt).toLocaleString()}` });
    if (lastRun.endedAt) {
      meta.createSpan({ text: `Ended: ${new Date(lastRun.endedAt).toLocaleString()}` });
    }
    if (lastRun.expectedOpenPath) {
      const expectedFile = this.app.vault.getAbstractFileByPath(lastRun.expectedOpenPath);
      const expectedExists = expectedFile instanceof TFile;
      meta.createSpan({ text: formatExpectedNoteStatus(lastRun.expectedOpenPath, expectedExists, lastRun.status) });
      createButton(meta, "file-text", "Open expected note", () => {
        void this.plugin.openVaultPath(lastRun.expectedOpenPath ?? "");
      }, undefined, !expectedExists);
    }

    const prompt = section.createEl("code", { cls: "operator-run-prompt", text: lastRun.prompt });
    prompt.setAttr("aria-label", "Last Operator prompt");

    const summary = section.createEl("p", {
      cls: "operator-run-summary",
      text: summarizeRunOutput(lastRun),
    });
    if (lastRun.status === "failed") {
      summary.addClass("is-failed");
    }

    const details = section.createEl("details", { cls: "operator-log-details" });
    details.createEl("summary", { text: "Raw log" });

    const output = details.createEl("pre", { cls: "operator-log" });
    output.setText([lastRun.stdout.trim(), lastRun.stderr.trim()].filter(Boolean).join("\n\n") || "No output yet.");
  }

  private canRun(status: OperatorEnvironmentStatus): boolean {
    if (this.plugin.activeRun) {
      return false;
    }
    return canRunBackendWorkflows(status, this.plugin.settings.backend);
  }

  updateHeaderClock(date: Date): void {
    const headerMeta = this.contentEl.querySelector<HTMLElement>(".operator-clock-meta");
    const dailyNotePath = headerMeta?.getAttr("data-daily-note-path");
    if (!headerMeta || !dailyNotePath) {
      return;
    }
    headerMeta.setText(`${formatDashboardRunContext(date)} · ${dailyNotePath}`);
  }
}

class OperatorSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: OperatorControlPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Backend").setDesc("Codex is the default supported backend for one-click runs.").addDropdown((dropdown: DropdownComponent) => {
      dropdown
        .addOption("codex", "Codex")
        .addOption("claude", "Claude")
        .setValue(this.plugin.settings.backend)
        .onChange(async (value) => {
          this.plugin.settings.backend = value === "claude" ? "claude" : "codex";
          await this.plugin.saveSettings();
          await this.plugin.refreshStatus();
        });
    });

    addTextSetting(containerEl, "Codex executable", "Command or absolute path for Codex CLI.", this.plugin.settings.codexPath, async (value) => {
      this.plugin.settings.codexPath = value || DEFAULT_SETTINGS.codexPath;
      await this.plugin.saveSettings();
      await this.plugin.refreshStatus();
    });

    addTextSetting(containerEl, "Claude executable", "Command or absolute path for Claude Code CLI.", this.plugin.settings.claudePath, async (value) => {
      this.plugin.settings.claudePath = value || DEFAULT_SETTINGS.claudePath;
      await this.plugin.saveSettings();
      await this.plugin.refreshStatus();
    });

    addTextSetting(containerEl, "Operator marketplace source", "Codex marketplace source for installing or updating skills.", this.plugin.settings.repoSource, async (value) => {
      this.plugin.settings.repoSource = value || DEFAULT_SETTINGS.repoSource;
      await this.plugin.saveSettings();
      await this.plugin.refreshStatus();
    });

    addTextSetting(containerEl, "Vault owner name", "Written into CLAUDE.md and AGENTS.md during vault setup.", this.plugin.settings.vaultOwnerName, async (value) => {
      this.plugin.settings.vaultOwnerName = value || DEFAULT_SETTINGS.vaultOwnerName;
      await this.plugin.saveSettings();
    });

    addTextSetting(containerEl, "Apple Calendar name", "Used by deadline and event workflows.", this.plugin.settings.calendarName, async (value) => {
      this.plugin.settings.calendarName = value || DEFAULT_SETTINGS.calendarName;
      await this.plugin.saveSettings();
    });

    addTextSetting(containerEl, "Apple Reminders list", "Used by deadline and event workflows.", this.plugin.settings.remindersList, async (value) => {
      this.plugin.settings.remindersList = value || DEFAULT_SETTINGS.remindersList;
      await this.plugin.saveSettings();
    });

    addTextSetting(containerEl, "Meeting recordings base", "Default path pattern for meeting recordings.", this.plugin.settings.meetingRecordingsBase, async (value) => {
      this.plugin.settings.meetingRecordingsBase = value || DEFAULT_SETTINGS.meetingRecordingsBase;
      await this.plugin.saveSettings();
    });

    new Setting(containerEl)
      .setName("Optional modules")
      .setDesc("Daily start only runs these modules when you enable them here. The modules remain available from More workflows and raw CLI either way.");

    addOptionalModuleToggle(containerEl, "Intelligence", "Allow Start my day to run AI weekly and GitHub scans after the core briefing.", this.plugin, "intelligence");
    addOptionalModuleToggle(containerEl, "Academic", "Allow Start my day to run the arXiv scan after the core briefing.", this.plugin, "academic");
    addOptionalModuleToggle(containerEl, "Content", "Allow Start my day to extract content ideas after enabled source modules or the core briefing.", this.plugin, "content");
    addOptionalModuleToggle(containerEl, "Calendar/events", "Allow Start my day to ingest pasted event/deadline text from manual items.", this.plugin, "calendarEvents");

    new Setting(containerEl)
      .setName("Runner authorization")
      .setDesc("Reset this if you want Operator to ask before launching Codex or Claude again.")
      .addButton((button: ButtonComponent) => {
        button.setButtonText("Reset authorization").onClick(async () => {
          this.plugin.settings.hasAcceptedRunnerWarning = false;
          await this.plugin.saveSettings();
          new Notice("Operator will ask before the next run.");
        });
      });
  }
}

class RunnerConsentModal extends Modal {
  constructor(
    app: App,
    private readonly resolve: (accepted: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("operator-consent-modal");
    contentEl.createEl("h2", { text: "Allow Operator to run an agent?" });
    contentEl.createEl("p", {
      text: "Operator will launch Codex or Claude as a background process in this vault. The agent can read and write files in this vault using workspace-write permissions.",
    });
    contentEl.createEl("p", {
      text: "It will not use full-disk or dangerous sandbox bypass settings by default.",
    });
    const row = contentEl.createDiv({ cls: "operator-modal-actions" });
    createButton(row, "x", "Cancel", () => {
      this.resolve(false);
      this.close();
    });
    createButton(row, "check", "Allow", () => {
      this.resolve(true);
      this.close();
    }, "mod-cta");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class RunPreviewModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly spec: OperatorWorkflowRunSpec,
    private readonly backend: string,
    private readonly vaultPath: string,
    private readonly resolve: (spec: OperatorWorkflowRunSpec | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("operator-preview-modal");
    const title = contentEl.createEl("h2", { text: `Preview: ${this.spec.label}` });
    contentEl.createEl("p", {
      cls: "operator-muted",
      text: "Review and edit the exact prompt before Operator launches the agent.",
    });

    const meta = contentEl.createDiv({ cls: "operator-preview-meta" });
    meta.createSpan({ text: `Backend: ${this.backend}` });
    meta.createSpan({ text: `Vault: ${this.vaultPath}` });
    const expectedNote = meta.createSpan();

    const field = contentEl.createDiv({ cls: "operator-field" });
    field.createEl("label", { text: "Prompt" });
    const promptInput = field.createEl("textarea", {
      cls: "operator-prompt-input",
      attr: { rows: "4" },
    });
    promptInput.value = this.spec.prompt;

    const columns = contentEl.createDiv({ cls: "operator-preview-grid" });
    const runNotes = contentEl.createDiv();
    const getResolvedPreview = () => resolveEditedPreviewSpec(this.spec, promptInput.value);
    const renderResolvedPreview = () => {
      const resolved = getResolvedPreview();
      title.setText(`Preview: ${resolved.label}`);
      expectedNote.setText(resolved.expectedOpenPath ? `Expected note: ${resolved.expectedOpenPath}` : "Expected note: not predicted");
      columns.empty();
      runNotes.empty();
      if (resolved.targetNotes?.length) {
        renderAreaList(columns, "Targets", resolved.targetNotes);
      }
      renderAreaList(columns, "Likely reads", resolved.readAreas);
      renderAreaList(columns, "Likely writes", resolved.writeAreas);
      if (resolved.runNotes?.length) {
        renderAreaList(runNotes, "May also run", resolved.runNotes);
      }
    };
    promptInput.addEventListener("input", renderResolvedPreview);
    renderResolvedPreview();

    const row = contentEl.createDiv({ cls: "operator-modal-actions" });
    createButton(row, "x", "Cancel", () => {
      this.settle(null);
      this.close();
    });
    createButton(row, "copy", "Copy prompt", () => {
      void copyTextToClipboard(getResolvedPreview().prompt, "Prompt copied.");
    });
    createButton(row, "play", "Run", () => {
      this.settle(getResolvedPreview());
      this.close();
    }, "mod-cta");
  }

  onClose(): void {
    this.settle(null);
    this.contentEl.empty();
  }

  private settle(spec: OperatorWorkflowRunSpec | null): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolve(spec);
  }
}

class NativeProjectModal extends Modal {
  constructor(
    app: App,
    private readonly initialName: string,
    private readonly resolve: (input: NativeProjectInput | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("operator-project-modal");
    contentEl.createEl("h2", { text: "Create project" });
    contentEl.createEl("p", {
      cls: "operator-muted",
      text: "This native fast path creates the Markdown project note and knowledge folder directly. Use /project-init from More workflows if you want the agent-guided path.",
    });

    const nameInput = createInlineInput(contentEl, "Project name", "Customer Discovery", this.initialName);
    const pathPreview = contentEl.createEl("p", { cls: "operator-help" });
    const updatePreview = () => {
      const normalized = normalizeProjectName(nameInput.value);
      pathPreview.setText(normalized
        ? `Will create 02_Projects/${normalized}/${normalized}.md`
        : "Enter a project name to preview the note path.");
    };
    nameInput.addEventListener("input", updatePreview);
    updatePreview();

    const categoryInput = createInlineInput(contentEl, "Category", "project, startup, academic, side-project", "project");
    const descriptionField = contentEl.createDiv({ cls: "operator-field" });
    descriptionField.createEl("label", { text: "One-line description" });
    const descriptionInput = descriptionField.createEl("textarea", {
      cls: "operator-prompt-input",
      attr: { rows: "2", placeholder: "What is this project in one sentence?" },
    });

    const nowField = contentEl.createDiv({ cls: "operator-field" });
    nowField.createEl("label", { text: "Immediate focus" });
    const nowInput = nowField.createEl("textarea", {
      cls: "operator-prompt-input",
      attr: { rows: "3", placeholder: "Ship prototype\nValidate with first users" },
    });

    const risksField = contentEl.createDiv({ cls: "operator-field" });
    risksField.createEl("label", { text: "Risks" });
    const risksInput = risksField.createEl("textarea", {
      cls: "operator-prompt-input",
      attr: { rows: "2", placeholder: "Optional; leave blank for none identified yet" },
    });

    const row = contentEl.createDiv({ cls: "operator-modal-actions" });
    createButton(row, "x", "Cancel", () => {
      this.resolve(null);
      this.close();
    });
    createButton(row, "folder-plus", "Create", () => {
      const name = requireInput(nameInput, "a project name");
      if (!name) {
        return;
      }

      this.resolve({
        name,
        category: categoryInput.value,
        description: descriptionInput.value,
        now: nowInput.value,
        risks: risksInput.value,
      });
      this.close();
    }, "mod-cta");
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function createSection(parent: HTMLElement, title: string, description: string): HTMLElement {
  const section = parent.createDiv({ cls: "operator-section" });
  const header = section.createDiv({ cls: "operator-section-header" });
  header.createEl("h3", { text: title });
  header.createEl("p", { text: description });
  return section;
}

function createDisclosureSection(parent: HTMLElement, title: string, description: string): HTMLElement {
  const details = parent.createEl("details", { cls: "operator-section operator-disclosure" });
  const summary = details.createEl("summary");
  const header = summary.createDiv({ cls: "operator-section-header" });
  header.createEl("h3", { text: title });
  header.createEl("p", { text: description });
  return details;
}

function createWorkflowCard(parent: HTMLElement, title: string, description: string): HTMLElement {
  const card = parent.createDiv({ cls: "operator-workflow-card" });
  card.createEl("h4", { text: title });
  card.createEl("p", { cls: "operator-muted", text: description });
  return card;
}

function createInlineInput(parent: HTMLElement, label: string, placeholder: string, value = ""): HTMLInputElement {
  const field = parent.createDiv({ cls: "operator-field" });
  field.createEl("label", { text: label });
  const input = field.createEl("input", { attr: { placeholder } });
  input.value = value;
  return input;
}

function createBlockInput(parent: HTMLElement, label: string, placeholder: string): HTMLTextAreaElement {
  const field = parent.createDiv({ cls: "operator-field" });
  field.createEl("label", { text: label });
  return field.createEl("textarea", {
    cls: "operator-prompt-input",
    attr: { rows: "4", placeholder },
  });
}

function renderTextList(parent: HTMLElement, items: string[], emptyText: string): void {
  if (items.length === 0) {
    parent.createEl("p", { cls: "operator-muted", text: emptyText });
    return;
  }

  const list = parent.createEl("ul", { cls: "operator-list operator-plain-list" });
  for (const item of items) {
    list.createEl("li", { text: item });
  }
}

function requireInput(input: HTMLInputElement | HTMLTextAreaElement, label: string): string | null {
  const value = input.value.trim();
  if (value) {
    return value;
  }

  input.focus();
  new Notice(`Enter ${label} first.`);
  return null;
}

async function copyTextToClipboard(value: string, successMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    new Notice(successMessage);
  } catch (error) {
    new Notice(`Copy failed: ${formatError(error)}`);
  }
}

function createButton(
  parent: HTMLElement,
  icon: string,
  label: string,
  onClick: () => void,
  extraClass?: string,
  disabled = false,
  title = label,
): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "operator-button" });
  if (extraClass) {
    button.addClass(extraClass);
  }
  const iconEl = button.createSpan({ cls: "operator-button-icon" });
  setIcon(iconEl, icon);
  button.createSpan({ text: label });
  button.disabled = disabled;
  button.setAttr("title", title);
  button.setAttr("aria-label", disabled && title !== label ? `${label}: ${title}` : label);
  button.addEventListener("click", onClick);
  return button;
}

function renderAreaList(parent: HTMLElement, title: string, areas: string[]): void {
  const panel = parent.createDiv({ cls: "operator-preview-panel" });
  panel.createEl("strong", { text: title });
  const list = panel.createEl("ul", { cls: "operator-list" });
  for (const area of areas) {
    list.createEl("li", { text: area });
  }
}

function renderStatusTile(
  parent: HTMLElement,
  label: string,
  state: StatusState,
  detail: string,
  optional = false,
): void {
  const visualState = optional && state !== "ready" ? "optional" : state;
  const tile = parent.createDiv({ cls: `operator-status-tile is-${visualState}` });
  const header = tile.createDiv({ cls: "operator-status-title" });
  header.createSpan({ text: label });
  header.createSpan({ cls: `operator-chip is-${visualState}`, text: visualState === "optional" ? "optional" : state });
  tile.createEl("p", { text: detail });
}

function renderStepCard(
  parent: HTMLElement,
  step: string,
  title: string,
  detail: string,
  state: "ready" | "needed" | "locked",
): void {
  const card = parent.createDiv({ cls: `operator-step-card is-${state}` });
  const header = card.createDiv({ cls: "operator-step-header" });
  header.createSpan({ cls: "operator-step-number", text: step });
  header.createEl("strong", { text: title });
  card.createEl("p", { text: detail });
}

function renderAdvancedItem(
  parent: HTMLElement,
  title: string,
  command: string,
  detail: string,
  state: StatusState,
): void {
  const item = parent.createDiv({ cls: "operator-advanced-item" });
  item.createEl("strong", { text: title });
  item.createEl("code", { text: command });
  item.createEl("p", { text: detail });
  item.createSpan({ cls: `operator-chip is-${state}`, text: state === "ready" ? "ready" : "limited" });
}

function addTextSetting(
  parent: HTMLElement,
  name: string,
  description: string,
  value: string,
  onChange: (value: string) => Promise<void>,
): void {
  new Setting(parent)
    .setName(name)
    .setDesc(description)
    .addText((text: TextComponent) => {
      text.setValue(value).onChange((nextValue) => {
        void onChange(nextValue.trim());
      });
    });
}

function addOptionalModuleToggle(
  parent: HTMLElement,
  name: string,
  description: string,
  plugin: OperatorControlPlugin,
  key: keyof OperatorSettings["optionalModules"],
): void {
  new Setting(parent)
    .setName(name)
    .setDesc(description)
    .addToggle((toggle) => {
      toggle.setValue(plugin.settings.optionalModules[key]).onChange(async (value) => {
        plugin.settings.optionalModules[key] = value;
        await plugin.saveSettings();
      });
    });
}

function summarizeInitialization(result: VaultInitializationResult): string {
  const created = result.createdFolders.length + result.createdFiles.length;
  const updated = result.updatedFiles.length;
  if (created === 0 && updated === 0) {
    return "Operator vault setup is already present.";
  }
  return `Operator vault setup complete: ${created} created, ${updated} config file(s) updated.`;
}

function summarizeRunOutput(run: OperatorRunRecord): string {
  if (run.status === "running") {
    return "Running now. Output will appear in the raw log as the agent reports progress.";
  }

  const combined = [run.stdout, run.stderr]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("exec") && !line.startsWith("warning:"))
    .slice(-4);

  if (combined.length > 0) {
    return combined.join(" ");
  }

  if (run.status === "success") {
    return run.expectedOpenPath
      ? `Finished. Review the result in ${run.expectedOpenPath}.`
      : "Finished successfully.";
  }

  return `Run ${run.status}. Open the raw log for details.`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
