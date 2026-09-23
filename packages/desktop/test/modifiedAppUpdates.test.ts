import assert from "node:assert/strict";
import { test, vi } from "vitest";

test("modified updater ignores startup, old settings and manual or channel checks", async () => {
  const unexpected = () => {
    throw new Error("disabled updater performed a side effect");
  };
  vi.doMock("electron", () => ({
    app: { isPackaged: true },
    BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
    Menu: { getApplicationMenu: () => null },
    ipcMain: { handle: unexpected, on: unexpected },
  }));
  vi.doMock("electron-updater", () => ({
    default: { autoUpdater: new Proxy({}, { get: unexpected }) },
    CancellationToken: class {},
  }));
  vi.doMock("../src/main/logger.js", () => ({
    logger: { info() {}, warn() {}, error() {} },
  }));
  vi.doMock("../src/main/manifestUpdateProvider.js", () => ({
    getElectronReleasePlatform: unexpected,
    ManifestUpdateProvider: class {},
  }));
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
