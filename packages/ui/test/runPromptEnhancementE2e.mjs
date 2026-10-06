import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyPromptEnhancement } from "./promptEnhancement.e2e.mjs";

// 使用仓库现有 Vite 和 Playwright Core，浏览器路径可作为首个参数传入。
const webRequire = createRequire(new URL("../../web/package.json", import.meta.url));
const desktopRequire = createRequire(new URL("../../desktop/package.json", import.meta.url));
const { createServer } = await import(pathToFileURL(webRequire.resolve("vite")));
const { default: react } = await import(pathToFileURL(webRequire.resolve("@vitejs/plugin-react")));
const { default: tailwind } = await import(pathToFileURL(webRequire.resolve("@tailwindcss/vite")));
const { chromium } = desktopRequire("playwright-core");
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const uiSource = fileURLToPath(new URL("../src", import.meta.url));
const fixturePlugin = {
  name: "prompt-enhancement-fixture",
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url !== "/prompt-enhancement-fixture") return next();
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        await server.transformIndexHtml(
          request.url,
          '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/packages/ui/test/fixtures/promptEnhancementFixture.tsx"></script></body></html>',
        ),
      );
    });
  },
};
const server = await createServer({
  root: repoRoot,
  configFile: false,
  plugins: [fixturePlugin, react(), tailwind()],
  optimizeDeps: { entries: ["packages/ui/test/fixtures/promptEnhancementFixture.tsx"] },
  resolve: { alias: { "@": uiSource } },
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, executablePath: process.argv[2] || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(15_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error));
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}/prompt-enhancement-fixture`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.getByTestId("enhancement-draft").waitFor({ timeout: 60000 });
  const result = await verifyPromptEnhancement(page);
  if (errors.length) throw new AggregateError(errors, "Browser runtime errors");
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
}
