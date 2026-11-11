# Computer Use 组件升级方法

CUA 随应用整体升级。公开仓库维护接口、桥接和构建工具；闭源 JavaScript、原生二进制、下载归档及解包目录放在仓库外。组件目标为 Windows x64 和 macOS arm64，版本值以 `scripts/bundled-cua.mjs` 的 `CUA_RELEASE` 为准。

## 1. 确定组件版本与原始输入

先将功能提交 rebase 到目标 ZCode 源码版本，再取得与之匹配的官方 Windows 发行包。检查根 `package.json` 的应用版本、`packages/zcode-cua/package.json` 的接口版本以及发行包的 Electron/helper 版本；版本接近不能代替兼容验证。

当前归档地址形式为：

```text
https://cdn-zcode.z.ai/zcode/electron/releases/<version>/windows-x64/ZCode-<version>-win-x64.exe
```

升级时从官方发布入口确认实际地址及发布校验值；地址结构发生变化时更新下载逻辑。先校验完整归档，再计算 SHA-256，不能只把下载文件的新哈希填进清单就视为可信。

解包后定位两个输入：

| 输入            | 当前归档内位置                                             | 用途                                             |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| SDK 所在 bundle | `resources/glm/packages/node-repl-host/dist/mcp/server.js` | 提取 CUA JavaScript 实现及 bundler 前导          |
| Windows helper  | `resources/tools/cua-helper/`                              | 保留 helper、原生 addon、运行依赖和原始 manifest |

读取 helper 的 `runtime-manifest.json`，核对 `packageVersion`、`electronVersion`、platform/arch、entry/addon 路径及文件哈希。计算原始 `server.js`、helper entry 和 addon 的 SHA-256。`CUA_RELEASE` 的 `version`、`cuaVersion`、`electronVersion`、`serverSha256` 及 target 下的归档/entry/addon 哈希均来自这些未修改输入。归档布局改变时同时更新资源路径。

## 2. 检查并适配 JavaScript 接口

`extractRuntime` 从当前 bundle 提取 CUA 段，当前边界为：

```text
起点：// ../../../../packages/zcode-cua/dist/index.js
终点：// ../../../../packages/shared/src/browser-use/command-metadata.ts
```

bundler 前导取自同一份输入，位于第一个 `// ../../../../node_modules/` 标记之前。边界或打包结构改变时，重新检查依赖再调整提取逻辑；不要扩大范围到整个 Agent、登录或插件市场实现。

`scripts/cua-runtime-adapter/` 将私有实现接到公开接口。`collectRuntimeExports` 从桥接模块对 `./vendor/dist-index.js` 的具名 import/export 自动生成导出清单；`collectRuntimeCalls` 从公开包的 `externalWindowsCuaFunction(entry, name)` 收集实际调用。组件生成时加载全部公共导出并检查调用目标是函数。

升级时对照公共 `.d.ts`、调用方与新实现，检查参数、返回结构、broker 消息和错误语义。导出名称存在只能证明模块可加载，不能证明接口行为兼容。当前本地路径不使用 HTTP transport，Express 只作为可选宿主依赖；若新版本改变依赖方式，应修改组件依赖处理并验证完整闭包。

## 3. 保持组件行为

构建工具中的源码适配有明确目标，升级时逐项核对新实现：

- **整体更新**：`stageDownloadedHelperApp`、`defaultDownloadFile` 和安装计划只能使用随包资源；缺失时明确失败，不回退下载或其他安装版本。
- **Host 认证**：`patchWindowsHelper` 在 `handleAuthenticate` 校验 Host 的 `pluginAuthority`。当前输入包含暂时开放 peer 校验的逻辑，所以不能直接采用其开放状态。新版若重做认证，按实际协议重新接入，同时验证错误凭据被拒绝。
- **凭据生命周期**：SDK factory/BrokerClient 在创建时捕获 authority，并在 broker 认证请求中使用；plugin host 清理环境变量后仍须正常工作。
- **本地生命周期**：现有 Host 管理进程和 transport；Agent spawn 不提前启动 helper，MCP 准备在设置启用并完成本地主会话准入后启动。
- **隐私**：检查新增可执行的网络入口、默认端点及远程加载。按产品规则阻断默认遥测、独立组件更新及关闭状态下的调用；用户配置的模型 API 正常传输保留。原生二进制的内部行为不能仅靠 JavaScript 检查作出结论。

`replaceOnce` 要求目标唯一，`replaceFunctionBody` 使用 AST 定位函数体。匹配失败表示需要检查新版本代码，不能删除断言或忽略错误继续打包。新增接口适配要补最小回归用例；测试材料使用合成数据，私有源码不进入 Git。

## 4. 生成并集成组件

更新 `CUA_RELEASE` 和与新版接口对应的桥接代码后，使用新的私有输出目录：

```powershell
node scripts/bundled-cua.mjs --target win32-x64 --archive D:/private/cua/ZCode-<version>-win-x64.exe --output D:/private/cua/<version>-win32-x64 --7zip 7z
$env:ZCODE_CUA_BUNDLE_DIR = 'D:/private/cua/<version>-win32-x64'
pnpm bundle:desktop -- --os win --arch x64
```

将示例占位符替换为目标版本。归档存在时直接校验；缺失时脚本按固定来源下载并校验。输出目录已存在时会拒绝写入。输出包含 `runtime/`、`helper/`、`bundle-manifest.json` 和桥接许可说明。

构建器核对应用和接口版本，校验原始哈希，生成 SDK、适配 helper 后记录输出哈希。资源准备和 afterPack 还会检查平台、Electron、PE 架构、依赖及最终文件哈希；不得改写版本来绕过不匹配。

## 5. 验证与发布

```powershell
node --test scripts/test/bundled-cua.test.mjs
pnpm --filter @zcode/zcode-cua test:source
pnpm test:engineering packages/desktop/test/placeholderProducerDetection.test.ts packages/desktop/test/windowsCuaPrebuiltRuntime.test.ts packages/desktop/test/sharpComputerUseRequirement.test.ts
pnpm typecheck
pnpm lint
pnpm architecture:check --changed
pnpm exec tsx scripts/test/bundled-cua-windows-smoke.mts D:/private/release/win-unpacked/resources
```

最后一条必须在 Windows 上针对最终解包产物执行，验证真实 addon/Host 的启动、认证和 health。另用专用测试窗口通过实际 Node REPL MCP 验证观察、截图、输入读回和重启，并确认默认关闭及关闭后旧会话不能继续调用。工程夹具和模块导入通过不等于设备验收通过。

发布时核对包内提交号、组件清单及附件 SHA-256；记录实际执行结果和未完成项到 Release。源码中只保留当前契约及本指南。私有资源不提交 Git；历史 Release 标签继续指向实际构建源码。后续 rebase 保留一个完整的 CUA 功能提交，升级修正合入该功能，按新版本重新构建应用。

`.github/workflows/portable-release.yml` 在主线推送后自动构建 Windows x64 和 Mac arm64 的 ZIP，也支持手动触发。Actions 附件中的 `build-info-<target>.json` 来自最终包内的 build metadata，并记录官方组件输入和 ZIP 校验值。发布时等待两端成功，下载对应 run 的附件，核对提交与哈希后上传 Release；不要混用不同提交的产物。

## macOS 组件分析与适配差异

Mac 的 SDK 位于归档的 `ZCode.app/Contents/Resources/glm/packages/node-repl-host/dist/mcp/server.js`。先比较它与已适配 SDK 的输入哈希，再检查导出及调用契约；不能仅因应用版本相同就假定字节或行为一致。

helper 位于 `ZCode.app/Contents/Resources/cua-helper/ZCode Computer Use.app`，由 `Contents/MacOS/ZCode Computer Use` 的 Node SEA 可执行文件、`Contents/Resources/ax_native.node` 和图像依赖组成。插件侧还有独立的原生依赖，必须按目标架构一并检查。

静态追踪按以下顺序执行：

1. 核对发布 manifest、归档及组件哈希，读取主应用和 helper 的 Info.plist。主应用、helper 与 addon 的平台要求分别核对。
2. 解析 Mach-O load commands、依赖库和未定义符号。当前 SEA 的 JavaScript 在 `NODE_SEA / __NODE_SEA_BLOB` 中；按嵌入长度字段提取完整 UTF-8 源码，再做语法检查。不能用 ASCII 字符串片段代替完整源码，中文注释会使这种提取方式截断。
3. 检查 SDK/helper 的真实网络调用、下载入口、遥测回调接线及子进程命令。Node、图像库的通用网络符号、文件 URL 和签名证书地址本身不构成上报证据。
4. 追踪 helper 的 `main` → launcher 校验 → `createPeerVerifier` → `handleAuthenticate`，并单独检查 `isPresentationPeerEligible`。当前实现校验同 UID、签名团队和进程归属；修改版的签名策略需要与 Host 准入同时适配，不能只改 broker 版本号或全局启用开发模式。
5. SDK、公开加载入口、Host、helper 暂存与 afterPack 必须同时支持 darwin。公开加载入口共用容器校验，Mac bridge 通过 LaunchServices 启动随包 helper，macOS 构建要求组件已重新签名。SDK 可加载和打包通过仍不能代替原生验收。

修改 SEA 字节会使原签名失效，需要在 macOS 上重新签名和验签。保留系统正常的辅助功能、屏幕录制授权流程；不修改 TCC 数据库或依赖用户全局环境变量。组件仍只随整个应用更新。

在 macOS arm64 上生成及验收组件：

```sh
node scripts/bundled-cua.mjs --target darwin-arm64 --archive /private/cua/ZCode-3.18.0-mac-arm64.zip --output /private/cua/bundle --sign-macos
node scripts/test/bundled-cua-macos-smoke.mjs /private/cua/bundle
ZCODE_CUA_BUNDLE_DIR=/private/cua/bundle pnpm bundle:desktop -- --os mac --arch arm64
```

当前私有组件保持同 UID 的本地 peer 检查，并在 broker authenticate 约束 Host authority；仅 helper 内嵌策略允许自构建签名，不将整个 SDK 变成开发模式。Host 使用 LaunchServices 为这次 helper 启动注入凭据，SDK、health 和 PiP 共用同一 admission transport。

Mac 发布验收须在 macOS 上执行：最终应用与 helper 的签名/启动、错误连接方拒绝、权限未授予时的失败行为、用户正常授权后的观察/截图/输入、PiP、禁用与停止重启。网络审计同时覆盖 SDK 和原生 helper，并用本机连接作正向对照。Windows 上的静态检查或跨平台打包不能代替这些运行证据。
