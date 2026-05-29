import { getNextLocalMinuteDelayMs } from "./dates";

export interface AlignedMinuteRefreshTimers<TimerHandle> {
  now: () => Date;
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}

export function startAlignedMinuteRefresh<TimerHandle>(
  onTick: () => void,
  timers: AlignedMinuteRefreshTimers<TimerHandle>,
): () => void {
  let cancelled = false;
  let currentHandle: TimerHandle | null = null;

  const scheduleNext = () => {
    if (cancelled) {
      return;
    }
    currentHandle = timers.setTimeout(() => {
      currentHandle = null;
      onTick();
      scheduleNext();
    }, getNextLocalMinuteDelayMs(timers.now()));
  };

  scheduleNext();

  return () => {
    cancelled = true;
    if (currentHandle !== null) {
      timers.clearTimeout(currentHandle);
      currentHandle = null;
    }
  };
}
