/**
 * 从模型输出里提取第一个完整的 JSON 对象。
 * 比 /\{[\s\S]*\}/ 稳：能处理 ```json 代码块、对象前后夹带的说明文字、
 * 以及 summary 里出现的花括号（按括号配对与字符串转义扫描，而不是贪婪到最后一个 }）。
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const candidates: string[] = []
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) candidates.push(fence[1])
  candidates.push(text)

  for (const candidate of candidates) {
    const slice = scanBalancedObject(candidate)
    if (!slice) continue
    try {
      const parsed = JSON.parse(slice)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // 继续尝试下一个候选
    }
  }
  return null
}

function scanBalancedObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}
