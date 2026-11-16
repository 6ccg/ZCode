// Build-time only. Vendor bytes are written outside the public checkout.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import ts from "typescript";

const run = promisify(execFile);
const checkout = resolve(import.meta.dirname, "..");
const adapterRoot = resolve(import.meta.dirname, "cua-runtime-adapter");
export const CUA_RELEASE = Object.freeze({
  version: "3.18.2",
  cuaVersion: "0.6.5",
  electronVersion: "44.7.0",
  serverSha256: "bb8483a33ac2a5c852f9d0847c74f3fa54ae53e9ea721d5ec129dcdde1ee175b",
  targets: {
    "darwin-arm64": {
      file: "ZCode-3.18.2-mac-arm64.zip",
      directory: "macos-arm64",
      sha256: "b5af46c37aa423d3c7d435f41ec4997d50e4148f662117b6980e586be7172dd8",
      helperSha256: "c0204abcd4fbe13c0c81eda650cdb08d76b5deb15b23c15e3fc102d6a97de583",
      resources: "ZCode.app/Contents/Resources",
    },
    "win32-x64": {
      file: "ZCode-3.18.2-win-x64.exe",
      directory: "windows-x64",
      sha256: "7b747ebca9ac55ee695f9f2608b26b9818ec90187c1889e991b73e7728cc268d",
      helperEntrySha256: "fccf66e0d28a251e24e1bf8fffe6498eb3ff66b40819d4b7fa5cba63d56e9d9c",
      helperAddonSha256: "0789882762a77467b3294182ccab032cf87007b7e4a4ab1c0e103c6f88258d08",
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

export function patchMacHelper(input) {
  const bytes = Buffer.from(input);
  const gate = Buffer.from("var allowUnsignedLauncherLocalDev = false;");
  const gateAt = bytes.indexOf(gate);
  const marker = "handleAuthenticate(conn, request) {";
  const start = bytes.indexOf(marker);
  if (
    gateAt < 0 ||
    bytes.indexOf(gate, gateAt + 1) !== -1 ||
    start < 0 ||
    bytes.indexOf(marker, start + 1) !== -1
  )
    throw new Error("Mac helper component input changed");
  const prefix = "class Broker {";
  const ast = ts.createSourceFile(
    "helper.js",
    prefix + bytes.subarray(start, start + 8192).toString("utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const method = ast.statements[0]?.members?.[0];
  if (
    !method ||
    !ts.isMethodDeclaration(method) ||
    method.name.getText(ast) !== "handleAuthenticate"
  )
    throw new Error("Mac helper authentication layout changed");
  const size = Buffer.byteLength(method.getText(ast));
  // 自构建应用不能满足官方团队签名；保留同 UID 检查，并用本次 Host authority 同时约束 tool 和 PiP。
  const replacement =
    'handleAuthenticate(c,r){const a=process.env.ZCODE_CUA_PLUGIN_AUTHORITY;if(!a||a.length<16||r.params?.pluginAuthority!==a){c.closeAfterWrite=true;return errorResponse(r.id,"not_authorized","Host authority required")}const i=parseConnectionIdentity(r.params,c.connectionId);if(r.params?.role==="presentation"){if(c.peerVerdict&&this.peerPresentationEligible?.(c.peerVerdict)===true){this.markConnectionAuthenticated(c,i,"presentation");return okResponse(r.id,{authenticated:true,role:"presentation"})}c.closeAfterWrite=true;return errorResponse(r.id,"not_authorized","Unverified presentation peer")}this.markConnectionAuthenticated(c,i,"tool");return okResponse(r.id,{authenticated:true})}';
  if (Buffer.byteLength(replacement) > size)
    throw new Error("Mac helper adaptation exceeds SEA slot");
  Buffer.from(replacement.padEnd(size, " ")).copy(bytes, start);
  Buffer.from("var allowUnsignedLauncherLocalDev = true ;").copy(bytes, gateAt);
  return bytes;
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

export function collectRuntimeExports(sources) {
  const names = new Set();
  for (const source of sources) {
    const ast = ts.createSourceFile(
      "adapter.js",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (node.moduleSpecifier?.text !== "./vendor/dist-index.js") continue;
      const bindings = ts.isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause;
      if (!bindings || (!ts.isNamedImports(bindings) && !ts.isNamedExports(bindings))) {
        throw new Error("CUA adapter must name its official runtime dependencies explicitly");
      }
      for (const item of bindings.elements) names.add(item.propertyName?.text ?? item.name.text);
    }
  }
  if (!names.has("createComputerUseRuntime"))
    throw new Error("CUA runtime factory export is missing");
  return [...names].sort();
}

export function collectRuntimeCalls(sources) {
  const calls = [];
  for (const source of sources) {
    const ast = ts.createSourceFile(
      "contract.js",
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "externalWindowsCuaFunction"
      ) {
        const [entry, name] = node.arguments;
        if (!entry || !name || !ts.isStringLiteral(entry) || !ts.isStringLiteral(name)) {
          throw new Error("CUA public runtime calls must name their entry and function explicitly");
        }
        calls.push({ entry: entry.text, name: name.text });
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return calls;
}

export function extractRuntime(server, exports) {
  const startMarker = "// ../../../../packages/zcode-cua/dist/index.js";
  const endMarker = "// ../../../../packages/shared/src/browser-use/command-metadata.ts";
  const start = server.indexOf(startMarker);
  const end = server.indexOf(endMarker, start);
  if (start < 0 || end <= start || server.indexOf(startMarker, start + 1) !== -1) {
    throw new Error("CUA official runtime boundaries changed");
  }
  const preludeEnd = server.indexOf("\n// ../../../../node_modules/");
  if (preludeEnd < 0 || preludeEnd >= start)
    throw new Error("CUA official bundler prelude changed");
  // 当前官方包的 HTTP transport 引用了外部 Express；本地工具运行时不使用 HTTP transport。
  // 保留可选依赖查询，不能把整个官方 Agent 或其他插件的实现带入 CUA。
  const optionalExpress =
    '\nvar require_express2 = () => { try { return require("express"); } catch { return {}; } };\n';
  let result =
    server.slice(0, preludeEnd) +
    optionalExpress +
    server.slice(start, end) +
    `\nexport { ${exports.join(", ")} };\n`;
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

export async function prepareCuaBundle({ resources, output, target, signMacos = false }) {
  assertPrivateOutput(output);
  if (!CUA_RELEASE.targets[target]) throw new Error(`Unsupported fixed CUA target: ${target}`);
  const server = await readFile(
    resolve(resources, "glm/packages/node-repl-host/dist/mcp/server.js"),
  );
  requireHash(server, CUA_RELEASE.serverSha256, "official node-repl-host");
  const contractRoot = resolve(checkout, "packages/zcode-cua");
  const contract = JSON.parse(await readFile(resolve(contractRoot, "package.json"), "utf8"));
  const application = JSON.parse(await readFile(resolve(checkout, "package.json"), "utf8"));
  if (application.version !== CUA_RELEASE.version || contract.version !== CUA_RELEASE.cuaVersion) {
    throw new Error(
      "Update the CUA adaptations for the current application and CUA contract versions",
    );
  }
  const manifest = {
    name: contract.name,
    version: CUA_RELEASE.cuaVersion,
    type: "module",
    private: true,
    license: "SEE LICENSE IN NOTICE",
    zcodeCuaBundledTarget: target,
    exports: Object.fromEntries(
      Object.entries(contract.exports).map(([name, value]) => [name, { import: value.import }]),
    ),
  };
  const runtimeRoot = resolve(output, "runtime");
  try {
    await stat(output);
    throw new Error("CUA output already exists; use a new private output directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(resolve(runtimeRoot, "vendor"), { recursive: true });
  const adapters = await Promise.all(
    (await readdir(adapterRoot))
      .filter((name) => name.endsWith(".js"))
      .map(async (name) => ({ name, source: await readFile(resolve(adapterRoot, name), "utf8") })),
  );
  for (const { name, source } of adapters) {
    await writeFile(resolve(runtimeRoot, name), source);
  }
  await writeFile(resolve(runtimeRoot, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  const vendor = extractRuntime(
    server.toString("utf8"),
    collectRuntimeExports(adapters.map((item) => item.source)),
  );
  await writeFile(resolve(runtimeRoot, "vendor/dist-index.js"), vendor);
  await run(process.execPath, ["--check", resolve(runtimeRoot, "vendor/dist-index.js")]);
  const publicSources = await Promise.all(
    (await readdir(contractRoot))
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFile(resolve(contractRoot, name), "utf8")),
  );
  const entries = Object.fromEntries(
    Object.entries(manifest.exports).map(([name, value]) => [
      name,
      pathToFileURL(resolve(runtimeRoot, value.import)).href,
    ]),
  );
  // 校验当前开源入口真正调用的函数，而不只是旧桥接模块能 import；升级接口不匹配时在构建阶段停止。
  await run(process.execPath, [
    "--input-type=module",
    "-e",
    `
    const {entries,calls}=JSON.parse(process.argv[1]);
    const modules=new Map();
    for(const [name,url] of Object.entries(entries)) modules.set(name,await import(url));
    for(const {entry,name} of calls) if(typeof modules.get(entry)?.[name]!=="function") throw new Error("CUA adapter is missing current interface: "+entry+"#"+name);
  `,
    JSON.stringify({ entries, calls: collectRuntimeCalls(publicSources) }),
  ]);
  await writeFile(
    resolve(output, "ADAPTER-LICENSE"),
    await readFile(resolve(adapterRoot, "LICENSE")),
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
  if (target === "darwin-arm64") {
    const appName = "ZCode Computer Use.app";
    const sourceApp = resolve(resources, "cua-helper", appName);
    const relativeBinary = "Contents/MacOS/ZCode Computer Use";
    const original = await readFile(resolve(sourceApp, relativeBinary));
    requireHash(original, CUA_RELEASE.targets[target].helperSha256, "Mac helper");
    const app = resolve(output, "helper", appName);
    await cp(sourceApp, app, { recursive: true });
    await writeFile(resolve(app, relativeBinary), patchMacHelper(original));
    await cp(
      resolve(sourceApp, "Contents/Resources/node_modules"),
      resolve(output, "plugin/node_modules"),
      { recursive: true },
    );
    if (signMacos) {
      if (process.platform !== "darwin") throw new Error("Mac component signing requires macOS");
      await run("chmod", ["+x", resolve(app, relativeBinary)]);
      await run("codesign", [
        "--force",
        "--deep",
        "--sign",
        "-",
        "--identifier",
        "dev.zcode.cua-helper",
        app,
      ]);
      await run("codesign", ["--verify", "--deep", "--strict", app]);
    }
  }
  const bundleManifest =
    JSON.stringify(
      {
        schemaVersion: 1,
        applicationVersion: CUA_RELEASE.version,
        cuaVersion: CUA_RELEASE.cuaVersion,
        electronVersion: CUA_RELEASE.electronVersion,
        target,
        adapter: "project-maintained",
        officialArchiveSha256: CUA_RELEASE.targets[target].sha256,
        officialServerSha256: CUA_RELEASE.serverSha256,
        patchedRuntimeSha256: sha256(Buffer.from(vendor)),
        independentUpdates: false,
        ...(target === "darwin-arm64"
          ? { macosHelperSigned: signMacos && process.platform === "darwin" }
          : {}),
      },
      null,
      2,
    ) + "\n";
  await writeFile(resolve(output, "bundle-manifest.json"), bundleManifest);
  await writeFile(resolve(runtimeRoot, "bundle-manifest.json"), bundleManifest);
  await writeFile(
    resolve(runtimeRoot, "NOTICE"),
    `Bundled Computer Use ${CUA_RELEASE.cuaVersion}, sourced from ZCode ${CUA_RELEASE.version}.\nPrivate runtime/native components retain their original rights and are not covered by this repository's Apache-2.0 license.\nBridge portions are adapted from luxi233/ZcodePro under the MIT license below:\n\n${await readFile(resolve(output, "ADAPTER-LICENSE"), "utf8")}`,
  );
  return output;
}

async function main() {
  const { values } = parseArgs({
    options: {
      target: { type: "string" },
      output: { type: "string" },
      resources: { type: "string" },
      archive: { type: "string" },
      "7zip": { type: "string", default: "7z" },
      "sign-macos": { type: "boolean", default: false },
    },
  });
  const { target, output, archive } = values;
  assertPrivateOutput(output ?? "");
  const pin = CUA_RELEASE.targets[target];
  if (!pin) throw new Error("Require a supported --target and --output");
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
    if (process.platform === "darwin" && target.startsWith("darwin")) {
      await mkdir(extracted, { recursive: true });
      await run("ditto", ["-x", "-k", archive, extracted]);
    } else
      await run(
        values["7zip"],
        [
          "x",
          // 完整版 7-Zip 会先识别外层 PE；显式读取内嵌 7z，避免干净 runner 解不出组件。
          ...(target === "win32-x64" ? ["-t7z"] : []),
          "-y",
          `-o${extracted}`,
          archive,
          `${pin.resources}/glm/packages/node-repl-host/dist/mcp/server.js`,
          `${pin.resources}/tools/cua-helper/*`,
        ],
        {
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    resources = resolve(extracted, pin.resources);
  }
  if (!resources) throw new Error("Require --archive or --resources");
  console.log(
    await prepareCuaBundle({
      resources,
      output,
      target,
      signMacos: values["sign-macos"],
    }),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
