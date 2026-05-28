import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { attachActiveRunAndRender } from "../src/run-lifecycle";
import type { RunningProcess } from "../src/runner";

test("active run is visible before the dashboard rerenders", () => {
  const running = { id: "quiet-run" } as unknown as RunningProcess;
  let renderSawActiveRun = false;

  const host = {
    activeRun: null as RunningProcess | null,
    renderViews: () => {
      renderSawActiveRun = host.activeRun === running;
    },
  };

  attachActiveRunAndRender(host, running);

  assert.equal(host.activeRun, running);
  assert.equal(renderSawActiveRun, true);
});

test("operator launch paths attach the active run before rerendering", () => {
  const mainSource = readFileSync("src/main.ts", "utf8");

  assert.match(mainSource, /import \{ attachActiveRunAndRender \} from "\.\/run-lifecycle";/);
  assert.equal((mainSource.match(/attachActiveRunAndRender\(this, running\);/g) ?? []).length, 2);
});
