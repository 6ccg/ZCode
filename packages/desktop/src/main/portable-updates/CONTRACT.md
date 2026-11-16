# 绿色版更新

Desktop Main 是请求、候选版本、下载与安装计划的唯一所有者。设置仍经现有 SettingService 持久化；renderer 仅保存尚未提交的表单，并按 revision 接收快照。

空来源不联网；官方更新器继续关闭。请求不含应用账号、Cookie 或设备信息。换源或取消使旧任务失效。ZIP 摘要通过并完成安装前检查后才进入 ready；安装必须由用户触发，且不能有运行中的 Agent。

安装适配器负责同卷 staging 和临时 helper；Main 复用现有 prepareAppQuit 收尾。Windows 保留非程序文件，Mac 只替换 .app。失败恢复旧文件，不能将 helper 启动成功等同于新程序健康验收。

ASAR 身份读取使用可关闭的普通文件句柄，按容器头定位唯一 metadata；不能通过 Electron 虚拟路径读取暂存包，否则 Windows 缓存句柄会阻止删除。物理遍历和清理使用 original-fs，整个更新过程不切换全局 noAsar。

具体协议、默认值和验收见 specs/modified-desktop-updates.md。
