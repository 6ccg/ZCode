import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { build } from "esbuild";

const desktop = resolve(import.meta.dirname, "..");
const require = createRequire(join(desktop, "package.json"));
const asar = require("@electron/asar");
const { ZipFile } = require("yazl");
const windows = process.platform === "win32";
assert.ok(
  windows || process.platform === "darwin",
  "Native Electron acceptance requires Windows or Mac",
);
const evidenceRoot = join(desktop, ".e2e-artifacts");
await mkdir(evidenceRoot, { recursive: true });
const root = await mkdtemp(join(evidenceRoot, "portable-update-package-"));
const home = join(root, "home");
await mkdir(home, { recursive: true });
const value = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const packageVersion = JSON.parse(
  await readFile(resolve(desktop, "../../package.json"), "utf8"),
).version;
const actualArchive =
  value("--archive") ||
  (process.argv.includes("--packaged")
    ? join(
        desktop,
        "dist",
        `ZCode-${packageVersion}-${windows ? `win-${process.arch}-portable` : `mac-${process.arch}`}.zip`,
      )
    : undefined);
const commit = value("--commit") || process.env.GITHUB_SHA || "b".repeat(40);
const version = actualArchive ? packageVersion : "99.0.0";
let archive;
if (actualArchive) archive = resolve(actualArchive);
else {
  const input = join(root, "asar-input/out/metadata");
  await mkdir(input, { recursive: true });
  await writeFile(
    join(input, "build-meta.json"),
    JSON.stringify({ appVersion: version, buildCommitId: commit.slice(0, 8) }),
  );
  const asarPath = join(root, "app.asar");
  await asar.createPackage(join(root, "asar-input"), asarPath);
  const zip = new ZipFile();
  const prefix = windows ? "" : "ZCode.app/Contents/";
  zip.addFile(asarPath, `${prefix}${windows ? "resources" : "Resources"}/app.asar`);
  zip.addBuffer(
    Buffer.from("fixture program"),
    `${prefix}${windows ? "ZCode.exe" : "MacOS/ZCode"}`,
    { mode: 0o100755 },
  );
  zip.addBuffer(Buffer.from(windows ? "resources" : "Resources"), `${prefix}safe-link`, {
    mode: 0o120777,
    compress: false,
  });
  if (windows)
    zip.addBuffer(Buffer.from("ZCode.exe\r\nresources\\app.asar\r\n"), ".zcode-install-manifest");
  archive = join(root, "fixture.zip");
  const written = pipeline(zip.outputStream, createWriteStream(archive));
  zip.end();
  await written;
}
const unsafeZip = new ZipFile();
unsafeZip.addBuffer(Buffer.from("../outside"), "escape", { mode: 0o120777, compress: false });
unsafeZip.addBuffer(Buffer.from("must not escape"), "escape/private.txt");
const unsafeArchive = join(root, "unsafe.zip");
const unsafeWritten = pipeline(unsafeZip.outputStream, createWriteStream(unsafeArchive));
unsafeZip.end();
await unsafeWritten;
const modulePath = join(root, "installer.mjs");
await build({
  entryPoints: [join(desktop, "src/main/portable-updates/install.ts")],
  outfile: modulePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["node:original-fs", "yauzl"],
  logLevel: "silent",
});
const fixture = join(root, "main.cjs");
await writeFile(
  fixture,
  `
const assert = require('node:assert/strict');
const { app } = require('electron');
const fs = require('node:fs/promises');
const physical = require('original-fs').promises;
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const scenario = JSON.parse(process.env.ZCODE_PORTABLE_ACCEPTANCE);
app.setPath('userData', scenario.home);
app.whenReady().then(async () => {
  const { createPortableInstaller } = await import(${JSON.stringify(pathToFileURL(modulePath).href)});
  console.log('Electron ready; preparing isolated package fixture');
  const target = join(scenario.root, scenario.windows ? 'Program folder' : 'Installed.app');
  const resources = scenario.windows ? join(target, 'resources') : join(target, 'Contents/Resources');
  const executable = scenario.windows ? join(target, 'ZCode.exe') : join(target, 'Contents/MacOS/ZCode');
  await fs.mkdir(resources, { recursive: true });
  await fs.mkdir(require('node:path').dirname(executable), { recursive: true });
  await fs.writeFile(executable, 'original');
  await fs.writeFile(join(resources, 'marker.txt'), 'original');
  if (scenario.windows) await fs.writeFile(join(target, '.zcode-install-manifest'), 'ZCode.exe\\nresources\\\\marker.txt\\n');
  let protectedPaths = [scenario.home];
  const installer = createPortableInstaller({ platform: scenario.windows ? 'win32' : 'darwin', appRoot: target, executable, cacheDir: scenario.home, helpersDir: scenario.helpersDir, protectedPaths: async () => protectedPaths, onStage: stage => console.log('Installer: ' + stage) });
  const release = { version: scenario.version + '-mod.1', sourceCommit: scenario.commit };
  const plan = await installer.prepare(release, scenario.archive, new AbortController().signal);
  console.log('Package staged and identity verified');
  assert.ok(plan.managed.includes('resources') || !scenario.windows);
  if (scenario.actualArchive) {
    const helper = join(plan.staged, scenario.windows ? 'resources/portable-update/install.ps1' : 'Contents/Resources/portable-update/install.sh');
    await fs.access(helper);
    if (!scenario.windows) await require('node:util').promisify(require('node:child_process').execFile)('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(plan.staged, 'Contents/Resources/cua-helper/ZCode Computer Use.app')]);
  }
  await physical.rm(plan.workspace, { recursive: true, force: true });
  await assert.rejects(installer.prepare(release, scenario.unsafeArchive, new AbortController().signal), /ZIP/);
  await assert.rejects(installer.prepare({ ...release, sourceCommit: 'c'.repeat(40) }, scenario.archive, new AbortController().signal), /版本或源码提交/);
  protectedPaths = [resources];
  await assert.rejects(installer.prepare(release, scenario.archive, new AbortController().signal), /数据目录/);
  assert.equal(await fs.readFile(executable, 'utf8'), 'original');
  assert.equal(await fs.readFile(join(resources, 'marker.txt'), 'utf8'), 'original');
  assert.equal((await fs.readdir(scenario.windows ? target : scenario.root)).filter(name => name.startsWith('.zcode-update-')).length, 0);
  console.log('PASS Electron staging, real ASAR identity, protected data and failed-stage cleanup');
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
`,
);
const env = {
  ...process.env,
  ZCODE_PORTABLE_ACCEPTANCE: JSON.stringify({
    root,
    home,
    windows,
    archive,
    unsafeArchive,
    version,
    commit,
    actualArchive: Boolean(actualArchive),
    helpersDir: join(desktop, "resources/portable-update"),
  }),
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require("electron"), ["--no-sandbox", "--disable-gpu", fixture], {
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  output += chunk;
  process.stderr.write(chunk);
});
const exitCode = await new Promise((resolveExit, reject) => {
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error("Portable package smoke timed out"));
  }, 120_000);
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolveExit(code);
  });
});
await writeFile(join(root, "runtime.log"), output);
if (exitCode !== 0)
  throw new Error(`Portable package acceptance failed (${exitCode})\n${output.slice(-6000)}`);
console.log(output.trim());
console.log(`Evidence: ${root}`);
await rm(join(root, "asar-input"), { recursive: true, force: true });
