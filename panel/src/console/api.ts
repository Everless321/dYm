export const UNAUTHORIZED_EVENT = 'panel-unauthorized'

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('X-Panel', '1')
  if (options.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...options, headers })
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new Error(data.error || '请求失败')
  }
  return data as T
}

export async function rpc<T>(
  nodeId: string,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  const data = await api<{ result: T }>(`/api/nodes/${encodeURIComponent(nodeId)}/rpc`, {
    method: 'POST',
    body: JSON.stringify({ method, params: params ?? {} })
  })
  return data.result
}
