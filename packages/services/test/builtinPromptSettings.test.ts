import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSettingService } from "../src/setting/settingService.js";
import { BUILTIN_PROMPT_FILE_NAME } from "@zcode/shared/builtin-prompts";
import { createNodeBuiltinPromptSource } from "../../../apps/zcode-cli/packages/adapters/src/context/builtin-prompts.js";
import { GitCommitMessageGenerator } from "../src/git/gitCommitMessageGenerator.js";

test("prompt sidecar merges entries without touching original settings", async () => {
  const home = await mkdtemp(join(tmpdir(), "zcode-prompts-"));
  const previous = process.env.ZCODE_DESKTOP_HOME_DIR;
  process.env.ZCODE_DESKTOP_HOME_DIR = home;
  try {
    const first = createSettingService();
    const second = createSettingService();
    await first.update({ locale: "en-US" });
    const settingsPath = join(home, ".zcode", "v2", "setting.json");
    const originalSettings = await readFile(settingsPath, "utf8");
    await Promise.all([
      first.setBuiltinPrompt("main.behavior", "BEHAVIOR"),
      second.setBuiltinPrompt("auxiliary.title", "TITLE"),
    ]);
    assert.equal(await readFile(settingsPath, "utf8"), originalSettings);
    assert.deepEqual(await second.getBuiltinPrompts(), {
      "main.behavior": "BEHAVIOR",
      "auxiliary.title": "TITLE",
    });
    const source = createNodeBuiltinPromptSource({ env: { ZCODE_DESKTOP_HOME_DIR: home } });
    assert.deepEqual(await source.readOverrides(), await second.getBuiltinPrompts());
    await second.setBuiltinPrompt("main.behavior", null);
    assert.deepEqual(await source.readOverrides(), { "auxiliary.title": "TITLE" });
    await assert.rejects(
      first.setBuiltinPrompt("main.memory", "missing variable"),
      /Required variable/,
    );
    assert.equal(await readFile(settingsPath, "utf8"), originalSettings);
    const sidecar = JSON.parse(
      await readFile(join(home, ".zcode", "v2", BUILTIN_PROMPT_FILE_NAME), "utf8"),
    );
    assert.equal(sidecar.schemaVersion, 1);
    assert.deepEqual(sidecar.overrides, { "auxiliary.title": "TITLE" });
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DESKTOP_HOME_DIR;
    else process.env.ZCODE_DESKTOP_HOME_DIR = previous;
    await rm(home, { recursive: true, force: true });
  }
});

test("Git uses the latest prompt without changing dynamic inputs or output validation", async () => {
  let template = "GIT_MARKER";
  let output = "feat: add prompt settings";
  let sent = "";
  const generator = new GitCommitMessageGenerator({
    builtinPromptSource: {
      async readOverrides() {
        return { "auxiliary.gitCommit": template };
      },
    },
    currentModelProvider: {
      async readCurrentModel() {
        return { providerId: "test", modelId: "model" };
      },
    },
    textGenerator: {
      async generateText(input) {
        sent = input.prompt;
        return { text: output, selection: input.selection };
      },
    },
  });
  const input = {
    workspacePath: "/project",
    branchName: "main",
    locale: "en-US" as const,
    files: [],
    diffs: [],
  };
  assert.equal((await generator.generate(input)).message, output);
  assert.ok(sent.startsWith("GIT_MARKER\n"));
  assert.ok(sent.includes("Current branch: main"));
  template = "NEXT_MARKER";
  await generator.generate(input);
  assert.ok(sent.startsWith("NEXT_MARKER\n"));
  output = "This is not a commit message";
  await assert.rejects(generator.generate(input), /Conventional Commit/);
});
