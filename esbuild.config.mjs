import esbuild from "esbuild";
import { builtinModules } from "node:module";

const isProduction = process.argv.includes("production");
const nodeExternals = builtinModules.flatMap((name) => [name, `node:${name}`]);

await esbuild.build({
  banner: {
    js: "/* Obsidian Operator control panel */",
  },
  bundle: true,
  entryPoints: ["src/main.ts"],
  external: ["obsidian", "electron", ...nodeExternals],
  format: "cjs",
  loader: {
    ".md": "text",
  },
  logLevel: "info",
  minify: isProduction,
  outfile: "main.js",
  platform: "browser",
  sourcemap: isProduction ? false : "inline",
  target: "es2018",
  treeShaking: true,
});
