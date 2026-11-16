#!/bin/sh
set -eu
pid=$1; staged=$2; target=$3; backup=$4; result=$5; ready=$6; workspace=$7; helper=$8; plan=$9
shift 9
case "$target" in /*.app) ;; *) exit 2 ;; esac
case "$workspace" in "$(dirname "$target")"/.zcode-update-*) ;; *) exit 2 ;; esac
[ "$staged" = "$workspace/extracted/ZCode.app" ] && [ "$backup" = "$workspace/backup" ] || exit 2
printf ready > "$ready"
deadline=$(($(date +%s) + 60))
while kill -0 "$pid" 2>/dev/null; do
  if [ "$(date +%s)" -ge "$deadline" ]; then
    printf '{"error":"应用未退出，未替换程序"}' > "$result"
    rm -f "$ready" "$helper" "$plan"
    exit 1
  fi
  sleep 0.2
done
moved=0
installed=0
restore() {
  trap - EXIT HUP INT TERM
  if [ "$installed" -eq 1 ]; then rm -rf "$target"; fi
  if [ "$moved" -eq 1 ]; then
    if ! mv "$backup" "$target"; then
      printf '{"error":"更新恢复失败，旧程序备份保留在更新暂存目录"}' > "$result"
      exit 1
    fi
  fi
  if [ -d "$target" ]; then /usr/bin/open -n "$@" "$target" || true; fi
  printf '{"error":"更新失败，已保留或恢复旧版本"}' > "$result"
  rm -f "$ready" "$helper" "$plan"
  exit 1
}
trap 'restore "$@"' EXIT HUP INT TERM
mv "$target" "$backup"
moved=1
mv "$staged" "$target"
installed=1
/usr/bin/open -n "$@" "$target"
trap - EXIT HUP INT TERM
printf '{"error":""}' > "$result"
rm -f "$ready" "$helper" "$plan"
rm -rf "$workspace"
