import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPromptEnhancementMessages,
  getPromptEnhancementTemplates,
  restorePromptEnhancementContent,
} from "../src/prompt-enhancement.js";

test("enhancement keeps roles separate and interpolates draft data only once", () => {
  const instruction = "只分析，不改代码。$& {{context}}";
  const messages = buildPromptEnhancementMessages({
    mode: "organize",
    selection: { providerId: "example", modelId: "text-model" },
    instruction,
    protectedContent: [],
    context: "上一步确认先找原因。",
    templates: {
      system: "SYSTEM_MARKER",
      user: "INPUT={{input}}\nCONTEXT={{context}}",
    },
  });
  assert.equal(messages[0]?.role, "system");
  assert.equal(messages[0]?.content, "SYSTEM_MARKER");
  assert.equal(messages[1]?.role, "user");
  assert.ok(messages[1]?.content.includes(JSON.stringify({ instruction, protectedContent: [] })));
  assert.ok(messages[1]?.content.includes("{{context}}"));
  assert.ok(messages[1]?.content.includes("上一步确认先找原因。"));
  assert.notEqual(
    getPromptEnhancementTemplates("organize").system,
    getPromptEnhancementTemplates("expand").system,
  );
});

test("protected content must survive exactly once before an enhancement can be applied", () => {
  const token = "[[ZCODE_KEEP_test_0]]";
  const code = "```ts\nconst value = 'a  b';\n```";
  const content = [{ token, content: code }];
  assert.equal(restorePromptEnhancementContent(`请检查：\n${token}`, content), `请检查：\n${code}`);
  assert.throws(() => restorePromptEnhancementContent("请检查代码。", content), /protected/i);
  assert.throws(() => restorePromptEnhancementContent(`${token}\n${token}`, content), /protected/i);
});
