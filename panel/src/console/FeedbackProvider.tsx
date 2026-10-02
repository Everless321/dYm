'use client'

import { useCallback, useRef, useState } from 'react'
import { FeedbackContext, type AskOptions } from './feedback'
import { Modal } from './widgets'

export function FeedbackProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [toastOpen, setToastOpen] = useState(false)
  const timer = useRef(0)
  const [askState, setAskState] = useState<{
    options: AskOptions
    finish: (value: boolean) => void
  } | null>(null)

  const toast = useCallback((text: string): void => {
    setMessage(text)
    setToastOpen(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToastOpen(false), 2800)
  }, [])

  const ask = useCallback((options: AskOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      let settled = false
      const finish = (value: boolean): void => {
        if (settled) return
        settled = true
        setAskState(null)
        resolve(value)
      }
      setAskState({ options, finish })
    })
  }, [])

  const closeAsk = useCallback((): void => {
    askState?.finish(false)
  }, [askState])

  return (
    <FeedbackContext.Provider value={{ toast, ask }}>
      {children}
      <div className="toast" hidden={!toastOpen}>
        {message}
      </div>
      <Modal open={askState !== null} onClose={closeAsk}>
        {askState ? (
          <div className="dialog-pad">
            <div>
              <p className="eyebrow">请确认</p>
              <h2>{askState.options.title}</h2>
            </div>
            <p className="lede">{askState.options.body}</p>
            <div className="dialog-actions">
              <button className="ghost" type="button" onClick={() => askState.finish(false)}>
                {askState.options.cancel ?? '取消'}
              </button>
              <button
                className={askState.options.danger ? 'danger' : 'primary'}
                type="button"
                onClick={() => askState.finish(true)}
              >
                {askState.options.confirm}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </FeedbackContext.Provider>
  )
}
