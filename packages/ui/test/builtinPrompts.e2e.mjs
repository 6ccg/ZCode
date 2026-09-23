import assert from "node:assert/strict";

/** 在隔离的 Web/Server 数据目录运行；page 由 Playwright 提供，不接触用户配置。 */
export async function verifyBuiltinPromptEditor(page) {
  const panel = page.getByTestId("builtin-prompts-settings");
  const editor = page.getByTestId("builtin-prompt-editor");
  const entry = (id) => page.getByTestId(`builtin-prompt-${id}`);
  const original = await editor.inputValue();
  const marker = "You are ZCode. BUILTIN_PROMPT_UI_MARKER";
  await editor.fill(marker);
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-testid="builtin-prompt-main.prefix"]')
      ?.textContent.includes("已修改"),
  );
  await entry("main.behavior").click();
  await entry("main.prefix").click();
  assert.equal(await editor.inputValue(), marker);

  await editor.fill("UNSAVED_DRAFT");
  await entry("main.behavior").click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^取消/ }).click();
  assert.equal(await editor.inputValue(), "UNSAVED_DRAFT");
  await page
    .getByRole("navigation", { name: "主要项" })
    .getByRole("button", { name: "外观", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /^取消/ }).click();
  assert.equal(await editor.inputValue(), "UNSAVED_DRAFT");
  await panel.getByRole("button", { name: "放弃修改", exact: true }).click();
  assert.equal(await editor.inputValue(), marker);

  await panel.getByRole("button", { name: "查看当前版本默认", exact: true }).click();
  assert.equal(await editor.inputValue(), original);
  assert.equal(await editor.getAttribute("readonly"), "");
  await panel.getByRole("button", { name: "返回编辑", exact: true }).click();
  assert.equal(await editor.inputValue(), marker);
  await entry("main.memory").click();
  await editor.fill("Missing runtime variable");
  assert.equal(await panel.getByRole("button", { name: "保存", exact: true }).isDisabled(), true);
  await panel.getByRole("button", { name: "放弃修改", exact: true }).click();
  await entry("main.prefix").click();

  await page.reload();
  // 隔离环境没有模型或账号，跳过登录的状态不会跨刷新保留。
  await page.getByTestId("login-use-api-key-button").click();
  await page.getByTestId("login-api-key-skip-button").click();
  const exitOnboarding = page.getByRole("button", { name: "退出引导" });
  await exitOnboarding
    .or(page.getByTestId("task-settings-button"))
    .first()
    .waitFor({ state: "visible" });
  if (await exitOnboarding.isVisible()) await exitOnboarding.click();
  const openSettings = page.getByTestId("task-settings-button");
  await openSettings.waitFor({ state: "visible" });
  if (await openSettings.isVisible()) await openSettings.click();
  await page
    .getByRole("navigation", { name: "主要项" })
    .getByRole("button", { name: "内置提示词", exact: true })
    .click();
  await editor.waitFor({ state: "visible" });
  assert.equal(await editor.inputValue(), marker);
  await panel.getByRole("button", { name: "恢复默认", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^恢复默认/ })
    .click();
  await page.waitForFunction(
    (text) => document.querySelector('[data-testid="builtin-prompt-editor"]')?.value === text,
    original,
  );
  return {
    saved: true,
    reopened: true,
    unsavedNavigationGuard: true,
    variablesValidated: true,
    defaultPreview: true,
    restored: true,
  };
}
