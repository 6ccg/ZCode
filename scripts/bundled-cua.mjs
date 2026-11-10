// Build-time only. Vendor bytes are written outside the public checkout.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";

const run = promisify(execFile);
const checkout = resolve(import.meta.dirname, "..");
export const CUA_RELEASE = Object.freeze({
  version: "3.17.2",
  cuaVersion: "0.6.5",
  electronVersion: "44.7.0",
  patchCommit: "c81950cb6dbdb4e1529879174632b3909cca26f8",
  serverSha256: "2ec51dbeea3449812d04499f1d0c6898346e432c8d94280d855459d29fae68b5",
  targets: {
    "win32-x64": {
      file: "ZCode-3.17.2-win-x64.exe",
      directory: "windows-x64",
      sha256: "41edab524e9636451ba9db3f4d78b68d166e5602401267a14e63317f89c43e48",
      helperEntrySha256: "fccf66e0d28a251e24e1bf8fffe6498eb3ff66b40819d4b7fa5cba63d56e9d9c",
      helperAddonSha256: "11f8bc9c053636fd7199a1e5802a82df652db6bf5ae232165bc530da7530b534",
      resources: "resources",
    },
  },
});

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function assertPrivateOutput(path) {
  if (!isAbsolute(path)) throw new Error("CUA private output must be absolute");
  const rel = relative(checkout, resolve(path));
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    throw new Error("CUA vendor output must be outside the public checkout");
  }
}

export function requireHash(bytes, expected, label) {
  if (sha256(bytes) !== expected) throw new Error(`CUA ${label} SHA-256 mismatch`);
}

export function replaceOnce(source, before, after) {
  const start = source.indexOf(before);
  if (start < 0 || source.indexOf(before, start + before.length) !== -1) {
    throw new Error("CUA patch input changed or is ambiguous");
  }
  return source.slice(0, start) + after + source.slice(start + before.length);
}

export function patchWindowsHelper(source) {
  // 官方 Windows 暂时跳过原生 peer 校验；复用 Host authority 约束 authenticate，不能照搬全开状态。
  source = replaceOnce(
    source,
    "  handleAuthenticate(conn, request) {",
    `  handleAuthenticate(conn, request) {
    const expected = process.env.ZCODE_CUA_PLUGIN_AUTHORITY;
    if (!expected || expected.length < 16 || request.params?.pluginAuthority !== expected) {
      conn.closeAfterWrite = true;
      return errorResponse(request.id, "not_authorized", "Computer Use requires the admitted Host authority");
    }`,
  );
  return replaceOnce(
    source,
    "any local process can drive Computer Use",
    "this build requires the admitted Host authority for Computer Use",
  );
}

export function replaceFunctionBody(source, name, body) {
  const ast = ts.createSourceFile(
    "vendor.js",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const matches = ast.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === name && node.body,
  );
  if (matches.length !== 1) throw new Error(`CUA patch requires exactly one ${name}`);
  const node = matches[0].body;
  return source.slice(0, node.getStart(ast)) + `{\n${body}\n}` + source.slice(node.end);
}

export function extractRuntime(server, reference) {
  const startMarker = "// ../../../../packages/zcode-cua/dist/index.js";
  const endMarker = "// ../../../../packages/shared/src/browser-use/command-metadata.ts";
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  if (start < 0 || end <= start || server.indexOf(startMarker, start + 1) !== -1) {
    throw new Error("CUA official runtime boundaries changed");
  }
  const preludeEnd = reference.indexOf("import { homedir as homedir2 }");
  const exportsStart = reference.lastIndexOf("\nexport {");
  if (preludeEnd < 0 || exportsStart < 0) throw new Error("CUA patch template changed");
  let result =
    reference.slice(0, preludeEnd) + server.slice(start, end) + reference.slice(exportsStart);
  // 原版开发路径允许缺失组件后联网下载；固定随包组件不得保留这个可执行分支。
  const noDownload =
    'throw new Error("CUA is bundled with this application; update the application to replace it. Helper downloads are disabled.");';
  result = replaceFunctionBody(result, "stageDownloadedHelperApp", noDownload);
  result = replaceFunctionBody(result, "defaultDownloadFile", noDownload);
  result = replaceOnce(
    result,
    "      clientApiVersion: CUA_BROKER_IPC_VERSION,",
    "      clientApiVersion: CUA_BROKER_IPC_VERSION,\n      pluginAuthority: process.env.ZCODE_CUA_PLUGIN_AUTHORITY,",
  );
  // plugin host 会清理敏感 env；必须在 factory admission 时捕获 authority，不能每次 RPC 再读 env。
  result = replaceOnce(
    result,
    "    this.operationHooks = options.operationHooks;",
    "    this.operationHooks = options.operationHooks;\n    this.pluginAuthority = options.pluginAuthority;",
  );
  result = replaceOnce(
    result,
    "      onPresentation: recordBrokerPresentation",
    "      onPresentation: recordBrokerPresentation,\n      authenticateParams: { pluginAuthority: this.pluginAuthority }",
  );
  result = replaceOnce(
    result,
    "    operationHooks: sessionOperationHooks(),",
    "    operationHooks: sessionOperationHooks(),\n    pluginAuthority: env.ZCODE_CUA_PLUGIN_AUTHORITY,",
  );
  // Release 的安装计划也必须拒绝 fallback，而不是仅依赖下载函数稍后失败。
  const sourceStart = result.indexOf(
    '  const source = bundledAppPath ? { kind: "bundled", appPath: bundledAppPath } : (() => {',
  );
  const sourceEnd = result.indexOf("  const installRoot =", sourceStart);
  if (sourceStart < 0 || sourceEnd < 0) throw new Error("CUA bundled install plan changed");
  result =
    result.slice(0, sourceStart) +
    '  if (!bundledAppPath) throw new Error("Bundled CUA helper is missing; reinstall this application.");\n' +
    '  const source = { kind: "bundled", appPath: bundledAppPath };\n' +
    result.slice(sourceEnd);
  return result;
}

async function pinnedPatchFile(patchRoot, name) {
  const { stdout } = await run(
    "git",
    ["-C", patchRoot, "show", `${CUA_RELEASE.patchCommit}:runtimes/zcode-cua/${name}`],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout;
}

export async function prepareCuaBundle({ resources, patchRoot, output, target }) {
  assertPrivateOutput(output);
  if (!CUA_RELEASE.targets[target]) throw new Error(`Unsupported fixed CUA target: ${target}`);
  const server = await readFile(
    resolve(resources, "glm/packages/node-repl-host/dist/mcp/server.js"),
  );
  requireHash(server, CUA_RELEASE.serverSha256, "official node-repl-host");
  // 使用固定 Git 对象读取桥接层，避免把工作目录中已被修改的补丁当成固定输入。
  const reference = await pinnedPatchFile(patchRoot, "vendor/dist-index.js");
  const manifest = JSON.parse(await pinnedPatchFile(patchRoot, "package.json"));
  const runtimeRoot = resolve(output, "runtime");
  try {
    await stat(output);
    throw new Error("CUA output already exists; use a new private output directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(resolve(runtimeRoot, "vendor"), { recursive: true });
  for (const entry of Object.values(manifest.exports)) {
    const name = entry.import.slice(2);
    let source = await pinnedPatchFile(patchRoot, name);
    if (name === "broker.js") {
      source = replaceOnce(
        source,
        "    timeoutMs: args.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,",
        "    timeoutMs: args.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,\n    authenticateParams: { pluginAuthority: args.pluginAuthority ?? process.env.ZCODE_CUA_PLUGIN_AUTHORITY },",
      );
      source = replaceOnce(
        source,
        "        timeoutMs: perTryTimeoutMs,",
        "        timeoutMs: perTryTimeoutMs,\n        pluginAuthority: options.pluginAuthority,",
      );
    }
    await writeFile(resolve(runtimeRoot, name), source);
  }
  manifest.version = CUA_RELEASE.cuaVersion;
  manifest.license = "SEE LICENSE IN NOTICE";
  manifest.zcodeCuaBundledTarget = target;
  await writeFile(resolve(runtimeRoot, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  const vendor = extractRuntime(server.toString("utf8"), reference);
  await writeFile(resolve(runtimeRoot, "vendor/dist-index.js"), vendor);
  await writeFile(
    resolve(output, "PATCH-LICENSE"),
    (await run("git", ["-C", patchRoot, "show", `${CUA_RELEASE.patchCommit}:LICENSE`])).stdout,
  );
  if (target === "win32-x64") {
    const helper = resolve(resources, "tools/cua-helper");
    const metadata = JSON.parse(await readFile(resolve(helper, "runtime-manifest.json"), "utf8"));
    if (
      metadata.packageVersion !== CUA_RELEASE.cuaVersion ||
      metadata.electronVersion !== CUA_RELEASE.electronVersion ||
      `${metadata.platform}-${metadata.arch}` !== target
    ) {
      throw new Error("Official CUA helper version/target mismatch");
    }
    for (const name of ["entry", "addon"]) {
      const pinnedHash =
        name === "entry"
          ? CUA_RELEASE.targets[target].helperEntrySha256
          : CUA_RELEASE.targets[target].helperAddonSha256;
      if (metadata.sha256[name] !== pinnedHash) {
        throw new Error(
          `Official CUA helper ${name} manifest hash differs from the pinned release`,
        );
      }
      requireHash(await readFile(resolve(helper, metadata[name])), pinnedHash, `helper ${name}`);
    }
    await cp(helper, resolve(output, "helper"), { recursive: true });
    const entryPath = resolve(output, "helper", metadata.entry);
    const patched = patchWindowsHelper(await readFile(entryPath, "utf8"));
    await writeFile(entryPath, patched);
    metadata.sha256.entry = sha256(Buffer.from(patched));
    await writeFile(
      resolve(output, "helper/runtime-manifest.json"),
      JSON.stringify(metadata, null, 2) + "\n",
    );
  }
  const bundleManifest =
    JSON.stringify(
      {
        schemaVersion: 1,
        applicationVersion: CUA_RELEASE.version,
        cuaVersion: CUA_RELEASE.cuaVersion,
        electronVersion: CUA_RELEASE.electronVersion,
        target,
        patchCommit: CUA_RELEASE.patchCommit,
        officialArchiveSha256: CUA_RELEASE.targets[target].sha256,
        officialServerSha256: CUA_RELEASE.serverSha256,
        patchedRuntimeSha256: sha256(Buffer.from(vendor)),
        independentUpdates: false,
      },
      null,
      2,
    ) + "\n";
  await writeFile(resolve(output, "bundle-manifest.json"), bundleManifest);
  await writeFile(resolve(runtimeRoot, "bundle-manifest.json"), bundleManifest);
  await writeFile(
    resolve(runtimeRoot, "NOTICE"),
    `Computer Use components extracted from ZCode ${CUA_RELEASE.version}.\nOfficial runtime/native components retain their original rights; this repository's Apache-2.0 license does not cover them.\nBridge adapted from luxi233/ZcodePro ${CUA_RELEASE.patchCommit}.\nThe MIT license below applies to the bridge only:\n\n${await readFile(resolve(output, "PATCH-LICENSE"), "utf8")}`,
  );
  return output;
}

async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      output: { type: "string" },
      resources: { type: "string" },
      "patch-root": { type: "string" },
      archive: { type: "string" },
      "7zip": { type: "string", default: "7z" },
    },
  });
  const { target, output, archive } = values;
  assertPrivateOutput(output ?? "");
  const pin = CUA_RELEASE.targets[target];
  if (!pin || !values["patch-root"]) throw new Error("Require --target, --output and --patch-root");
  let resources = values.resources;
  if (archive) {
    assertPrivateOutput(archive);
    let bytes;
    try {
      bytes = await readFile(archive);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const url = `https://cdn-zcode.z.ai/zcode/electron/releases/${CUA_RELEASE.version}/${pin.directory}/${pin.file}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`CUA archive download failed: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      requireHash(bytes, pin.sha256, "archive");
      await mkdir(dirname(archive), { recursive: true });
      await writeFile(`${archive}.partial`, bytes);
      await rename(`${archive}.partial`, archive);
    }
    requireHash(bytes, pin.sha256, "archive");
    const extracted = `${archive}.extracted`;
    await run(values["7zip"], ["x", "-y", `-o${extracted}`, archive], {
      maxBuffer: 4 * 1024 * 1024,
    });
    resources = resolve(extracted, pin.resources);
  }
  if (!resources) throw new Error("Require --archive or --resources");
  console.log(
    await prepareCuaBundle({
      resources,
      patchRoot: values["patch-root"],
      output,
      target,
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
