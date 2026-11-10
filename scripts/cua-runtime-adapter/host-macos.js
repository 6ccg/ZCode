import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { realpath, readFile } from "node:fs/promises";
import { join } from "node:path";
import { callBrokerMethod, mintBrokerSocketPath, probeHelperHealth } from "./broker.js";

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function resolveHelperPermissionSubjectIdentity(appPath) {
  const root = await realpath(appPath);
  const plist = await readFile(join(root, "Contents/Info.plist"), "utf8");
  const value = (key) =>
    plist.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`))?.[1];
  return {
    appPath: root,
    executablePath: join(root, "Contents/MacOS", value("CFBundleExecutable")),
    displayName: value("CFBundleDisplayName"),
    bundleId: value("CFBundleIdentifier"),
  };
}

export function createCuaHelperInstaller(options = {}) {
  const app = options.bundledAppPath;
  const verifyInstalled = async (appPath) => {
    if (!appPath) throw new Error("Bundled Computer Use helper is missing");
    await resolveHelperPermissionSubjectIdentity(appPath);
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  };
  return {
    verifyInstalled,
    async ensureInstalled() {
      await verifyInstalled(app);
      return app;
    },
  };
}

export function createProductCuaHelperHost(options = {}) {
  const env = options.env ?? process.env;
  const socketPath = options.socketPath ?? mintBrokerSocketPath();
  const pluginAuthority = options.pluginAuthority ?? randomBytes(24).toString("hex");
  const transport = Object.freeze({ socketPath, pluginAuthority });
  const execute = options.execute ?? run;
  const probe = options.probe ?? probeHelperHealth;
  const signal = options.signalProcess ?? process.kill.bind(process);
  const delay = options.delay ?? sleep;
  const installer =
    options.helperInstaller ??
    createCuaHelperInstaller({ bundledAppPath: options.bundledHelperAppPath });
  let handle;
  let tail = Promise.resolve();
  let terminationBlocked = false;
  const serial = (action) => {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  };
  const rpc = (method, params = {}) =>
    callBrokerMethod({ ...transport, method, params, timeoutMs: options.healthTimeoutMs ?? 30000 });
  async function startNow() {
    if (terminationBlocked) throw new Error("Previous Computer Use helper has not exited");
    if (handle) return handle;
    const app = await installer.ensureInstalled();
    const args = [
      "-n",
      "-g",
      "--env",
      `ZCODE_CUA_PLUGIN_AUTHORITY=${pluginAuthority}`,
      "-a",
      app,
      "--args",
      "--socket",
      socketPath,
      "--launcher-pid",
      String(process.pid),
      "--expected-app-bundle-path",
      app,
      "--allow-unsigned-launcher-local-dev",
      "--allow-external-broker-client-local-dev",
      "--ghost-cursor-overlay",
      "--pip-mode",
    ];
    await execute("/usr/bin/open", args, { env, timeout: 30000 });
    const health = await probe(socketPath, {
      pluginAuthority,
      timeoutMs: options.healthTimeoutMs ?? 30000,
    });
    if (!Number.isInteger(health.pid) || health.pid <= 0)
      throw new Error("Computer Use helper did not return its PID");
    handle = { ...transport, pid: health.pid, bundleId: health.bundleId, helperAppPath: app };
    return handle;
  }
  async function stopNow() {
    if (!handle) return;
    const pid = handle.pid;
    try {
      signal(pid, "SIGTERM");
    } catch (error) {
      if (error.code === "ESRCH") {
        handle = undefined;
        return;
      }
      throw error;
    }
    // 必须等本 Host 的进程退出后再重启，避免旧 helper 仍持有已授权的桌面控制能力。
    for (let n = 0; n < 50; n++) {
      try {
        signal(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") {
          handle = undefined;
          return;
        }
        throw error;
      }
      await delay(100);
    }
    terminationBlocked = true;
    throw new Error("Computer Use helper did not exit; restart is blocked");
  }
  return {
    get running() {
      return Boolean(handle);
    },
    get socketPath() {
      return handle?.socketPath ?? null;
    },
    get pluginAuthority() {
      return pluginAuthority;
    },
    get reservedTransport() {
      return transport;
    },
    start: () => serial(startNow),
    stop: () => serial(stopNow),
    restart: () =>
      serial(async () => {
        await stopNow();
        return startNow();
      }),
    restartAfterCurrentStart: () =>
      serial(async () => {
        await stopNow();
        return startNow();
      }),
    restartAfterCurrentStartPreservingTransport: (restartOptions = {}) =>
      serial(async () => {
        await stopNow();
        restartOptions.beforeFreshStart?.();
        return { handle: await startNow(), reused: false };
      }),
    waitForTransport: async () => transport,
    checkHealth: (timeoutMs) => probe(socketPath, { pluginAuthority, timeoutMs }),
    queryPermissionStatus: () => rpc("permission_status"),
    queryScreenCaptureProbe: () => rpc("screen_capture_probe"),
    queryScreenRecordingPreflight: async () => (await rpc("permission_status")).screen_recording,
  };
}
