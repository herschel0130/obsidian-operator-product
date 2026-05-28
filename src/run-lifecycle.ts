import type { RunningProcess } from "./runner";

export interface ActiveRunHost {
  activeRun: RunningProcess | null;
  renderViews: () => void;
}

export function attachActiveRunAndRender(host: ActiveRunHost, running: RunningProcess): void {
  host.activeRun = running;
  host.renderViews();
}
