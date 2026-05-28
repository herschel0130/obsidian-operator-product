#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PLUGIN_ID = "operator-control";
const REQUIRED_FILES = ["manifest.json", "main.js", "styles.css"];

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.root ?? process.cwd());
const out = resolve(args.out ?? join(root, "dist", `${PLUGIN_ID}.zip`));
const stageRoot = join(root, "dist", ".plugin-package");
const pluginDir = join(stageRoot, PLUGIN_ID);

for (const file of REQUIRED_FILES) {
  const path = join(root, file);
  if (!existsSync(path)) {
    fail(`Missing ${file}. Run npm run build before packaging.`);
  }
}

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(pluginDir, { recursive: true });
mkdirSync(dirname(out), { recursive: true });
rmSync(out, { force: true });

for (const file of REQUIRED_FILES) {
  copyFileSync(join(root, file), join(pluginDir, file));
}

const result = spawnSync("zip", ["-qr", out, PLUGIN_ID], {
  cwd: stageRoot,
  encoding: "utf8",
});

rmSync(stageRoot, { recursive: true, force: true });

if (result.error) {
  fail(`Could not run zip: ${result.error.message}`);
}
if (result.status !== 0) {
  fail(result.stderr || result.stdout || `zip exited with ${result.status}`);
}

console.log(`Created ${out}`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root" || arg === "--out") {
      parsed[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
