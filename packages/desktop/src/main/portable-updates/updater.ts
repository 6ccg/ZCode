import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import originalFs from "node:original-fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import type {
  PortableUpdateCommand,
  PortableUpdatePreferences,
  PortableUpdateState,
} from "@zcode/shared";
import type {
  DesktopPortableUpdatesContract,
  PortableRelease,
  PortableUpdaterOptions,
  PreparedPortableUpdate,
} from "./contract.js";
import { portableUpdateCommandSchema } from "./contract.js";
import { isNewRelease, resolveRelease, updateSourceUrl } from "./feed.js";

export function createPortableUpdater(
  options: PortableUpdaterOptions,
): DesktopPortableUpdatesContract {
  let state: PortableUpdateState = {
    revision: 0,
    phase: "idle",
    supported: options.supported,
    currentVersion: options.current.version,
    preferences: { source: "", automatic: false, autoDownload: false },
  };
  let release: PortableRelease | undefined;
  let prepared: PreparedPortableUpdate | undefined;
  let controller: AbortController | undefined;
  let operation: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let generation = 0;
  let disposed = false;
  let pollGeneration = 0;
  let preferencesQueue: Promise<unknown> = Promise.resolve();
  const queuePreferences = (work: () => Promise<void>) => {
    const pending = preferencesQueue.then(work, work);
    preferencesQueue = pending.catch(() => {});
    return pending;
  };
  const snapshot = () => structuredClone(state);
  const isInstalling = () => state.phase === "installing";
  function publish(patch: Partial<PortableUpdateState>) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    options.broadcast(snapshot());
  }
  async function clearPrepared() {
    const previous = prepared;
    prepared = undefined;
    if (previous)
      await originalFs.promises.rm(previous.workspace, { recursive: true, force: true });
  }
  function schedule() {
    const pollId = ++pollGeneration;
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!disposed && options.supported && state.preferences.source && state.preferences.automatic) {
      timer = setTimeout(() => {
        void execute({ action: "check" }).finally(() => {
          if (
            pollId === pollGeneration &&
            !disposed &&
            state.preferences.automatic &&
            state.preferences.source
          ) {
            timer = setTimeout(schedule, 6 * 60 * 60 * 1000);
            timer.unref();
          }
        });
      }, 10_000);
      timer.unref();
    }
  }
  async function cancel() {
    generation++;
    controller?.abort();
    controller = undefined;
    // 换源不等待不遵守 AbortSignal 的旧响应；generation 阻止其写回，原任务自行清理。
    operation = undefined;
    release = undefined;
    await clearPrepared();
    publish({ phase: "idle", version: undefined, progress: undefined, error: undefined });
  }
  function perform(work: (signal: AbortSignal, id: number) => Promise<void>): Promise<void> {
    if (operation) return operation;
    const current = new AbortController();
    controller = current;
    const id = ++generation;
    const promise = work(current.signal, id)
      .catch((error) => {
        if (generation === id && !current.signal.aborted)
          publish({
            phase: "error",
            error: error instanceof Error ? error.message : String(error),
          });
      })
      .finally(() => {
        if (operation === promise) operation = undefined;
        if (controller === current) controller = undefined;
      });
    operation = promise;
    return promise;
  }
  async function check(signal: AbortSignal, id: number) {
    if (!state.preferences.source || state.phase === "ready" || isInstalling()) return;
    publish({ phase: "checking", error: undefined, version: undefined, progress: undefined });
    const candidate = await resolveRelease(state.preferences.source, options, signal);
    if (generation !== id || signal.aborted) return;
    release = isNewRelease(candidate, options.current) ? candidate : undefined;
    publish({ phase: release ? "available" : "idle", version: release?.version });
  }
  async function download(signal: AbortSignal, id: number) {
    if (!release || prepared) return;
    const candidate = release;
    publish({ phase: "downloading", progress: 0, error: undefined, version: candidate.version });
    await mkdir(options.cacheDir, { recursive: true });
    const temp = await mkdtemp(join(options.cacheDir, "download-"));
    try {
      const response = await options.fetch(candidate.url, {
        signal,
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok || !response.body) throw new Error(`下载更新失败：HTTP ${response.status}`);
      const hash = createHash("sha256");
      const total = Number(response.headers.get("content-length"));
      let bytes = 0;
      let progress = -1;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          bytes += chunk.length;
          const next = total > 0 ? Math.min(99, Math.floor((bytes / total) * 100)) : 0;
          if (next !== progress && generation === id) {
            progress = next;
            publish({ progress: next });
          }
          callback(null, chunk);
        },
      });
      const archive = join(temp, "update.zip");
      await pipeline(
        Readable.fromWeb(response.body as ReadableStream),
        meter,
        createWriteStream(archive),
        { signal },
      );
      if (hash.digest("hex") !== candidate.sha256)
        throw new Error("更新包 SHA-256 校验失败，现有程序未修改");
      const plan = await options.prepare(candidate, archive, signal);
      if (generation !== id || signal.aborted) {
        await originalFs.promises.rm(plan.workspace, { recursive: true, force: true });
        return;
      }
      prepared = plan;
      publish({ phase: "ready", progress: 100 });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  async function execute(input: PortableUpdateCommand): Promise<PortableUpdateState> {
    const command = portableUpdateCommandSchema.parse(input);
    if (command.action === "status") return snapshot();
    if (disposed || isInstalling()) return snapshot();
    if (command.action === "configure") {
      if (command.preferences.source) updateSourceUrl(command.preferences.source);
      const preferences: PortableUpdatePreferences = command.preferences;
      await queuePreferences(async () => {
        if (disposed || isInstalling()) return;
        await options.settings.update({ portableUpdates: preferences });
        await cancel();
        publish({ preferences });
        options.onPreferencesChanged();
        schedule();
      });
    } else if (command.action === "cancel") {
      await cancel();
    } else if (command.action === "check") {
      await perform(check);
      if (state.phase === "available" && state.preferences.autoDownload) await perform(download);
    } else if (command.action === "download") {
      await perform(download);
    } else if (command.action === "install") {
      await preferencesQueue;
      if (disposed || isInstalling() || !prepared) return snapshot();
      if (!options.supported) publish({ error: "只能在 Windows/Mac 绿色版中安装更新" });
      else if (!options.canInstall())
        publish({ error: "请先结束正在运行的 Agent 任务，再重启安装" });
      else {
        publish({ phase: "installing", error: undefined });
        try {
          await options.install(prepared);
        } catch (error) {
          publish({
            phase: "ready",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return snapshot();
  }
  return {
    async initialize() {
      const settings = await options.settings.get();
      publish({ preferences: settings.portableUpdates ?? state.preferences });
      try {
        const result = JSON.parse(
          await readFile(join(options.cacheDir, "result.json"), "utf8"),
        ) as { error?: string };
        if (result.error) publish({ phase: "error", error: result.error });
        await rm(join(options.cacheDir, "result.json"), { force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          publish({ error: "上次更新结果无法读取，请重新检查更新" });
      }
      schedule();
    },
    execute,
    reloadPreferences: () =>
      queuePreferences(async () => {
        if (disposed || isInstalling()) return;
        const preferences = (await options.settings.get()).portableUpdates ?? {
          source: "",
          automatic: false,
          autoDownload: false,
        };
        if (disposed || isInstalling()) return;
        const previous = state.preferences;
        if (
          previous.source === preferences.source &&
          previous.automatic === preferences.automatic &&
          previous.autoDownload === preferences.autoDownload
        )
          return;
        await cancel();
        publish({ preferences });
        schedule();
      }),
    async dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      await preferencesQueue;
      generation++;
      controller?.abort();
      await operation;
      if (state.phase !== "installing") await clearPrepared();
    },
  };
}
