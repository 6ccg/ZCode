import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  copyFile,
  chmod,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import windowsHelper from "../resources/portable-update/install.ps1?raw";
import macHelper from "../resources/portable-update/install.sh?raw";

const temporary: string[] = [];
const run = promisify(execFile);
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "zcode-portable-update-"));
  temporary.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

describe("绿色目录原生替换与恢复", () => {
  it.skipIf(!["win32", "darwin"].includes(process.platform)).each([false, true])(
    "实际 helper 处理故障=%s，并保留自有文件",
    async (failure) => {
      const root = await directory();
      const windows = process.platform === "win32";
      const target = join(root, windows ? "Program's folder" : "Current's app.app");
      const workspace = windows
        ? join(target, ".zcode-update-fixture")
        : join(root, ".zcode-update-fixture");
      const staged = join(workspace, "extracted", ...(windows ? [] : ["ZCode.app"]));
      const programDir = (app: string) => (windows ? app : join(app, "Contents/MacOS"));
      const resourceDir = (app: string) =>
        windows ? join(app, "resources") : join(app, "Contents/Resources");
      for (const [app, version] of [
        [target, "old"],
        [staged, "new"],
      ]) {
        await mkdir(programDir(app), { recursive: true });
        await mkdir(resourceDir(app), { recursive: true });
        await writeFile(join(resourceDir(app), "version.txt"), version);
      }
      const executable = windows ? "ZCode.exe" : "ZCode";
      const oldExecutable = join(programDir(target), executable);
      if (windows) {
        const code =
          'using System; using System.IO; public class Program { [STAThread] public static void Main() { string b=AppDomain.CurrentDomain.BaseDirectory; File.WriteAllText(Path.Combine(b,"launched.txt"),File.ReadAllText(Path.Combine(b,"resources","version.txt"))); } }';
        await run("powershell.exe", [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Add-Type -TypeDefinition '${code}' -OutputAssembly '${oldExecutable.replaceAll("'", "''")}' -OutputType WindowsApplication`,
        ]);
      } else {
        const source = join(root, "launcher.c");
        await writeFile(
          source,
          '#include <stdio.h>\n#include <unistd.h>\n#include <libgen.h>\nint main(int argc,char**argv){chdir(dirname(argv[0]));FILE*f=fopen("../Resources/version.txt","r");char value[8]={0};fread(value,1,7,f);fclose(f);f=fopen("launched.txt","w");fputs(value,f);fclose(f);return 0;}',
        );
        await run("/usr/bin/cc", [source, "-o", oldExecutable]);
        for (const app of [target, staged])
          await writeFile(
            join(app, "Contents/Info.plist"),
            '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.zcode.update.fixture</string><key>CFBundleExecutable</key><string>ZCode</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
          );
      }
      await copyFile(oldExecutable, join(programDir(staged), executable));
      if (!windows) await chmod(join(programDir(staged), executable), 0o755);
      const note = join(windows ? target : root, "my-notes.txt");
      await writeFile(note, "keep");
      const outside = join(root, "user-data");
      await mkdir(outside);
      await writeFile(join(outside, "private.txt"), "keep");
      if (windows) await symlink(outside, join(resourceDir(target), "user-link"), "junction");
      if (failure) {
        if (windows) await writeFile(join(staged, executable), "invalid executable");
        else await rm(staged, { recursive: true });
      }
      const extension = windows ? "ps1" : "sh";
      const helper = join(root, `helper.${extension}`);
      await writeFile(helper, windows ? windowsHelper : macHelper, "utf8");
      const resultFile = join(root, "result.json");
      const ready = join(root, "ready");
      const planPath = join(root, "plan.json");
      const backup = join(workspace, "backup");
      await writeFile(
        planPath,
        JSON.stringify({
          target,
          workspace,
          staged,
          backup,
          resultFile,
          executable,
          managed: ["resources", executable],
          ready,
          parentPid: 2147483000,
        }),
      );
      const command = windows ? "powershell.exe" : "/bin/sh";
      const args = windows
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
            "2147483000",
            staged,
            target,
            backup,
            resultFile,
            ready,
            workspace,
            helper,
            planPath,
          ];
      const result = await run(command, args, { windowsHide: true, timeout: 20_000 }).then(
        () => ({ success: true, details: "" }),
        (error) => ({ success: false, details: String(error.stderr || error) }),
      );
      expect(result.success, result.details).toBe(!failure);
      expect(await readFile(note, "utf8")).toBe("keep");
      expect(await readFile(join(outside, "private.txt"), "utf8")).toBe("keep");
      expect(await readFile(join(resourceDir(target), "version.txt"), "utf8")).toBe(
        failure ? "old" : "new",
      );
      await vi
        .waitFor(
          async () =>
            expect(await readFile(join(programDir(target), "launched.txt"), "utf8")).toBe(
              failure ? "old" : "new",
            ),
          { timeout: 5_000 },
        )
        .catch((error) => {
          throw new Error(`${result.details}\n${String(error)}`);
        });
      const resultState = JSON.parse(await readFile(resultFile, "utf8"));
      expect(Boolean(resultState.error)).toBe(failure);
    },
    30_000,
  );
});
