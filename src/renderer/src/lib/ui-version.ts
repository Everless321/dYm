export type UiVersion = 'new' | 'legacy'

const KEY = 'ui_version'

export async function getUiVersion(): Promise<UiVersion | null> {
  try {
    const value = await window.api.settings.get(KEY)
    return value === 'legacy' || value === 'new' ? value : null
  } catch {
    return null
  }
}

export async function setUiVersion(version: UiVersion): Promise<void> {
  await window.api.settings.set(KEY, version)
  location.hash = '#/'
  location.reload()
}
