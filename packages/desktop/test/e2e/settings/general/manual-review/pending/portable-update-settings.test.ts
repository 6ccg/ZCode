import {
  TID_TASK_SETTINGS_BUTTON,
  TID_SETTINGS_BACK_BUTTON,
  TID_SETTINGS_SECTION_NAV,
  testId,
} from "@zcode/shared/test-ids";
import { clickTestIdByDom } from "#e2e/helpers/desktop-app";
import { skipOccupationOnboardingIfPresent } from "#e2e/helpers/occupation-onboarding";
import type { IPlatformService, PortableUpdateCommand } from "@zcode/shared";
import { createServer } from "node:http";
import { once } from "node:events";

async function request(command: PortableUpdateCommand) {
  const response = await browser.execute(async (value: PortableUpdateCommand) => {
    const bridge = (window as unknown as { zcode: IPlatformService }).zcode;
    // WebDriver 会把顶层 error 字段误判为协议错误，用信封保留应用原始状态供断言。
    return { state: await bridge.managePortableUpdate!(value) };
  }, command);
  return response.state;
}

describe("绿色版更新设置", () => {
  it("PU-03: 开启后自动读取 Release 清单，按平台选包并自动下载校验", async () => {
    await skipOccupationOnboardingIfPresent();
    const requests: string[] = [];
    const server = createServer((incoming, response) => {
      requests.push(incoming.url || "");
      if (incoming.url === "/package.zip") {
        response.end("incorrect package bytes");
        return;
      }
      if (incoming.url === "/build-info.json") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            builds: [
              { target: `${process.platform}-${process.arch}`, sourceCommit: "c".repeat(40) },
            ],
          }),
        );
        return;
      }
      const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
      const suffix =
        process.platform === "win32" ? `win-${process.arch}-portable` : `mac-${process.arch}`;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          tag_name: "v99.0.1-mod.1",
          target_commitish: "main",
          published_at: "2060-01-01T00:00:00Z",
          draft: false,
          prerelease: false,
          assets: [
            { name: "build-info.json", browser_download_url: `${origin}/build-info.json` },
            {
              name: "unrelated.zip",
              browser_download_url: `${origin}/wrong.zip`,
              digest: `sha256:${"1".repeat(64)}`,
            },
            {
              name: `ZCode-99.0.1-mod.1-${suffix}.zip`,
              browser_download_url: `${origin}/package.zip`,
              digest: `sha256:${"0".repeat(64)}`,
            },
          ],
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const previous = await request({ action: "status" });
    try {
      expect(previous.supported).toBe(true);
      const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
      await request({
        action: "configure",
        preferences: { source: `${origin}/release.json`, automatic: true, autoDownload: true },
      });
      await browser.waitUntil(async () => (await request({ action: "status" })).phase === "error", {
        timeout: 20_000,
      });
      expect((await request({ action: "status" })).error).toContain("SHA-256");
      expect(requests).toEqual(["/release.json", "/build-info.json", "/package.zip"]);
    } finally {
      await request({ action: "configure", preferences: previous.preferences });
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("PU-02: 真实更新请求不携带账号/Cookie，摘要失败不进入安装", async () => {
    await skipOccupationOnboardingIfPresent();
    const requests: Array<{ url: string; headers: import("node:http").IncomingHttpHeaders }> = [];
    const server = createServer((incoming, response) => {
      requests.push({ url: incoming.url || "", headers: incoming.headers });
      if (incoming.url === "/package.zip") {
        response.end("incorrect package bytes");
        return;
      }
      response.setHeader("content-type", "application/json");
      const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
      response.end(
        JSON.stringify({
          version: "99.0.0-mod.1",
          sourceCommit: "b".repeat(40),
          publishedAt: "2060-01-01T00:00:00Z",
          assets: {
            [`${process.platform}-${process.arch}`]: {
              url: `${origin}/package.zip`,
              sha256: "0".repeat(64),
            },
          },
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const previous = await request({ action: "status" });
    try {
      const origin = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
      await request({
        action: "configure",
        preferences: { source: `${origin}/latest.json`, automatic: false, autoDownload: false },
      });
      expect(requests.length).toBe(0);
      expect((await request({ action: "check" })).phase).toBe("available");
      const failed = await request({ action: "download" });
      expect(failed.phase).toBe("error");
      expect(failed.error).toContain("SHA-256");
      expect(requests.map((item) => item.url)).toEqual(["/latest.json", "/package.zip"]);
      for (const observed of requests) {
        expect(observed.headers.authorization).toBeUndefined();
        expect(observed.headers.cookie).toBeUndefined();
        expect(observed.headers["x-device-mid"]).toBeUndefined();
      }
    } finally {
      await request({ action: "configure", preferences: previous.preferences });
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("PU-01: 空来源不启用自动更新，保存来源后重开保持且不启动下载", async () => {
    await skipOccupationOnboardingIfPresent();
    const previous = await request({ action: "status" });
    try {
      await request({
        action: "configure",
        preferences: { source: "", automatic: false, autoDownload: false },
      });
      await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
      await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"));
      const source = await $('[data-testid="portable-update-source"]');
      await source.waitForDisplayed();
      await source.setValue("https://updates.example.test/latest.json");
      await $('[data-testid="portable-update-save"]').click();
      await browser.waitUntil(async () => {
        const state = await request({ action: "status" });
        return (
          state.preferences.source === "https://updates.example.test/latest.json" &&
          state.phase === "idle"
        );
      });
      const state = await request({ action: "status" });
      expect(state.preferences.automatic).toBe(false);
      expect(state.preferences.autoDownload).toBe(false);
      await clickTestIdByDom(TID_SETTINGS_BACK_BUTTON);
      await clickTestIdByDom(TID_TASK_SETTINGS_BUTTON);
      await clickTestIdByDom(testId(TID_SETTINGS_SECTION_NAV, "general"));
      await browser.waitUntil(
        async () =>
          (await $('[data-testid="portable-update-source"]').getValue()) ===
          "https://updates.example.test/latest.json",
      );
    } finally {
      await request({ action: "configure", preferences: previous.preferences });
    }
  });
});
