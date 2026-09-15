/**
 * 解析 text/event-stream 响应体，逐条产出 data 的 JSON。
 * 非 JSON 的 chunk 与 [DONE] 会被跳过。
 */
export async function* readSseJson(response: Response): AsyncGenerator<unknown> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      // 网关可能用 CRLF 结尾；统一成 LF 后再按空行切事件（与 parseSseText 保持一致）
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      let idx: number
      // SSE 事件以空行分隔；一个事件可能有多行 data:
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const payload = extractData(block)
        if (payload === null) continue
        try {
          yield JSON.parse(payload)
        } catch {
          // 不完整或非 JSON 的 chunk
        }
      }
    }
    // 流结束后 buffer 里可能还有最后一个没有空行结尾的事件
    const tail = extractData(buffer)
    if (tail !== null) {
      try {
        yield JSON.parse(tail)
      } catch {
        /* ignore */
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function extractData(block: string): string | null {
  const lines = block.split(/\r?\n/)
  const data: string[] = []
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    data.push(line.slice(5).trimStart())
  }
  if (!data.length) return null
  const joined = data.join('\n').trim()
  if (!joined || joined === '[DONE]') return null
  return joined
}

/**
 * 有些网关即使没请求 stream 也返回 event-stream；这里把「普通 JSON 或 SSE 文本」统一成
 * 事件数组，调用方自己决定怎么取正文。
 */
export function parseSseText(raw: string): unknown[] {
  const events: unknown[] = []
  for (const block of raw.split(/\r?\n\r?\n/)) {
    const payload = extractData(block)
    if (payload === null) continue
    try {
      events.push(JSON.parse(payload))
    } catch {
      /* ignore */
    }
  }
  return events
}
