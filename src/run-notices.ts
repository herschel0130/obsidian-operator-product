import type { OperatorRunRecord } from "./settings";

export function formatExpectedNoteStatus(
  expectedOpenPath: string,
  exists: boolean,
  status: OperatorRunRecord["status"],
): string {
  if (exists) {
    return `Expected note ready: ${expectedOpenPath}`;
  }
  return `${status === "running" ? "Expected note pending" : "Expected note missing"}: ${expectedOpenPath}`;
}

export function formatRunCompletionNotice(
  status: OperatorRunRecord["status"],
  expectedOpenPath?: string,
  openedExpectedNote = false,
): string {
  if (status === "success") {
    if (expectedOpenPath && openedExpectedNote) {
      return `Operator run finished. Opened ${expectedOpenPath}.`;
    }
    if (expectedOpenPath) {
      return `Operator run finished. Expected note not found yet: ${expectedOpenPath}.`;
    }
    return "Operator run finished.";
  }
  return `Operator run ${status}.`;
}
