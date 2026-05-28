#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const PLUGIN_ID = "operator-control";
const REQUIRED_FILES = ["manifest.json", "main.js", "styles.css"];
const vaultArg = process.argv[2];

if (!vaultArg) {
  fail('Usage: npm run install:plugin -- "/path/to/Obsidian Vault"');
}

const root = process.cwd();
const vaultPath = resolve(vaultArg);
const obsidianDir = join(vaultPath, ".obsidian");
const pluginDir = join(obsidianDir, "plugins", PLUGIN_ID);

if (!existsSync(obsidianDir)) {
  fail(`Not an Obsidian vault: ${vaultPath} does not contain .obsidian/`);
}

for (const file of REQUIRED_FILES) {
  const path = join(root, file);
  if (!existsSync(path)) {
    fail(`Missing ${file}. Run npm run build before installing.`);
  }
}

mkdirSync(pluginDir, { recursive: true });
for (const file of REQUIRED_FILES) {
  copyFileSync(join(root, file), join(pluginDir, file));
}

console.log(`Installed Operator to ${pluginDir}`);
console.log("Next: open Obsidian, enable Community plugins, then enable Operator.");

function fail(message) {
  console.error(message);
  process.exit(1);
}
