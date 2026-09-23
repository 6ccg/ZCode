import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import {
  BUILTIN_PROMPTS,
  renderBuiltinPrompt,
  validateBuiltinPrompt,
} from "../src/builtin-prompts/index.js";
import { buildIdentitySection } from "../../../apps/zcode-cli/packages/core/src/context/sections/identity.js";
import { buildExploreAgentPrompt } from "../../../apps/zcode-cli/packages/core/src/subagent/explore.js";
import { buildCompactPrompt } from "../../../apps/zcode-cli/packages/core/src/compact/prompt.js";
import { buildMemoryExtractionPrompt } from "../../../apps/zcode-cli/packages/core/src/memory/extraction.js";
import { ContextBuilder } from "../../../apps/zcode-cli/packages/core/src/context/builder.js";
import { buildCliPrefixSection } from "../../../apps/zcode-cli/packages/core/src/context/sections/cli-prefix.js";
import {
  buildDynamicBehaviorSection,
  buildContextManagementSection,
  buildSessionGuidanceSection,
} from "../../../apps/zcode-cli/packages/core/src/context/dynamic-sections.js";
import { buildDesktopContextSection } from "../../../apps/zcode-cli/packages/core/src/context/sections/desktop.js";
import { buildMemorySection } from "../../../apps/zcode-cli/packages/core/src/context/sections/memory.js";
import { buildGeneralPurposeSystemPrompt } from "../../../apps/zcode-cli/packages/core/src/subagent/general-purpose.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

test("default templates preserve upstream text and its conditional variants", () => {
  // 桌面段摘要从官方 v3.18.0 (b95ebaff) 采集，其余文案与 v3.17.1 相同。
  const cases: Array<[string, string]> = [
    [
      buildCliPrefixSection().content,
      "7779642ea44a46963bcdc9c151aa95d4761f17182929e41cb5bff571110af440",
    ],
    [
      buildDynamicBehaviorSection().content,
      "7d843753f3adae93ecc51e6fa2cb9b07bdc0c4b946bc3d2404f0a6db596bf5d0",
    ],
    [
      buildContextManagementSection().content,
      "406a0480d88086cdbb9eadbbcd63c4a95d370d4a89c20b753a4d96da90458b11",
    ],
    [
      buildSessionGuidanceSection(["Skill"], true)!.content,
      "6596a0131800c7792ce18e69cca60663537c8461198819dc3935946878553287",
    ],
    [
      buildDesktopContextSection().content,
      "39a1e86c93452c01ca5f7702f8e2e1bd9e49f254283397f39528506149eda10d",
    ],
    [
      buildMemorySection("/memory", "default-index")!.content,
      "1276dfda7bb5ebfdba02566f25bfa1d3d238f5453a9a13f9795e370e824c811a",
    ],
    [
      buildDesktopContextSection(true).content,
      "aa9364652d2f41ae16398df467537ada1f184e465c070d4b1deb82369b02e18e",
    ],
    [
      buildMemorySection("/memory", "semantic-recall")!.content,
      "6c5403c8959ca87b5ef6de8a366627ce6aab25f0b54b3bd637feb8dc4eb280d9",
    ],
    [
      buildGeneralPurposeSystemPrompt(),
      "ffb2fb874751980e38e256d3c654573794e6640a1ebca08a13ebc4190f1c04d9",
    ],
    [
      buildIdentitySection().content,
      "aac4ba4cc7b555b3a32704850028e242a6e3045df91d7970f04d18c378e57f40",
    ],
    [
      buildIdentitySection({ name: "test", prompt: "test" }).content,
      "b0df630cb67348a9824ec4402a992c72a5c17f58c0b18f4235e297ea294f7fb7",
    ],
    [
      buildExploreAgentPrompt({}),
      "3ff1ea6c7d1a3666454ce2df306eb6c52ca045da36b4de4973df46bce8de6ce8",
    ],
    [
      buildExploreAgentPrompt({ embeddedSearchEnabled: true }),
      "a16f91c103ccdc9e62fbc66e61c0026a3d0836cf87a43ecf368c53140c13a702",
    ],
    [
      buildCompactPrompt(undefined),
      "63e2bfb4ded280d5057a66d8a034ef352a73960d97d955b990e78f04f0db1fb0",
    ],
    [
      buildCompactPrompt("Keep tests"),
      "9d491630cbebc8da5b82d9d7d631b2e8bee9d8803ff3872dea84db589d6fb589",
    ],
    [
      buildMemoryExtractionPrompt({ messageCount: 5, manifest: [] }),
      "057f484de2d5793672b774147adf96f7c8bbb7c6ceb317ba7a376c9bb4759020",
    ],
    [
      renderBuiltinPrompt("auxiliary.title"),
      "d3d0746e09609cd62773e0df8957adbbb35199c7b214f27329513090cc431383",
    ],
    [
      renderBuiltinPrompt("auxiliary.gitCommit"),
      "979e059b34cde3c48381db1294ce14ef8908dbbf06bad2dfcefa09bb0b5ced32",
    ],
  ];
  for (const [text, expected] of cases) assert.equal(hash(text), expected);
  assert.equal(
    hash(buildIdentitySection(undefined, false).content),
    "00cdd3396071ffbf93bfb83c0d98923ba17564da7279617d68094d70fe1df5d7",
  );
  assert.equal(
    buildIdentitySection(undefined, false, { "main.identity": "Custom {{identity_intro}}" })
      .content,
    "Custom You are an agent working with the user toward their goals, using your own judgment along the way.",
  );
});

test("templates validate required variables and replace inserted data only once", () => {
  for (const item of BUILTIN_PROMPTS) validateBuiltinPrompt(item.id, item.template);
  assert.throws(
    () => validateBuiltinPrompt("main.memory", "missing variable"),
    /Required variable/,
  );
  assert.throws(() => validateBuiltinPrompt("auxiliary.title", "{{unknown}}"), /Unknown variable/);
  assert.doesNotThrow(() => validateBuiltinPrompt("auxiliary.title", 'Return {"title":"..."}'));
  assert.doesNotThrow(() => validateBuiltinPrompt("main.desktop", "Existing desktop override"));
  assert.doesNotThrow(() => validateBuiltinPrompt("main.memory", "Memory: {{memory_root}}"));
  assert.equal(
    renderBuiltinPrompt(
      "main.memory",
      { "main.memory": "Memory: {{memory_root}}" },
      { memory_root: "$& {{untouched}}" },
    ),
    "Memory: $& {{untouched}}",
  );
});

test("section overrides preserve dynamic context and explicit system prompt priority", () => {
  const config = {
    workingDirectory: "/project",
    envInfo: {
      cwd: "/project",
      platform: "linux",
      shell: "bash",
      osVersion: "test",
      nodeVersion: "24",
    },
    presentationSurface: "zcode_desktop" as const,
    genUiOutputDirectory: "/visuals",
    currentDate: "2026-09-22",
    memoryRoot: "/memory",
    builtinPromptOverrides: {
      "main.behavior": "BEHAVIOR_MARKER",
      "main.memory": "MEMORY_MARKER {{memory_root}}",
    },
  };
  const result = new ContextBuilder(config).build();
  assert.equal(
    result.sections.find((s) => s.source === "dynamic_behavior")?.content,
    "BEHAVIOR_MARKER",
  );
  assert.equal(
    result.sections.find((s) => s.source === "memory")?.content,
    "MEMORY_MARKER /memory",
  );
  assert.ok(result.sections.some((s) => s.source === "env_info" && s.content.includes("/project")));
  assert.ok(result.sections.some((s) => s.source === "desktop_context"));
  assert.ok(
    result.sections.some(
      (s) => s.source === "desktop_context" && s.content.includes("listed in the environment"),
    ),
  );
  assert.equal(
    result.sections.find((s) => s.source === "dynamic_behavior")?.chars,
    "BEHAVIOR_MARKER".length,
  );
  const custom = new ContextBuilder({ ...config, customSystemPrompt: "CUSTOM" }).build();
  assert.ok(custom.sections.some((s) => s.source === "custom_system_prompt"));
  assert.ok(!custom.sections.some((s) => s.content.includes("BEHAVIOR_MARKER")));
});
