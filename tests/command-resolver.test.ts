import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveCommandPath } from "../src/command-resolver";

test("resolveCommandPath finds an nvm command when GUI PATH omits it", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "operator-home-"));
  const binDir = join(homeDir, ".nvm", "versions", "node", "v24.14.0", "bin");
  const fakeCodex = join(binDir, "codex");

  mkdirSync(binDir, { recursive: true });
  writeFileSync(fakeCodex, "#!/bin/sh\necho codex\n");
  chmodSync(fakeCodex, 0o755);

  assert.equal(
    resolveCommandPath("codex", {
      env: { PATH: "/usr/bin:/bin" },
      homeDir,
      extraDirs: [],
    }),
    fakeCodex,
  );
});
