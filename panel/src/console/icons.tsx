function Glyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function BrandMark(): React.JSX.Element {
  return (
    <span className="mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16">
        <rect x="2" y="2" width="8" height="8" rx="1.6" fill="currentColor" />
        <rect x="14" y="2" width="8" height="8" rx="1.6" fill="currentColor" opacity="0.45" />
        <rect x="2" y="14" width="8" height="8" rx="1.6" fill="currentColor" opacity="0.45" />
        <rect x="14" y="14" width="8" height="8" rx="1.6" fill="currentColor" />
      </svg>
    </span>
  )
}

export function IconNodes(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </Glyph>
  )
}

export function IconPosts(): React.JSX.Element {
  return (
    <Glyph>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none" />
      <path d="m21 15-3.2-3.2a1.8 1.8 0 0 0-2.6 0L6 21" />
    </Glyph>
  )
}

export function IconUsers(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Glyph>
  )
}

export function IconTasks(): React.JSX.Element {
  return (
    <Glyph>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </Glyph>
  )
}
