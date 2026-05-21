import esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { spawnSync } from "node:child_process";

mkdirSync(".test-out", { recursive: true });

const nodeExternals = builtinModules.flatMap((name) => [name, `node:${name}`]);

await esbuild.build({
  bundle: true,
  entryPoints: ["tests/runner.test.ts"],
  external: ["obsidian", ...nodeExternals],
  format: "esm",
  outfile: ".test-out/runner.test.mjs",
  platform: "node",
  sourcemap: false,
  target: "node20",
});

const result = spawnSync(process.execPath, ["--test", ".test-out/runner.test.mjs"], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
