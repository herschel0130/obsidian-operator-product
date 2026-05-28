import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("package script creates an Obsidian plugin zip with the plugin folder", () => {
  const root = mkdtempSync(join(tmpdir(), "operator-package-"));
  const out = join(root, "dist", "operator-control.zip");

  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ id: "operator-control" }));
  writeFileSync(join(root, "main.js"), "console.log('operator');\n");
  writeFileSync(join(root, "styles.css"), ".operator-control {}\n");

  const packageResult = spawnSync(process.execPath, [
    "scripts/package-obsidian-plugin.mjs",
    "--root",
    root,
    "--out",
    out,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(packageResult.status, 0, packageResult.stderr || packageResult.stdout);
  assert.equal(existsSync(out), true);

  const listingResult = spawnSync("unzip", ["-Z1", out], { encoding: "utf8" });
  assert.equal(listingResult.status, 0, listingResult.stderr);
  assert.deepEqual(listingResult.stdout.trim().split("\n").sort(), [
    "operator-control/",
    "operator-control/main.js",
    "operator-control/manifest.json",
    "operator-control/styles.css",
  ]);
});
