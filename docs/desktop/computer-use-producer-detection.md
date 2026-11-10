# Computer Use producer 检测

## 规则

Computer Use 的真实实现来自 workspace 包 `@zcode/zcode-cua`（producer）。开源导出用 `packages/zcode-cua`
占位包替换它，占位包在 `package.json` 声明 `zcodeCuaPlaceholder: true`，所有能力 fail-closed。

本文下表描述没有私有 payload 时的默认路径。固定随包 CUA 是显式例外：构建者提供
`ZCODE_CUA_BUNDLE_DIR` 后，`configureBundledComputerUse` 验证版本/目标/哈希并接入资源；
这不会把公开适配包冒充为真实 producer。Windows 暂存 helper、JS runtime、Sharp 和必要原生依赖。完整契约见
[随包 CUA 规格](../../specs/bundled-computer-use.md)。用户安装后不需要这些构建变量。

占位包保留公共 `build` 和 `tsconfig.json` 入口，构建只检查随包类型声明。
日志回调的 traceId 与参数类型和真实 producer 一致，使公共调用方无需按发行版本分支。
根单测引用的 `vitest.config.ts` 也必须存在，运行占位执行入口和 broker 的不可用契约测试。

开发、构建与打包中只服务于真实 Computer Use 的步骤，必须先检测到真实 producer 才执行；
检测不到时跳过，不能让开源树的入口因为缺少私有产物而失败：

| 步骤                                                                   | 位置                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------- |
| 开发启动构建 macOS Helper、注入 Helper 环境变量                        | `scripts/dev-desktop-env.mjs`                         |
| 开发态暂存 Computer Use 插件的原生依赖（Sharp）                        | `scripts/stage-dev-cua-plugin-runtime.mjs`            |
| Windows 运行时资源准备 `prepare:windows-cua-helper`                    | `packages/desktop/scripts/prepare-runtime-assets.mjs` |
| 打包附带 macOS Helper、Windows Helper 资源，打包后的 Helper 校验与定稿 | `packages/desktop/electron-builder.config.js`         |

Sharp 的暂存与校验统一使用 `isSharpRequiredByComputerUse`，保留 producer 声明 Sharp
依赖时的原有行为。Windows source bridge 仍是占位包且不声明 Sharp，但外部 runtime 从
CUA plugin 根目录加载 Sharp；目标为 win32 且 `isWindowsComputerUseHelperEnabled`
接受显式 JavaScript runtime 和 Helper 输入时，同样必须暂存并校验 Sharp。
构建与 afterPack 都传入目标平台；没有输入的占位包以及 macOS/Linux source bridge 继续跳过。
Windows source bridge 从显式 Helper 输入的 node_modules 同源获取整套 Sharp 依赖，不要求
开源 workspace 额外安装 Sharp，也不逐包回退到桌面依赖；Helper 本身仍须通过原有严格校验。
详见 `specs/windows-cua-sharp-staging.md`。这些 gate 不表示外部原生产物已经验证可用。

## 所有者与接口

- 唯一判定：`packages/desktop/scripts/computer-use-producer.mjs` 的 `readComputerUseProducer` /
  `isRealComputerUseProducerInstalled`。从桌面包目录向上查找最近一次安装的 `@zcode/zcode-cua`，
  读取清单的 `zcodeCuaPlaceholder` 字段。
- 构建配置同步求值，判定只做一次小文件同步读取。

## 验收

1. 闭源（真实 producer）：上述步骤行为不变。
2. 占位包：`pnpm dev:desktop` 的准备脚本可加载，开发态插件运行时暂存返回空，Windows 不准备 Helper，
   打包不附带也不校验 Helper。
3. 单测：`packages/desktop/test/placeholderProducerDetection.test.ts` 覆盖真实、占位、未安装三种情况与暂存跳过。
