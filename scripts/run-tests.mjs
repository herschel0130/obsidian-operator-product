import esbuild from "esbuild";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

rmSync(".test-out", { recursive: true, force: true });
mkdirSync(".test-out", { recursive: true });

const nodeExternals = builtinModules.flatMap((name) => [name, `node:${name}`]);

await esbuild.build({
  bundle: true,
  entryPoints: readdirSync("tests")
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => `tests/${file}`),
  external: [...nodeExternals],
  format: "esm",
  loader: {
    ".md": "text",
  },
  plugins: [{
    name: "obsidian-test-stub",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({
        path: resolve("tests/obsidian-stub.ts"),
      }));
    },
  }],
  outdir: ".test-out",
  outExtension: { ".js": ".mjs" },
  platform: "node",
  sourcemap: false,
  target: "node20",
});

const testFiles = readdirSync(".test-out")
  .filter((file) => file.endsWith(".mjs"))
  .map((file) => `.test-out/${file}`);

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
