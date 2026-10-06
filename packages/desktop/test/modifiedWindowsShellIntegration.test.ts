import assert from "node:assert/strict";
import { test } from "node:test";

test("Windows skips shell registration without cleanup and macOS keeps registration", async (t) => {
  const calls: unknown[][] = [];
  const unexpected = () => {
    throw new Error("Windows shell integration performed an unexpected side effect");
  };
  t.mock.module("electron", {
    namedExports: {
      app: {
        setAsDefaultProtocolClient: (...args: unknown[]) => {
          calls.push(args);
          return true;
        },
        removeAsDefaultProtocolClient: unexpected,
        getPath: unexpected,
      },
      BrowserWindow: {},
      dialog: {},
    },
  });
  t.mock.module(new URL("../src/main/desktopLinuxDeepLinkRegistration.ts", import.meta.url), {
    namedExports: { registerLinuxDeepLinkProtocol: unexpected },
  });
  const { registerDeepLinkProtocol } = await import("../src/main/desktopOAuthDeepLink.js");
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  t.after(() => Object.defineProperty(process, "platform", platformDescriptor));

  Object.defineProperty(process, "platform", { ...platformDescriptor, value: "win32" });
  registerDeepLinkProtocol({ info() {}, warn() {} });
  assert.deepEqual(calls, []);

  Object.defineProperty(process, "platform", { ...platformDescriptor, value: "darwin" });
  registerDeepLinkProtocol({ info() {}, warn() {} });
  assert.deepEqual(calls, [["zcode"]]);
});
