import assert from "node:assert/strict";
import { test } from "node:test";

test("modified updater ignores startup, old settings and manual or channel checks", async (t) => {
  const unexpected = () => {
    throw new Error("disabled updater performed a side effect");
  };
  t.mock.module("electron", {
    namedExports: {
      app: { isPackaged: true },
      BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
      Menu: { getApplicationMenu: () => null },
      ipcMain: { handle: unexpected, on: unexpected },
    },
  });
  t.mock.module("electron-updater", {
    defaultExport: { autoUpdater: new Proxy({}, { get: unexpected }) },
    namedExports: { CancellationToken: class {} },
  });
  t.mock.module(new URL("../src/main/logger.ts", import.meta.url), {
    namedExports: { logger: { info() {}, warn() {}, error() {} } },
  });
  t.mock.module(new URL("../src/main/manifestUpdateProvider.ts", import.meta.url), {
    namedExports: { getElectronReleasePlatform: unexpected, ManifestUpdateProvider: class {} },
  });
  const updater = await import("../src/main/autoUpdater.js");
  const settings = { get: unexpected, update: unexpected };
  await updater.hydratePendingPostUpdateReleaseNotes(settings);
  await updater.initAutoUpdater({ enabled: true, settingService: settings });
  updater.refreshAutoUpdaterReleaseChannel(true);
  updater.checkForUpdateMenuClick({
    isDestroyed: () => false,
    webContents: { send() {} },
  } as Parameters<typeof updater.checkForUpdateMenuClick>[0]);
  updater.requestForceAutoUpdate(() => {});
  assert.deepEqual(updater.getAutoUpdaterState(), { kind: "idle", enabled: false });
});
