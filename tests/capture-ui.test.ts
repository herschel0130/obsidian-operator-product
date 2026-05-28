import { strict as assert } from "node:assert";
import test from "node:test";
import { clearInputAfterSuccessfulCapture } from "../src/capture-ui";

test("quick capture keeps text when saving fails", async () => {
  const input = { value: "call Alice about timeline" };

  const captured = await clearInputAfterSuccessfulCapture(input, async () => false);

  assert.equal(captured, false);
  assert.equal(input.value, "call Alice about timeline");
});

test("quick capture clears text after saving succeeds", async () => {
  const input = { value: "call Alice about timeline" };

  const captured = await clearInputAfterSuccessfulCapture(input, async () => true);

  assert.equal(captured, true);
  assert.equal(input.value, "");
});
