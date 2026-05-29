export interface IsoWeekInfo {
  isoYear: number;
  week: number;
  label: string;
}

export interface QuarterInfo {
  year: number;
  quarter: number;
  label: string;
}

export function getIsoWeekInfo(date = new Date()): IsoWeekInfo {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);

  const isoYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);

  return {
    isoYear,
    week,
    label: `${isoYear}-W${String(week).padStart(2, "0")}`,
  };
}

export function getQuarterInfo(date = new Date()): QuarterInfo {
  const year = date.getFullYear();
  const quarter = Math.floor(date.getMonth() / 3) + 1;
  return {
    year,
    quarter,
    label: `${year}-Q${quarter}`,
  };
}

export function formatRunContext(date = new Date()): string {
  const isoWeek = getIsoWeekInfo(date).label;
  const quarter = getQuarterInfo(date).label;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const localTime = formatLocalClock(date);

  return [
    `Local date: ${formatDateKey(date)}`,
    `Local time: ${localTime}`,
    `Timezone: ${timezone}`,
    `ISO week: ${isoWeek}`,
    `Quarter: ${quarter}`,
  ].join("\n");
}

export function getExecutionWeekFolder(date = new Date()): string {
  return `01_Execution/${getIsoWeekInfo(date).label}`;
}

export function getDailyNotePath(date = new Date()): string {
  return `${getExecutionWeekFolder(date)}/${formatDateKey(date)}.md`;
}

export function formatDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function hasLocalDateChanged(previousDateKey: string, date = new Date()): boolean {
  return previousDateKey !== formatDateKey(date);
}

export function getLocalMinuteKey(date = new Date()): string {
  return `${formatDateKey(date)}T${formatLocalClock(date)}`;
}

export function hasLocalMinuteChanged(previousMinuteKey: string, date = new Date()): boolean {
  return previousMinuteKey !== getLocalMinuteKey(date);
}

export function getNextLocalMinuteDelayMs(date = new Date()): number {
  const elapsedMs = date.getSeconds() * 1000 + date.getMilliseconds();
  return elapsedMs === 0 ? 60_000 : 60_000 - elapsedMs;
}

export function formatDashboardRunContext(date = new Date()): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  return `${formatDateKey(date)} ${formatLocalClock(date)} ${timezone} · ${getIsoWeekInfo(date).label} · ${getQuarterInfo(date).label}`;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatLocalClock(date: Date): string {
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");
}
