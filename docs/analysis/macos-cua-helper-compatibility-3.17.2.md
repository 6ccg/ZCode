# macOS Computer Use helper 静态兼容性分析

核查日期：2026-11-09 UTC。结论仅来自 Linux 上的文件、协议与源码对照，不包含 macOS 启动、Apple 验签、TCC 授权、截图或输入验证。

## 结论

官方 3.17.2 helper 不能靠把开源占位包接上一个 socket 就变成本 fork 的可用原生后端。主要边界是官方签名身份链和缺失的 producer，不是 IPC 版本数字。ZcodePro 的 macOS 安装路径还修改了 helper 的编译信任策略，因此不能把其安装器当作普通的协议适配。

本次没有执行或修改官方程序，没有复制 vendor 实现或原生二进制进仓库，没有修改签名、隔离属性、系统权限或安装器。没有以检查器、mock 测试或静态相似性代替原生适配结果。

## 已验证的输入

- [官方 arm64 channel-1 manifest](https://zcode.z.ai/api/v1/releases/electron/manifest?platform=darwin-aarch64&channel=1) 此次返回 3.17.2，releaseDate 为 `2026-11-02T06:43:49.471Z`。
- [官方 3.17.2 arm64 ZIP](https://cdn-zcode.z.ai/zcode/electron/releases/3.17.2/macos-arm64/ZCode-3.17.2-mac-arm64.zip)，300741958 字节，SHA-512 与上述 manifest 一致。
- ZIP SHA-256：`7f95b42d2066d4633c95d117c67f124a1499d9832060a58ccd53d0a43f4a06ab`。
- helper 可执行文件 SHA-256：`36ba7e600dce3cc715bdf278459fedb89eb9622dfbd8278abe9811f0717cad2b`。
- helper 的 `ax_native.node` SHA-256：`b169b8dc8be0dc747fdba5d8e17d4c814e13068b711a238d421b808c660ceaea`。
- helper 为 Node SEA 加原生 addon，bundle ID 为 `dev.zcode.cua-helper`，build ID 为 `pipeline-326130-a2d1ba73`。本次检查的是 arm64，不代表 x64 已检查。
- 主 app 的 Info.plist 最低系统版本为 macOS 13.0.0；helper 自身声明 12.0。不能据 helper 的声明宣传整个 Electron 44 app 支持 macOS 12。
- [ZcodePro 核查提交](https://github.com/luxi233/ZcodePro/tree/c81950cb6dbdb4e1529879174632b3909cca26f8) 与此次远端 HEAD 一致。其 CUA package 声明版本 0.6.3、IPC 2。

哈希证明所读字节与此次下载声明一致，不代替 Apple 签名、notarization 或安全性验证。归档中存在代码签名资源，但 Linux 未验证其有效性。

## IPC 2 与 3 的具体差异

对照来源为官方 3.14.3 与 3.17.2 helper 的 SEA 内嵌 JavaScript，以及 ZcodePro 上述提交的 broker client。只读取内嵌文本，没有加载或执行它。

### 没有变成不兼容门槛的部分

- 传输仍是本地 socket 上的逐行 JSON。请求使用非负安全整数 `id`、非空 `method`、对象 `params`；响应保留相同 `id`、`ok`，以及 `result` 或 `error`，可带独立 `presentation`。
- `authenticate` 和 `ping` 仅在合法整数 `clientApiVersion` 大于 server 的 3 时返回 `version_mismatch`。因此 v2 客户端可通过这个版本条件；这并不证明每个工具行为兼容。
- ZcodePro client 先发送 id 0 的 `authenticate`，成功后才发送业务请求。它会发送 `clientApiVersion: 2`，没有要求服务端版本必须相等。官方 3.17.2 Host 的 client 则发送 3。
- controller lease、launcher/peer 身份校验以及 PiP 会话契约没有在这两个官方包之间改成新的版本规则。PiP 单独保持 protocol 2、runtime ID `zcode-cua-pip-session-v2`，不能把它与 broker IPC 3 混为一谈。

### 需要实际适配的部分

1. 3.17.2 的 broker 方法表新增 `element_scroll`。参数方向为 up/down/left/right，amount 为 1 到 100 的安全整数。它通过当前元素引用寻找可滚动祖先，不等同于坐标滚轮事件。无对应原生能力或可滚动容器时明确失败，不能悄悄回退为未验证的物理输入。
2. 每次业务请求新增 `pip_session_context` 的 session_id/action_title 处理，供多会话光标归属与生命周期使用。缺失或不合法时不会建立对应 scope。连接级 session/thread 身份与每调用 scope 是不同层次，不能只改协议常量。
3. 3.17.2 新增 Windows operation association、窗口所有者证据和 delivery/readback 回执等逻辑；这些是跨平台 wire payload 的变化，不是已经完成 Mac 原生适配的证据。
4. 截图与坐标输入仍需要 frame、显示拓扑、窗口/像素所有者和过期证据。接口名相同不表示可以省去这些检查。未知递送结果不能自动重发点击或输入。
5. 成功的 `broker_info` 回应才完成启动认领；仅建立连接或 authenticate 不够。正常生命周期还包括启动取消、单实例、停止排空和 launcher 存活检查。

## 为什么未改的官方 helper 不能直接接入本 fork

官方发行包把 local-development runtime 与 unsigned-launcher policy 编译为关闭。普通环境变量并不能开启这些编译策略。

正常 launcher 路径要求 Apple 锚定签名、允许的 ZCode bundle identifier，以及固定的官方 Team 身份。每个连接还会独立校验同 UID、audit token 对应的进程签名，以及责任/父进程签名。只让进程启动或取得 socket 路径，并不会获得输入权限。PiP presentation 角色还要通过受验证的 Host 身份或其受信任进程关系，不能仅靠自报角色取得。

[ZcodePro 安装说明](https://github.com/luxi233/ZcodePro/blob/c81950cb6dbdb4e1529879174632b3909cca26f8/README.zh-CN.md) 和安装脚本表明，其 Mac 路径会改变上述编译信任门、重新签名，并修改安装状态。它解决问题的方式超出了接口转接。本次不实现、运行或分发该路径。

## 源码接入路径与停止点

### 路径 A：保留官方 helper 原样

需要官方支持的签名 Host/peer 链，或官方明确提供、允许本 fork 使用的开发版/helper SDK 和分发许可。当前开源树的 `broker.js` 仍拒绝真实调用，`broker-server.js` 的 installer、launch、native backend 仍为占位，`zcodeCuaPlaceholder` 有意阻止将它包装为真实 producer。

仅替换 `createComputerUseRuntime`、复制 helper、修改 IPC 常量或移除 placeholder 标记都不构成这个实现。必须在权利与信任条件成立后，一起实现资源校验、生命周期、协议 client、controller 仲裁、身份隔离、权限状态与每平台原生验收。

**当前停止点：**没有可供本 fork 使用的官方受信任签名链；Linux 无法进行该 Mac 路径的原生验证。没有尝试绕过该边界，也没有宣称官方 helper 已接通。

### 路径 B：独立源码原生后端

沿用已有 [source Computer Use spec](../../specs/source-computer-use.md) 的 API-key provider、每调用鉴权和受控 runtime，独立实现操作系统接口，使用自己的应用身份与用户正常授予的权限，不伪装为官方 helper。

当前 `macos-ax` 是显式启用的前台 AX 子集，仅有应用列表、观察、设置公开值和执行公开 action。它没有截图、坐标输入、键盘、剪贴板、后台控制或 PiP，不能作为官方功能对等替代。

扩展时应按实际能力增加 contract 与失败语义：先做可靠的 AX 对象/进程身份、会话和停止处理，再加入截图的窗口与显示证据、输入投递回执；PiP 与后台模式另行实现。业务 client 可借鉴上面的协议事实，但不需要复制官方 SEA 实现。增加 `element_scroll` 也必须有真实原生 adapter 支持，而不是把方法名映射到任意鼠标事件。

**验收停止点：**源码和 Linux 确定性测试可继续完成；最终必须在获得授权的 macOS 环境检查权限拒绝/授予、前台变化、过期元素、截图归属、一次性输入、取消、重启与多会话隔离。本次未请求或使用用户电脑，未完成该原生阶段。

## 许可边界

ZcodePro 根目录声明 MIT，其 CUA package 声明 Apache-2.0。所检查官方归档未发现单独授予 helper 再分发权的许可文件。这些声明不应被当作已经证明所有 vendor 切片和原生二进制的来源及再分发权，也不等于断言它们不能获得许可。

因此本仓库只保留独立源码与协议事实，不提交官方 SEA、addon、解出的 vendor 代码或修改后的安装包。需要再分发时先取得可验证的权利依据。
