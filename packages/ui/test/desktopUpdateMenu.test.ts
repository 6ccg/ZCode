import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowDesktopUpdateEntry } from "../src/lib/desktopUpdateMenu.js";

test("modified desktop never exposes the official application update entry", () => {
  assert.equal(shouldShowDesktopUpdateEntry(), false);
  assert.equal(shouldShowDesktopUpdateEntry("production"), false);
  assert.equal(shouldShowDesktopUpdateEntry("preview"), false);
});
