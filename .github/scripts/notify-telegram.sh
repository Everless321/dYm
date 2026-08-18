#!/usr/bin/env bash
#
# 发版成功后往 Telegram 群里发一条带下载链接的通知。
#
# 下载链接从 Release 的实际资产列表里取，不硬编码文件名——artifactName
# 模板改过一次，硬编码迟早会指向不存在的文件。
#
# 需要的环境变量：
#   TELEGRAM_BOT_TOKEN  BotFather 给的 token
#   TELEGRAM_CHAT_ID    群的 chat id（超级群是负数，形如 -1001234567890）
#   GITHUB_REPOSITORY   owner/repo
#   TAG                 版本 tag，如 v2.6.0
#   GH_TOKEN            用于读 Release 资产列表
# 可选：
#   DRY_RUN=1           只打印 payload，不实际发送
set -euo pipefail

: "${GITHUB_REPOSITORY:?}"
: "${TAG:?}"

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  echo "未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID，跳过 Telegram 推送"
  exit 0
fi

version="${TAG#v}"
release_url="https://github.com/${GITHUB_REPOSITORY}/releases/tag/${TAG}"
download_base="https://github.com/${GITHUB_REPOSITORY}/releases/download/${TAG}"

assets="$(gh api "repos/${GITHUB_REPOSITORY}/releases/tags/${TAG}" --jq '.assets[].name')"
if [[ -z "$assets" ]]; then
  echo "✖ Release ${TAG} 没有任何资产，不发送通知"
  exit 1
fi

# 按后缀挑出各平台的主安装包；.blockmap 与 .yml 是给自动更新用的，不放进消息
# -- 必须紧跟在 grep 的选项后面：模式以 - 开头（如 -arm64.dmg）时会被当成选项
pick() { grep -E -- "$1" <<<"$assets" | grep -vE -- '\.blockmap$' | head -1; }

mac_arm="$(pick '-arm64\.dmg$' || true)"
mac_x64="$(pick '-x64\.dmg$' || true)"
win="$(pick '\.exe$' || true)"
linux_appimage="$(pick '\.AppImage$' || true)"
linux_deb="$(pick '\.deb$' || true)"

lines=()
add_line() { [[ -n "$2" ]] && lines+=("$1: <a href=\"${download_base}/$2\">$2</a>"); }
add_line "macOS (Apple Silicon)" "$mac_arm"
add_line "macOS (Intel)" "$mac_x64"
add_line "Windows" "$win"
add_line "Linux (AppImage)" "$linux_appimage"
add_line "Linux (deb)" "$linux_deb"

if [[ ${#lines[@]} -eq 0 ]]; then
  echo "✖ 没有匹配到任何可下载的安装包，资产列表："
  echo "$assets"
  exit 1
fi

text="🚀 <b>dYm ${version}</b> 已发布

$(printf '%s\n' "${lines[@]}")

完整更新说明：${release_url}"

# 用 jq 组装 JSON，避免版本号或文件名里的特殊字符破坏转义
payload="$(jq -n \
  --arg chat_id "$TELEGRAM_CHAT_ID" \
  --arg text "$text" \
  '{chat_id: $chat_id, text: $text, parse_mode: "HTML", disable_web_page_preview: true}')"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  echo "--- DRY_RUN，以下为将要发送的内容 ---"
  jq -r '.text' <<<"$payload"
  exit 0
fi

response="$(curl -sS -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  -H 'Content-Type: application/json' \
  -d "$payload")"

if [[ "$(jq -r '.ok' <<<"$response")" != "true" ]]; then
  # 不打印完整响应，避免把 token 之类的东西带进日志
  echo "✖ Telegram 推送失败：$(jq -r '.description // "未知错误"' <<<"$response")"
  exit 1
fi

echo "✔ 已推送到 Telegram 群"
