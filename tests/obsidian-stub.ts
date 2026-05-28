export const Platform = {
  isDesktopApp: true,
  isMacOS: process.platform === "darwin",
};

export class TFile {
  path = "";
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
