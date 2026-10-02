'use client'

import { createContext, useContext } from 'react'

export interface AskOptions {
  title: string
  body: string
  confirm: string
  cancel?: string
  danger?: boolean
}

export interface FeedbackApi {
  toast: (message: string) => void
  ask: (options: AskOptions) => Promise<boolean>
}

export const FeedbackContext = createContext<FeedbackApi | null>(null)

export function useFeedback(): FeedbackApi {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('反馈层还没有准备好')
  return value
}
