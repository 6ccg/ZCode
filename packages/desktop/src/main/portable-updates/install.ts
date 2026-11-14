import { constants } from "node:fs";
import originalFs from "node:original-fs";
import yauzl from "yauzl";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { PortableRelease, PreparedPortableUpdate } from "./contract.js";

const run = promisify(execFile);
// 暂存目录中的 app.asar 必须按真实文件遍历、读取和删除，避免 Electron 的 ASAR fs 缓存句柄。
const { access, copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } =
  originalFs.promises;

async function verifyArchivePaths(archive: string, signal: AbortSignal): Promise<void> {
  await new Promise<void>((done, fail) => {
    yauzl.open(archive, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) {
        fail(error ?? new Error("无法读取更新 ZIP"));
        return;
      }
      const names = new Set<string>();
      const links = new Map<string, string>();
      zip.on("error", fail);
      zip.on("entry", async (entry) => {
        try {
          signal.throwIfAborted();
          const name = entry.fileName.replace(/\/$/, "");
          if (
            !name ||
            name.startsWith("/") ||
            name.includes("\\") ||
            name.split("/").includes("..") ||
            /^[A-Za-z]:/.test(name) ||
            names.has(name)
          )
            throw new Error("更新 ZIP 包含无效或重复路径");
          names.add(name);
          if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
            const stream = await new Promise<import("node:stream").Readable>(
              (resolveStream, reject) =>
                zip.openReadStream(entry, (err, value) =>
                  err || !value ? reject(err) : resolveStream(value),
                ),
            );
            // Mac ZIP 的未压缩链接使用 yauzl 的旧式 fd-slicer 流；它在 end 前设置
            // destroyed，for-await 会继续等待不存在的 close。按 end 完成读取，避免卡死。
            const chunks: Buffer[] = [];
            let bytes = 0;
            await new Promise<void>((resolveStream, reject) => {
              stream.once("error", reject);
              stream.once("end", resolveStream);
              stream.on("data", (chunk: Buffer) => {
                bytes += chunk.length;
                if (bytes > 4096) stream.destroy(new Error("更新 ZIP 链接过长"));
                else chunks.push(chunk);
              });
            });
            const target = Buffer.concat(chunks).toString("utf8");
            if (target.startsWith("/") || target.includes("\\") || /^[A-Za-z]:/.test(target))
              throw new Error("更新 ZIP 链接指向程序目录之外");
            links.set(name, target);
          }
          zip.readEntry();
        } catch (reason) {
          zip.close();
          fail(reason);
        }
      });
      zip.on("end", () => {
        try {
          for (const name of names) {
            const parts = name.split("/");
            for (let index = 1; index < parts.length; index++)
              if (links.has(parts.slice(0, index).join("/")))
                throw new Error("更新 ZIP 包含通过链接写入的路径");
            const resolved: string[] = [];
            const pending = [...parts];
            let followed = 0;
            while (pending.length) {
              const part = pending.shift()!;
              if (!part || part === ".") continue;
              if (part === "..") {
                if (!resolved.length) throw new Error("更新 ZIP 链接指向程序目录之外");
                resolved.pop();
                continue;
              }
              const target = links.get([...resolved, part].join("/"));
              if (target !== undefined) {
                if (++followed > 64) throw new Error("更新 ZIP 包含循环链接");
                pending.unshift(...target.split("/"));
              } else resolved.push(part);
            }
          }
          done();
        } catch (reason) {
          fail(reason);
        }
      });
      zip.readEntry();
    });
  });
}

async function readPackagedIdentity(
  archive: string,
): Promise<{ appVersion?: string; buildCommitId?: string }> {
  // Electron 读取 ASAR 内路径会缓存 archive 句柄，Windows 因此无法清理或替换暂存包。
  // 用独立、可关闭的普通文件句柄读 ASAR pickle 头和这一份 metadata，避免修改全局 noAsar。
  const file = await originalFs.promises.open(archive, "r");
  try {
    const prefix = Buffer.alloc(8);
    if ((await file.read(prefix, 0, 8, 0)).bytesRead !== 8) throw new Error("更新包 ASAR 头不完整");
    const size = prefix.readUInt32LE(4);
    if (size < 8 || size > 64 * 1024 * 1024) throw new Error("更新包 ASAR 头大小无效");
    const header = Buffer.alloc(size);
    if ((await file.read(header, 0, size, 8)).bytesRead !== size)
      throw new Error("更新包 ASAR 头不完整");
    const length = header.readUInt32LE(4);
    if (length > size - 8) throw new Error("更新包 ASAR 头格式无效");
    const tree = JSON.parse(header.subarray(8, 8 + length).toString("utf8"));
    let entry = tree;
    for (const part of ["out", "metadata", "build-meta.json"]) entry = entry?.files?.[part];
    if (
      !entry ||
      entry.unpacked ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 1 ||
      entry.size > 16_384 ||
      !/^\d+$/.test(String(entry.offset))
    )
      throw new Error("更新包缺少完整的构建身份");
    const offset = Number(entry.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("更新包 ASAR 偏移无效");
    const content = Buffer.alloc(entry.size);
    if ((await file.read(content, 0, entry.size, 8 + size + offset)).bytesRead !== entry.size)
      throw new Error("更新包构建身份不完整");
    return JSON.parse(content.toString("utf8"));
  } finally {
    await file.close();
  }
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    !path ||
    (!isAbsolute(path) &&
      path !== ".." &&
      !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
  );
}

async function managedEntries(root: string): Promise<string[]> {
  const manifest = await readFile(join(root, ".zcode-install-manifest"), "utf8");
  const entries = [
    ...new Set([
      ".zcode-install-manifest",
      ...manifest
        .split(/\r?\n/)
        .filter(Boolean)
        .map((path) => path.split(/[\\/]/)[0] ?? ""),
    ]),
  ];
  if (
    entries.some(
      (name) =>
        !name ||
        name === "." ||
        name === ".." ||
        /[:\\/]/.test(name) ||
        name.startsWith(".zcode-update-"),
    )
  )
    throw new Error("程序文件清单包含无效路径");
  if (!entries.includes("resources")) throw new Error("程序文件清单不完整，请重新解压完整绿色版");
  return entries;
}

async function verifyLinks(root: string) {
  const canonical = await realpath(root);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isSymbolicLink() &&
      !inside(canonical, await realpath(join(entry.parentPath, entry.name)))
    )
      throw new Error("更新包链接指向程序目录之外");
  }
}

export interface PortableInstallerOptions {
  platform: "win32" | "darwin";
  appRoot: string;
  executable: string;
  cacheDir: string;
  helpersDir: string;
  protectedPaths: () => Promise<string[]>;
  onStage?: (stage: string) => void;
}

export function createPortableInstaller(options: PortableInstallerOptions) {
  async function verifyDestination(plan: PreparedPortableUpdate) {
    await access(options.platform === "win32" ? plan.target : dirname(plan.target), constants.W_OK);
    const protectedPaths = await options.protectedPaths();
    for (const path of protectedPaths) {
      const canonical = await realpath(path).catch(() => resolve(path));
      const targets =
        options.platform === "win32"
          ? plan.managed.map((name) => join(plan.target, name))
          : [plan.target];
      if (targets.some((target) => inside(target, canonical)))
        throw new Error("数据目录位于将替换的程序文件中，请先移出数据目录");
    }
    if (options.platform === "win32") {
      const previous = (await managedEntries(plan.target)).map((name) => name.toLowerCase());
      for (const name of plan.managed) {
        if (
          !previous.includes(name.toLowerCase()) &&
          (await access(join(plan.target, name)).then(
            () => true,
            () => false,
          ))
        )
          throw new Error(`新版本程序文件与目录中的自有文件冲突：${name}，请先移走该文件再更新`);
      }
    }
  }
  return {
    async prepare(
      release: PortableRelease,
      archive: string,
      signal: AbortSignal,
    ): Promise<PreparedPortableUpdate> {
      const root = await realpath(options.appRoot);
      if (options.platform === "darwin" && !root.endsWith(".app"))
        throw new Error("只能更新完整的 macOS .app");
      if (
        options.platform === "win32" &&
        (await readdir(root)).some((name) => /^uninstall.*\.exe$/i.test(name))
      )
        throw new Error("此更新功能只支持绿色版，安装版请手动升级");
      const workspace = await mkdtemp(
        join(options.platform === "win32" ? root : dirname(root), ".zcode-update-"),
      );
      try {
        const extracted = join(workspace, "extracted");
        options.onStage?.("verify-archive");
        await verifyArchivePaths(archive, signal);
        // Electron 的 ASAR 文件系统包装不适合写入新的 app.asar；原生解压不会切换
        // process.noAsar，避免更新期间破坏其它窗口和正在运行的 Agent 的文件读取。
        options.onStage?.("extract");
        if (options.platform === "win32") {
          await run(
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              join(options.helpersDir, "extract.ps1"),
              "-ArchivePath",
              archive,
              "-Directory",
              extracted,
            ],
            { windowsHide: true, signal, timeout: 120_000 },
          );
        } else {
          await run("/usr/bin/ditto", ["-x", "-k", archive, extracted], {
            signal,
            timeout: 120_000,
          });
        }
        signal.throwIfAborted();
        options.onStage?.("verify-links");
        await verifyLinks(extracted);
        const staged = options.platform === "win32" ? extracted : join(extracted, "ZCode.app");
        const resources =
          options.platform === "win32"
            ? join(staged, "resources")
            : join(staged, "Contents/Resources");
        options.onStage?.("verify-identity");
        const metadata = await readPackagedIdentity(join(resources, "app.asar"));
        const packagedCommit = metadata.buildCommitId?.toLowerCase() ?? "";
        const sourceCommit = release.sourceCommit.toLowerCase();
        if (
          packagedCommit.length < 7 ||
          !(sourceCommit.startsWith(packagedCommit) || packagedCommit.startsWith(sourceCommit)) ||
          metadata.appVersion !== release.version.split("-")[0]
        )
          throw new Error("更新包内的版本或源码提交与更新清单不一致");
        const executable =
          options.platform === "win32"
            ? basename(options.executable)
            : join("Contents", "MacOS", basename(options.executable));
        await access(join(staged, executable));
        const current = options.platform === "win32" ? await managedEntries(root) : [];
        const next = options.platform === "win32" ? await managedEntries(staged) : [];
        if (options.platform === "win32" && !next.includes(executable))
          throw new Error("更新包没有当前程序的可执行文件");
        const plan: PreparedPortableUpdate = {
          workspace,
          target: root,
          staged,
          backup: join(workspace, "backup"),
          resultFile: join(options.cacheDir, "result.json"),
          executable,
          managed: [...new Set([...current, ...next])],
        };
        options.onStage?.("verify-destination");
        await verifyDestination(plan);
        return plan;
      } catch (error) {
        await rm(workspace, { recursive: true, force: true });
        throw error;
      }
    },
    /** 必须在退出收尾之前调用，避免已停止运行时后才发现目录不可写。 */
    validate: verifyDestination,
    async launch(plan: PreparedPortableUpdate): Promise<void> {
      await mkdir(options.cacheDir, { recursive: true });
      const token = randomUUID();
      const helper = join(
        options.cacheDir,
        options.platform === "win32" ? `install-${token}.ps1` : `install-${token}.sh`,
      );
      const ready = join(options.cacheDir, `ready-${token}`);
      const planPath = join(options.cacheDir, `plan-${token}.json`);
      await copyFile(
        join(options.helpersDir, options.platform === "win32" ? "install.ps1" : "install.sh"),
        helper,
      );
      await writeFile(planPath, JSON.stringify({ ...plan, parentPid: process.pid, ready }), "utf8");
      const command = options.platform === "win32" ? "powershell.exe" : "/bin/sh";
      // LaunchServices 默认不保证继承终端启动的 profile；只传递已有的数据目录引导变量，不传账号或模型配置。
      const launchEnvironment = [
        "HOME",
        "USERPROFILE",
        "ZCODE_HOME",
        "ZCODE_DATA_BASE_DIR",
        "ZCODE_DESKTOP_HOME_DIR",
        "ZCODE_DESKTOP_USER_DATA_DIR",
        "ZCODE_DESKTOP_SESSION_DATA_DIR",
      ].flatMap((name) => (process.env[name] ? ["--env", `${name}=${process.env[name]}`] : []));
      const args =
        options.platform === "win32"
          ? [
              "-NoProfile",
              "-NonInteractive",
              "-ExecutionPolicy",
              "Bypass",
              "-File",
              helper,
              "-PlanPath",
              planPath,
            ]
          : [
              helper,
              String(process.pid),
              plan.staged,
              plan.target,
              plan.backup,
              plan.resultFile,
              ready,
              plan.workspace,
              helper,
              planPath,
              ...launchEnvironment,
            ];
      const child = spawn(command, args, {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
        cwd: options.cacheDir,
      });
      let failure: Error | undefined;
      let exited = false;
      child.on("error", (error) => {
        failure = error;
      });
      child.on("exit", () => {
        exited = true;
      });
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          if (failure) throw failure;
          if (exited) throw new Error("更新替换进程未能启动，当前程序尚未替换");
          try {
            await access(ready);
            child.unref();
            return;
          } catch {
            await delay(50);
          }
        }
        throw new Error("更新替换进程启动超时，当前程序尚未替换");
      } catch (error) {
        child.kill();
        await Promise.all([helper, ready, planPath].map((path) => rm(path, { force: true })));
        throw error;
      }
    },
  };
}
