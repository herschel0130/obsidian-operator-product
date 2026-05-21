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
  TextComponent,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import {
  buildBackendCommand,
  buildCodexMarketplaceAddCommand,
  buildCodexMarketplaceUpgradeCommand,
  runCommand,
  truncateOutput,
  type RunningProcess,
} from "./runner";
import { DEFAULT_SETTINGS, type OperatorRunRecord, type OperatorSettings } from "./settings";
import { canRunCodexWorkflows, checkEnvironment, type OperatorEnvironmentStatus, type StatusState } from "./status";
import { initializeVault, type VaultInitializationResult } from "./vault-init";

const VIEW_TYPE_OPERATOR = "operator-control-view";

export default class OperatorControlPlugin extends Plugin {
  settings: OperatorSettings = { ...DEFAULT_SETTINGS };
  status: OperatorEnvironmentStatus | null = null;
  activeRun: RunningProcess | null = null;
  activeRunBuffer: OperatorRunRecord | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

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
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_OPERATOR)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_OPERATOR, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async refreshStatus(): Promise<OperatorEnvironmentStatus> {
    this.status = await checkEnvironment(this.app, this.settings);
    this.renderViews();
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

    const installed = this.status?.operatorSkills === "ready" || this.status?.operatorSkills === "warning";
    const spec = installed
      ? buildCodexMarketplaceUpgradeCommand(this.settings.codexPath)
      : buildCodexMarketplaceAddCommand(this.settings.codexPath, this.settings.repoSource);

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
    this.renderViews();

    const running = runCommand(spec, {
      onStdout: (chunk) => this.appendActiveOutput("stdout", chunk),
      onStderr: (chunk) => this.appendActiveOutput("stderr", chunk),
    });
    this.activeRun = running;

    const result = await running.done;
    await this.finishActiveRun(result.exitCode === 0 ? "success" : "failed", result);
    await this.refreshStatus();
  }

  async runDailyBriefing(hours: number): Promise<void> {
    const safeHours = Math.max(1, Math.min(16, Math.round(hours || this.settings.availableHours)));
    this.settings.availableHours = safeHours;
    await this.saveSettings();
    await this.runOperatorPrompt(`/daily-init ${safeHours}`, { search: true });
  }

  async runProjectInit(projectName: string): Promise<void> {
    const trimmed = projectName.trim();
    if (!trimmed) {
      new Notice("Enter a project name first.");
      return;
    }
    await this.runOperatorPrompt(`/project-init ${trimmed}`, { search: false });
  }

  async runOperatorPrompt(prompt: string, options: { search?: boolean }): Promise<void> {
    if (this.activeRun) {
      new Notice("Operator is already running.");
      return;
    }

    const vaultPath = this.getVaultPath();
    if (!vaultPath) {
      new Notice("Operator can only run workflows in the desktop app.");
      return;
    }

    if (!(await this.ensureRunnerConsent())) {
      return;
    }

    const status = this.status ?? (await this.refreshStatus());
    if (this.settings.backend === "codex" && !canRunCodexWorkflows(status)) {
      new Notice("Finish setup first: Codex, login, skills, and vault initialization must be ready.");
      return;
    }

    const spec = buildBackendCommand(
      this.settings.backend,
      {
        codexPath: this.settings.codexPath,
        claudePath: this.settings.claudePath,
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
      status: "running",
      startedAt,
      stdout: "",
      stderr: "",
    };
    this.settings.lastRun = this.activeRunBuffer;
    await this.saveSettings();
    this.renderViews();

    const running = runCommand(spec, {
      onStdout: (chunk) => this.appendActiveOutput("stdout", chunk),
      onStderr: (chunk) => this.appendActiveOutput("stderr", chunk),
    });
    this.activeRun = running;

    const result = await running.done;
    const statusName = result.cancelled ? "cancelled" : result.exitCode === 0 ? "success" : "failed";
    await this.finishActiveRun(statusName, result);
    await this.refreshStatus();
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
    this.renderViews();
    new Notice(status === "success" ? "Operator run finished." : `Operator run ${status}.`);
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
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_OPERATOR)) {
      const view = leaf.view;
      if (view instanceof OperatorDashboardView) {
        void view.render();
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
    await this.plugin.refreshStatus();
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("operator-control-view");

    const root = container.createDiv({ cls: "operator-control" });
    const header = root.createDiv({ cls: "operator-hero" });
    const titleWrap = header.createDiv();
    titleWrap.createEl("p", { cls: "operator-eyebrow", text: "Obsidian Operator" });
    titleWrap.createEl("h2", { text: "Run your operating system from the vault." });
    titleWrap.createEl("p", {
      cls: "operator-muted",
      text: "Initialize the vault, create projects, and run daily briefings without living in a terminal.",
    });

    const headerActions = header.createDiv({ cls: "operator-hero-actions" });
    createButton(headerActions, "refresh-cw", "Refresh", () => void this.plugin.refreshStatus());
    if (this.plugin.activeRun) {
      createButton(headerActions, "square", "Cancel run", () => this.plugin.cancelActiveRun(), "operator-danger");
    }

    const status = this.plugin.status ?? (await this.plugin.refreshStatus());
    this.renderSetup(root, status);
    this.renderToday(root, status);
    this.renderProjects(root, status);
    this.renderAdvanced(root, status);
    this.renderRunLog(root);
  }

  private renderSetup(root: HTMLElement, status: OperatorEnvironmentStatus): void {
    const section = createSection(root, "Setup", "Make the hidden agent pieces visible before you run anything.");
    const grid = section.createDiv({ cls: "operator-status-grid" });

    renderStatusTile(grid, "Vault", status.vault.ready ? "ready" : "missing", status.vault.ready
      ? "Core folders and agent config are present."
      : `Missing ${status.vault.missingFolders.length + status.vault.missingFiles.length} setup item(s).`);
    renderStatusTile(grid, "Codex CLI", status.codexCli, status.details.codexCli);
    renderStatusTile(grid, "Codex login", status.codexLogin, status.details.codexLogin);
    renderStatusTile(grid, "Operator skills", status.operatorSkills, status.details.operatorSkills);
    renderStatusTile(grid, "Gmail", status.gmail, status.details.gmail, true);
    renderStatusTile(grid, "Gemini", status.gemini, status.details.gemini, true);
    renderStatusTile(grid, "Calendar", status.calendar, status.details.calendar, true);
    renderStatusTile(grid, "Multi-agent", status.multiAgent, status.details.multiAgent, true);

    const controls = section.createDiv({ cls: "operator-controls-row" });
    createButton(controls, "download", status.operatorSkills === "ready" || status.operatorSkills === "warning" ? "Update Operator skills" : "Install Operator skills", () => {
      void this.plugin.installOrUpdateCodexMarketplace();
    }, undefined, status.codexCli !== "ready" || !!this.plugin.activeRun);
    createButton(controls, "folder-check", status.vault.ready ? "Refresh vault setup" : "Initialize vault", () => {
      void this.plugin.initializeVaultFromUi();
    }, "mod-cta", !!this.plugin.activeRun);
  }

  private renderToday(root: HTMLElement, status: OperatorEnvironmentStatus): void {
    const section = createSection(root, "Today", "Start the day with the Operator daily briefing.");
    const row = section.createDiv({ cls: "operator-form-row" });
    const hoursWrap = row.createDiv({ cls: "operator-field" });
    hoursWrap.createEl("label", { text: "Available hours" });
    const hoursInput = hoursWrap.createEl("input", {
      attr: {
        type: "number",
        min: "1",
        max: "16",
        step: "1",
        value: String(this.plugin.settings.availableHours),
      },
    });
    hoursInput.addEventListener("change", () => {
      this.plugin.settings.availableHours = Number(hoursInput.value) || 6;
      void this.plugin.saveSettings();
    });

    const canRun = this.canRun(status);
    createButton(row, "sun", "Run daily briefing", () => {
      void this.plugin.runDailyBriefing(Number(hoursInput.value) || this.plugin.settings.availableHours);
    }, "mod-cta", !canRun);

    if (!canRun) {
      section.createEl("p", {
        cls: "operator-help",
        text: "Daily briefing unlocks after Codex, login, Operator skills, and vault setup are ready.",
      });
    }
  }

  private renderProjects(root: HTMLElement, status: OperatorEnvironmentStatus): void {
    const section = createSection(root, "Projects", "Scaffold a tracked project inside the Operator vault.");
    const row = section.createDiv({ cls: "operator-form-row" });
    const field = row.createDiv({ cls: "operator-field operator-grow" });
    field.createEl("label", { text: "Project name" });
    const input = field.createEl("input", { attr: { placeholder: "e.g. Customer Discovery" } });
    createButton(row, "folder-plus", "Create project", () => {
      void this.plugin.runProjectInit(input.value);
    }, undefined, !this.canRun(status));
  }

  private renderAdvanced(root: HTMLElement, status: OperatorEnvironmentStatus): void {
    const section = createSection(root, "Advanced", "More Operator workflows, surfaced without pretending every flow is one-click yet.");
    const list = section.createDiv({ cls: "operator-advanced-list" });
    renderAdvancedItem(list, "Meetings", "/meeting", "Transcript workflows need a recording path or transcript input.", status.gemini);
    renderAdvancedItem(list, "Research", "/deep-research <topic>", "Runs sequentially unless Codex multi-agent is enabled.", status.multiAgent);
    renderAdvancedItem(list, "Content", "/content-extract", "Email ideas appear when Gmail is configured.", status.gmail);
  }

  private renderRunLog(root: HTMLElement): void {
    const lastRun = this.plugin.settings.lastRun;
    if (!lastRun) {
      return;
    }

    const section = createSection(root, "Run log", `${lastRun.prompt} (${lastRun.status})`);
    const meta = section.createDiv({ cls: "operator-run-meta" });
    meta.createSpan({ text: `Backend: ${lastRun.backend}` });
    meta.createSpan({ text: `Started: ${new Date(lastRun.startedAt).toLocaleString()}` });
    if (lastRun.endedAt) {
      meta.createSpan({ text: `Ended: ${new Date(lastRun.endedAt).toLocaleString()}` });
    }

    const output = section.createEl("pre", { cls: "operator-log" });
    output.setText([lastRun.stdout.trim(), lastRun.stderr.trim()].filter(Boolean).join("\n\n") || "No output yet.");
  }

  private canRun(status: OperatorEnvironmentStatus): boolean {
    if (this.plugin.activeRun) {
      return false;
    }
    if (this.plugin.settings.backend === "codex") {
      return canRunCodexWorkflows(status);
    }
    return status.claudeCli === "ready" && status.vault.ready;
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
    });

    addTextSetting(containerEl, "Claude executable", "Command or absolute path for Claude Code CLI.", this.plugin.settings.claudePath, async (value) => {
      this.plugin.settings.claudePath = value || DEFAULT_SETTINGS.claudePath;
      await this.plugin.saveSettings();
    });

    addTextSetting(containerEl, "Operator marketplace source", "Codex marketplace source for installing or updating skills.", this.plugin.settings.repoSource, async (value) => {
      this.plugin.settings.repoSource = value || DEFAULT_SETTINGS.repoSource;
      await this.plugin.saveSettings();
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

function createSection(parent: HTMLElement, title: string, description: string): HTMLElement {
  const section = parent.createDiv({ cls: "operator-section" });
  const header = section.createDiv({ cls: "operator-section-header" });
  header.createEl("h3", { text: title });
  header.createEl("p", { text: description });
  return section;
}

function createButton(
  parent: HTMLElement,
  icon: string,
  label: string,
  onClick: () => void,
  extraClass?: string,
  disabled = false,
): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "operator-button" });
  if (extraClass) {
    button.addClass(extraClass);
  }
  const iconEl = button.createSpan({ cls: "operator-button-icon" });
  setIcon(iconEl, icon);
  button.createSpan({ text: label });
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function renderStatusTile(
  parent: HTMLElement,
  label: string,
  state: StatusState,
  detail: string,
  optional = false,
): void {
  const tile = parent.createDiv({ cls: `operator-status-tile is-${state}` });
  const header = tile.createDiv({ cls: "operator-status-title" });
  header.createSpan({ text: label });
  header.createSpan({ cls: "operator-chip", text: optional && state === "missing" ? "optional" : state });
  tile.createEl("p", { text: detail });
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

function summarizeInitialization(result: VaultInitializationResult): string {
  const created = result.createdFolders.length + result.createdFiles.length;
  const updated = result.updatedFiles.length;
  if (created === 0 && updated === 0) {
    return "Operator vault setup is already present.";
  }
  return `Operator vault setup complete: ${created} created, ${updated} config file(s) updated.`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
