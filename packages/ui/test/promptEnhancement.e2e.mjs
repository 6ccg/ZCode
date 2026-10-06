import assert from "node:assert/strict";

/** 使用 fixtures/promptEnhancementFixture.tsx 和隔离浏览器上下文；不访问账号、模型端点或用户文件。 */
export async function verifyPromptEnhancement(page) {
  const organize = page.getByTestId("prompt-enhancement-organize");
  const expand = page.getByTestId("prompt-enhancement-expand");
  const draft = page.getByTestId("enhancement-draft");
  const setDraft = async (text) => {
    await page.evaluate((value) => window.promptEnhancementFixture.setDraft(value), text);
  };
  const finish = async () => {
    await page.evaluate(() => window.promptEnhancementFixture.finish());
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-testid^="prompt-enhancement-"][aria-busy]')].every(
        (button) => button.getAttribute("aria-busy") === "false",
      ),
    );
  };
  const requestCount = () => page.evaluate(() => window.promptEnhancementFixture.requests.length);
  const start = async (button) => {
    const previous = await requestCount();
    await button.click();
    await page.waitForFunction(
      (count) => window.promptEnhancementFixture.requests.length === count + 1,
      previous,
    );
  };
  const expectDraft = (text) =>
    page.waitForFunction(
      (value) => document.querySelector('[data-testid="enhancement-draft"]').textContent === value,
      text,
    );

  await setDraft("先分析，不改代码");
  assert.equal(await organize.getAttribute("aria-label"), "整理表达");
  assert.equal(await expand.getAttribute("aria-label"), "补全需求");
  await start(organize);
  await finish();
  await expectDraft("organize: 先分析，不改代码");
  assert.match(await organize.getAttribute("aria-label"), /撤销/);
  await start(expand);
  await finish();
  await expectDraft("expand: organize: 先分析，不改代码");
  assert.equal(await organize.getAttribute("aria-label"), "整理表达");
  await expand.click();
  await expectDraft("organize: 先分析，不改代码");
  assert.equal(await expand.getAttribute("aria-label"), "补全需求");

  await start(organize);
  await organize.click();
  await page.waitForFunction(() => window.promptEnhancementFixture.cancelled.length === 1);
  await finish();
  assert.equal(await draft.textContent(), "organize: 先分析，不改代码");
  assert.equal(await organize.getAttribute("aria-label"), "整理表达");

  await start(expand);
  await draft.fill("用户新改稿");
  await finish();
  await page.getByTestId("prompt-enhancement-feedback").waitFor();
  assert.equal(await draft.textContent(), "用户新改稿");
  await page.getByRole("button", { name: "查看结果", exact: true }).click();
  assert.match(
    await page.getByRole("dialog").getByRole("textbox").inputValue(),
    /expand: organize:/,
  );
  await page.keyboard.press("Escape");

  await start(organize);
  await page.getByTestId("enhancement-change-reference").click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="enhancement-change-reference"]')
        .getAttribute("data-reference") === "reference-b",
  );
  await finish();
  assert.equal(await draft.textContent(), "用户新改稿");
  await start(expand);
  await page.getByTestId("enhancement-change-scope").click();
  await page.waitForFunction(() => window.promptEnhancementFixture.cancelled.length === 2);
  await finish();
  assert.equal(await draft.textContent(), "用户新改稿");

  await start(organize);
  await page.evaluate(() => window.promptEnhancementFixture.fail());
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="prompt-enhancement-feedback"]')
      ?.textContent.includes("model failed"),
  );
  assert.equal(await draft.textContent(), "用户新改稿");
  await start(organize);
  await page.getByTestId("enhancement-send").click();
  await page.waitForFunction(() => window.promptEnhancementFixture.cancelled.length === 3);
  await finish();
  assert.equal(await organize.getAttribute("aria-label"), "整理表达");

  await expand.click({ button: "right" });
  await page.getByRole("menuitem", { name: /提示词增强设置/ }).click();
  const panel = page.getByTestId("builtin-prompts-settings");
  const editor = page.getByTestId("builtin-prompt-editor");
  await editor.waitFor();
  assert.equal(
    await page.getByTestId("enhancement-prompt-expand").getAttribute("data-state"),
    "active",
  );
  const original = await editor.inputValue();
  await editor.fill("E2E_ENHANCEMENT_SYSTEM");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("enhancement-prompts"))["auxiliary.promptExpand.system"] ===
      "E2E_ENHANCEMENT_SYSTEM",
  );
  await editor.fill("UNSAVED");
  await page.getByTestId("enhancement-prompt-organize").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^取消/ })
    .click();
  assert.equal(await editor.inputValue(), "UNSAVED");
  await panel.getByRole("button", { name: "放弃修改", exact: true }).click();

  await page.getByTestId("enhancement-model-select").click();
  await page.getByRole("menuitem", { name: "Example", exact: true }).hover();
  await page.getByRole("menuitemradio", { name: "dedicated", exact: true }).click();
  await page.getByTestId("enhancement-reasoning-select").click();
  await page.getByRole("option", { name: "high", exact: true }).click();
  await start(expand);
  const generated = await page.evaluate(
    () => window.promptEnhancementFixture.requests.at(-1).request,
  );
  assert.deepEqual(generated.selection, {
    providerId: "example",
    modelId: "dedicated",
    options: { reasoningLevel: "high" },
  });
  assert.equal(generated.templates.system, "E2E_ENHANCEMENT_SYSTEM");
  await finish();

  await page.reload();
  await setDraft("刷新后草稿");
  await expand.click({ button: "right" });
  await page.getByRole("menuitem", { name: /提示词增强设置/ }).click();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "E2E_ENHANCEMENT_SYSTEM");
  assert.match(await page.getByTestId("enhancement-model-select").textContent(), /dedicated/);
  await panel.getByRole("button", { name: "恢复默认", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^恢复默认/ })
    .click();
  await page.waitForFunction(
    (value) => document.querySelector('[data-testid="builtin-prompt-editor"]').value === value,
    original,
  );
  return {
    transformAndUndo: true,
    stop: true,
    changedDraftAndReferences: true,
    scopeAndSendCancellation: true,
    modelFailure: true,
    rightClickSettings: true,
    unsavedGuard: true,
    modelAndPromptPersistence: true,
    restoreDefault: true,
  };
}
