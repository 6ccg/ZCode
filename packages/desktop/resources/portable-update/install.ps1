param([Parameter(Mandatory=$true)][string]$PlanPath)
# Windows PowerShell 5.1 必须使用 UTF-8 BOM，避免中文注释与错误信息被按系统代码页误解码。
$ErrorActionPreference = 'Stop'
$plan = [IO.File]::ReadAllText($PlanPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$root = [IO.Path]::GetFullPath($plan.target).TrimEnd('\')
$workspace = [IO.Path]::GetFullPath($plan.workspace)
if (!$workspace.StartsWith($root + '\.zcode-update-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid update workspace' }
if ([IO.Path]::GetFullPath($plan.staged) -ne (Join-Path $workspace 'extracted') -or [IO.Path]::GetFullPath($plan.backup) -ne (Join-Path $workspace 'backup')) { throw 'Invalid update paths' }
foreach ($name in $plan.managed) {
  if (!$name -or $name -eq '.' -or $name -eq '..' -or $name -match '[:\\/]' -or $name.StartsWith('.zcode-update-')) { throw 'Invalid managed entry' }
}
if ($plan.executable -match '[:\\/]' -or $plan.executable -notin $plan.managed) { throw 'Invalid executable' }
$oldMoved = [Collections.Generic.List[string]]::new()
$newMoved = [Collections.Generic.List[string]]::new()
function Write-Result([string]$ErrorMessage) {
  [IO.File]::WriteAllText($plan.resultFile, (@{ error=$ErrorMessage } | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
}
function Remove-ProgramTree([string]$Path) {
  $absolute = [IO.Path]::GetFullPath($Path)
  if (!$absolute.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Refuse removal outside application root' }
  if (!(Test-Path -LiteralPath $absolute)) { return }
  $item = Get-Item -LiteralPath $absolute -Force
  # Windows PowerShell 的递归删除不能沿 junction 进入目录外的文件。
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    if ($item.PSIsContainer) { [IO.Directory]::Delete($absolute) } else { [IO.File]::Delete($absolute) }
    return
  }
  if ($item.PSIsContainer) { foreach ($child in (Get-ChildItem -LiteralPath $absolute -Force)) { Remove-ProgramTree $child.FullName } }
  Remove-Item -LiteralPath $absolute -Force
}
try {
  [IO.File]::WriteAllText($plan.ready, 'ready')
  $parent = Get-Process -Id $plan.parentPid -ErrorAction SilentlyContinue
  if ($parent -and !$parent.WaitForExit(60000)) { throw 'Application did not exit; files were not replaced' }
  New-Item -ItemType Directory -Path $plan.backup -Force | Out-Null
  # 只处理构建清单中的程序条目；绿色目录旁的工作文件、配置和数据不参与替换。
  foreach ($name in $plan.managed) {
    $old = Join-Path $root $name
    if (Test-Path -LiteralPath $old) {
      Move-Item -LiteralPath $old -Destination (Join-Path $plan.backup $name) -Force
      $oldMoved.Add($name)
    }
  }
  foreach ($name in $plan.managed) {
    $next = Join-Path $plan.staged $name
    if (Test-Path -LiteralPath $next) {
      Move-Item -LiteralPath $next -Destination (Join-Path $root $name) -Force
      $newMoved.Add($name)
    }
  }
  Start-Process -FilePath (Join-Path $root $plan.executable) -WorkingDirectory $root | Out-Null
  Write-Result ''
} catch {
  $failure = $_.Exception.Message
  # 启动失败也恢复原条目；不能留下混合版本后再让用户手工覆盖。
  try {
    foreach ($name in $newMoved) { Remove-ProgramTree (Join-Path $root $name) }
    foreach ($name in $oldMoved) { Move-Item -LiteralPath (Join-Path $plan.backup $name) -Destination (Join-Path $root $name) -Force }
    Write-Result "更新失败，已保留或恢复旧版本：$failure"
    if (!(Get-Process -Id $plan.parentPid -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $root $plan.executable))) { Start-Process -FilePath (Join-Path $root $plan.executable) -WorkingDirectory $root | Out-Null }
  } catch {
    Write-Result "更新恢复失败，旧程序备份保留在更新暂存目录：$($_.Exception.Message)"
  }
  exit 1
} finally {
  if (Test-Path -LiteralPath $plan.ready) { Remove-Item -LiteralPath $plan.ready -Force }
  # workspace 已限定在当前程序目录内；异常中断导致的备份不在此处强行删除。
  if (!(Test-Path -LiteralPath $plan.backup) -or @(Get-ChildItem -LiteralPath $plan.backup -Force).Count -eq 0 -or !$failure) { Remove-ProgramTree $workspace }
  Remove-Item -LiteralPath $PlanPath -Force
  Remove-Item -LiteralPath $PSCommandPath -Force
}
