import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
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
  // 在移动文案前从基线实现采集摘要，防止重构时丢失换行、条件分支或插值。
  const cases: Array<[string, string]> = [
    [
      buildCliPrefixSection().content,
      "46dd360a22c87a92dfdf29ae2c3011b0f9a014209a7b607f8fcd17a920e5eafa",
    ],
    [
      buildDynamicBehaviorSection().content,
      "bbdc66b399d297fff35df404921dcbd9056ed8892cd0fa6f35762345115225af",
    ],
    [
      buildContextManagementSection().content,
      "1732b7f098a925d7cee667d6aa722d3ff6aaf83cda240dc43ad4f98503c142bb",
    ],
    [
      buildSessionGuidanceSection(["Skill"], true)!.content,
      "e25def8de220f128c6feb186b283696246ffa34f6385b74de4307bd4d50a3f00",
    ],
    [
      buildDesktopContextSection().content,
      "39a1e86c93452c01ca5f7702f8e2e1bd9e49f254283397f39528506149eda10d",
    ],
    [
      buildMemorySection("/memory")!.content,
      "568ded18e6d347de108e5e27865be673c8293ca703d9b53ced7f90248c29d64f",
    ],
    [
      buildGeneralPurposeSystemPrompt(),
      "ffb2fb874751980e38e256d3c654573794e6640a1ebca08a13ebc4190f1c04d9",
    ],
    [
      buildIdentitySection().content,
      "3f21ff9a88a03a76cc765f1aa01eb6e9d645c5f44a0c80acf923b11bf2a7b92b",
    ],
    [
      buildIdentitySection({ name: "test", prompt: "test" }).content,
      "ab991b9062e1b4e13281edfa503d3c83b5cc6d0806dff17cdc671dba78686d2e",
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
      "55bf8287d1f1e9d1130d32718432cbfab61ec0e47812e1a5cfd1736eb924f64f",
    ],
    [
      buildCompactPrompt("Keep tests"),
      "5df7018b3bd452328e60ed5f1a79bc21233171d3cad617317ea4ab5945068563",
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
});

test("templates validate required variables and replace inserted data only once", () => {
  for (const item of BUILTIN_PROMPTS) validateBuiltinPrompt(item.id, item.template);
  assert.throws(
    () => validateBuiltinPrompt("main.memory", "missing variable"),
    /Required variable/,
  );
  assert.throws(() => validateBuiltinPrompt("auxiliary.title", "{{unknown}}"), /Unknown variable/);
  assert.doesNotThrow(() => validateBuiltinPrompt("auxiliary.title", 'Return {"title":"..."}'));
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
  assert.equal(
    result.sections.find((s) => s.source === "dynamic_behavior")?.chars,
    "BEHAVIOR_MARKER".length,
  );
  const custom = new ContextBuilder({ ...config, customSystemPrompt: "CUSTOM" }).build();
  assert.ok(custom.sections.some((s) => s.source === "custom_system_prompt"));
  assert.ok(!custom.sections.some((s) => s.content.includes("BEHAVIOR_MARKER")));
});
