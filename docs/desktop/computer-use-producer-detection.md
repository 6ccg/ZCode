# Computer Use 组件检测与暂存

## 构建输入

公开接口包 `@zcode/zcode-cua` 声明 `zcodeCuaPlaceholder: true`。没有私有组件时，类型和接口检查可运行，原生能力不可用。发布构建通过 `ZCODE_CUA_BUNDLE_DIR` 选择完整组件包，`configureBundledComputerUse` 校验版本、目标与哈希，再配置 SDK/helper 的暂存输入。

最终包内的路径固定为 `resources/tools/zcode-cua` 和 `resources/tools/cua-helper`；这些构建变量不要求最终用户配置。生成组件的命令见 [组件规格](../../specs/bundled-computer-use.md)。

## 能力检测

`packages/desktop/scripts/computer-use-producer.mjs` 是能力检测的唯一所有者。

- `readComputerUseProducer` 读取桌面包最近的 `@zcode/zcode-cua` 清单，`isRealComputerUseProducerInstalled` 识别完整 producer。
- `zcodeCuaRuntimeCapabilities.windowsBroker: true` 只表示公开包提供 Windows bridge；它与 `zcodeCuaPlaceholder` 可以同时存在，不表示原生组件已经可用。
- `isWindowsComputerUseHelperEnabled` 要求目标为 win32，并有完整 producer，或同时提供 Windows broker、JavaScript runtime 输入及 helper 输入。
- 能力检测只决定执行哪些构建步骤；显式输入仍必须通过资源校验。缺少输入时跳过 CUA，错误输入则终止构建。
- macOS/Linux 不暂存 Windows helper。开发过程不因存在 Windows bridge 而注入 macOS helper 变量。

| 步骤                   | 实现                                                  |
| ---------------------- | ----------------------------------------------------- |
| 开发启动与 helper 环境 | `scripts/dev-desktop-env.mjs`                         |
| 开发插件原生依赖暂存   | `scripts/stage-dev-cua-plugin-runtime.mjs`            |
| 发布资源准备           | `packages/desktop/scripts/prepare-runtime-assets.mjs` |
| 资源收集及 afterPack   | `packages/desktop/electron-builder.config.js`         |

## JavaScript 与 helper 校验

runtime 暂存验证包身份、版本和公共 JS 导出路径，保留 LICENSE/NOTICE，只复制 JS/CJS/MJS/JSON。拒绝路径越界、链接、夹带的原生二进制、node_modules 和声明的外部 npm 依赖。

静态依赖检查覆盖字面量 import/re-export/import()、无条件 require() 和具名 createRequire 调用，要求 Node 内置模块或包内文件；拒绝缺失模块、裸 npm ESM 导入和无法确定的动态路径。被条件或 catch 包围的宿主依赖不视为已验证，其 Express/Sharp 资源另行检查。静态闭包检查不执行组件代码。

helper 使用独立清单校验 package/version、平台架构、Electron、entry/addon、SHA-256、PE machine 与完整依赖树。资源准备、运行时解析及 afterPack 共用契约，见 [Windows 运行时](../cua/windows-product-runtime.md)。

## Sharp 资源

`isSharpRequiredByComputerUse` 统一决定插件准备与 afterPack 是否需要 Sharp：保留 producer 的依赖声明语义；公开 Windows bridge 则在 win32 helper gate 通过时需要 Sharp。不能按构建主机平台猜目标。

Windows bridge 的 Sharp 包全部来自选定 helper 的平铺 node_modules，先解析并验证完整集合，再写输出；不混合桌面依赖或回退父目录。资源暂存到插件根，runtime 经 `ZCODE_CUA_PLUGIN_ROOT` 解析它们。

必须保留 Sharp 的 `lib/`、目标 `@img/sharp-win32-{arch}` addon 和 libvips DLL。缺失 addon/DLL、包身份不符或路径越界时失败。原生组件的设备可用性由最终包验收确认。

## 验证入口

- `placeholderProducerDetection.test.ts`：完整 producer、公开包、缺失输入、目标平台及共同 gate。
- `sharpComputerUseRequirement.test.ts`：同源依赖、目标架构和缺失原生资源。
- `windowsCuaPrebuiltRuntime.test.ts`：预打包清单、路径、哈希、架构及 afterPack。

上述文件位于 `packages/desktop/test/`，通过 `pnpm test:engineering <文件>` 执行。
