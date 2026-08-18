#!/usr/bin/env bash
#
# 生成发版说明，输出到 stdout。
#
# 来源优先级：
#   1. annotated tag 的说明正文（git tag -a v1.2.3 -F notes.md）
#   2. 该 tag 指向的提交的消息正文
#
# 之所以不用 GitHub 的 generate_release_notes：它列的是 Pull Request，
# 而本仓库直接推 main、没有 PR，自动生成的正文里除了一行 Full Changelog
# 链接之外什么都没有。
#
# 用法：release-notes.sh <tag>
set -euo pipefail

tag="${1:?用法: release-notes.sh <tag>}"

# 去掉提交尾部的 trailer（Co-Authored-By / Signed-off-by 等）和首尾空行
strip_trailers() {
  sed -E '/^(Co-Authored-By|Co-authored-by|Signed-off-by|Reviewed-by):/d' |
    awk 'BEGIN{blank=0} {if($0 ~ /^[[:space:]]*$/){blank++} else {while(blank-->0) print ""; blank=0; print}}'
}

notes=""

# annotated tag：整份说明都是正文（-F notes.md 写入时没有标题行这一说），
# 只有在首行恰好就是 tag 名时才剥掉——那是 git tag -a v1.2.3 -m "v1.2.3" 的习惯写法
if [[ "$(git cat-file -t "$tag" 2>/dev/null || true)" == "tag" ]]; then
  notes="$(git tag -l --format='%(contents)' "$tag")"
  if [[ "$(head -1 <<<"$notes" | tr -d '[:space:]')" == "$tag" ]]; then
    notes="$(tail -n +2 <<<"$notes")"
  fi
  notes="$(strip_trailers <<<"$notes")"
fi

# tag 没写正文时回退到提交消息正文（同样去掉标题行）。
# 这条路不可靠：发版重试时若移动过 tag，取到的会是最后一个修复提交而非发版说明，
# 所以显式告警，提示改用 git tag -a <tag> -F notes.md。
if [[ -z "${notes//[[:space:]]/}" ]]; then
  echo "⚠ tag $tag 没有说明正文，回退到提交消息。" >&2
  echo "  若该 tag 曾被移动，这里取到的可能不是发版说明。" >&2
  echo "  建议打 tag 时写入说明：git tag -a $tag -F notes.md" >&2
  notes="$(git log -1 --format=%B "$tag" | tail -n +2 | strip_trailers)"
fi

if [[ -z "${notes//[[:space:]]/}" ]]; then
  echo "✖ tag $tag 的说明与提交正文都是空的，写不出发版说明" >&2
  exit 1
fi

printf '%s\n' "$notes"
