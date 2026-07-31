/** 开发者模式开关变更事件，用于设置页切换后即时刷新侧边栏菜单 */
export const DEVELOPER_MODE_EVENT = 'developer-mode-change'

export function emitDeveloperModeChange(enabled: boolean): void {
  window.dispatchEvent(new CustomEvent<boolean>(DEVELOPER_MODE_EVENT, { detail: enabled }))
}
