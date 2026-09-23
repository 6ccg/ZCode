# 修改版 Windows 系统入口策略

## 行为与边界

- Windows 桌面进程启动时不注册 `zcode://` 协议；开发态与打包态采用同一规则。
- 不创建或更新文件夹、磁盘的“在 ZCode 中打开”右键菜单，切换语言时同样不写入这些注册表项。
- Main 是系统集成的唯一调用方。Windows 运行时不新增系统入口，也不自动删除、迁移或修复已有登记项。
- 保留接收链接、OAuth/支付回调、分享导入和 `--open-workspace` 参数的处理能力；手动配置的入口仍可投递这些请求。
- macOS/Linux 的现有运行时注册行为保持不变，本次不修改安装器行为。
- 用户数据、Electron 会话数据和子任务输出采用原有目录，不随本次改动清理。

```mermaid
sequenceDiagram
    participant Main as Windows Main
    participant Registry as Windows 注册表
    Main->>Main: 启动或切换语言：不注册、不清理系统入口
    Note over Main,Registry: 已有登记项由用户自行管理
```

## 验收

1. Windows 中调用协议注册入口，不调用 Electron 的注册或移除协议 API，也不执行平台注册器。
2. 启动和切换语言均不再调用 Windows 右键菜单安装器，移除无其他调用方的实现。
3. macOS 仍调用原有协议注册 API，既有链接解析和业务路由保持原样。
