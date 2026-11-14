# Windows Computer Use 运行时

## 组件与进程

Windows Computer Use 使用随应用发布的 JavaScript runtime、Electron Node helper 和 `ax_native.node`。公开包 `@zcode/zcode-cua` 提供接口；本地 `WindowsCuaHelperHost` 持有原生进程、named pipe 和 authority。

产品模式从 `resources/tools/zcode-cua` 加载 SDK，从 `resources/tools/cua-helper` 加载 helper。只允许 desktop-local；远程 workspace identity、SSH/WSL/容器和手机 attachment 不创建此进程。支持的平台和版本由 [组件规格](../../specs/bundled-computer-use.md) 定义。

## 解析与资源契约

`windowsCuaDevRuntime` 唯一负责 helper 路径解析，不启动进程。构建/开发显式输入的优先级为 `ZCODE_CUA_HELPER_RUNTIME_PACKAGE_DIR` → `ZCODE_CUA_DEV_ROOT` → 产品资源目录。空白输入忽略；非空高优先级输入无效时直接失败。

输入支持 `@zcode/zcode-cua` 源码 producer 契约和 `@zcode/zcode-cua-helper-runtime` 预打包目录。前者通过 `package.json` 的 `zcodeCuaRuntime.windows` 声明 `entry` 与 `nativeAddon`；后者要求 `type: module`、`main` 与 manifest entry 一致、package version 与 manifest 一致。

产品资源包含 `runtime-manifest.json`、ESM `package.json`、helper entry、原生 addon，以及 Express、Sharp 的完整运行依赖。manifest schema 1 记录 package 身份和版本、平台架构、Electron 版本、entry/addon 相对路径与 SHA-256。

- 路径必须规范、相对且物理包含于资源根，拒绝符号链接、junction、父级路径及未知清单字段。
- platform、arch、Electron、哈希和 PE machine 必须匹配目标；x64 为 `0x8664`，arm64 为 `0xaa64`。校验支持某架构不代表已有该架构发布包。
- 版本来自组件本身，不通过改写清单使不匹配的二进制通过校验。
- resolver 区分 `development-source`、`development-prebuilt` 与 `packaged`；错误输入不回退到其他目录或下载。

## 准入与生命周期

```text
启用设置 + 本地主会话 → acquire 现有 Host → 检查 owner → host.start()
                      → 复核 owner → 向 MCP 提供 resolver
停止 / 禁用 / 替换 ──────────────────→ owner 失效
```

Agent spawn 只取得 Host 对象，不提前启动 helper。MCP 准备阶段确认设置、主会话和本地身份后启动进程；helper、health 与 Agent 共用 Host 的 socket/authority。SDK factory 捕获 authority，后续清理环境变量不影响认证。错误或缺失 authority 必须拒绝。

并发启动、停止排空、重启与 refresh-marker 归现有生命周期所有者管理。ready、health 和 broker_info 的 PID 必须对应实际 helper。停止完成后才允许重新启动，复用同一 Host transport。

准备失败只移除 CUA candidates，保留其他 MCP 的顺序与配置；显式 restart / restartAfterPermissionGrant 向调用方报告原始错误。关闭设置时不发现、不调用、不启动 helper。

## Broker 协议

公共适配器将参数交给组件 runtime，transport、认证、执行和 presentation 处理由 runtime 持有。无可用 runtime 时，纯解析和响应组装仍可使用，执行入口明确拒绝。

- 请求为非负安全整数 `id`、非空 `method` 和可选对象 `params`；缺省 params 归一化为 `{}`，null/数组非法。
- 解析成功返回 `{ ok: true, request }`；非法请求返回 `{ ok: false, id, code: "invalid_request", message }`，保留合法 ID，否则为 0。
- 成功响应为 `{ id, ok: true, result }`，空结果归一化为 null；可选 presentation 原样传递。
- 错误响应为 `{ id, ok: false, error: { code, message } }`，保留非空 details。异常带非空 code 时保留，其他异常为 `internal`。序列化以换行结束。

## 打包与验证

资源准备和 afterPack 均验证清单、路径、依赖闭包、目标与文件哈希。Windows 签名覆盖 `.node`/`.dll`；签名改变文件字节后，仅在验证固定契约及实际目标后刷新最终哈希，再严格复验。无证书构建可以生成未签名包，不能记为签名验收通过。

代码验证覆盖解析优先级、错误输入、broker 协议、并发生命周期和禁用行为。设备验收使用目标 Electron 和最终发布资源，验证 addon 加载、ready/health、认证拒绝、观察截图、专用窗口输入读回及停止重启。测试入口和发布命令集中在 [组件规格](../../specs/bundled-computer-use.md)，具体运行结果随 Release 保存。
