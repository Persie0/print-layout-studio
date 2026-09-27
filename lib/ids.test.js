import test from "node:test";
import assert from "node:assert/strict";
import { createId } from "./ids.js";

test("creates unique IDs when randomUUID is not exposed", () => {
  let randomValue = 0;
  const makeFallbackId = () => createId(
    { randomUUID: undefined },
    () => 1720000000000,
    () => { randomValue += 0.1; return randomValue; },
  );

  const first = makeFallbackId();
  const second = makeFallbackId();
  assert.match(first, /^item-/);
  assert.notEqual(first, second);
});

test("uses randomUUID when the browser supports it", () => {
  assert.equal(createId({ randomUUID: () => "native-id" }), "native-id");
});
