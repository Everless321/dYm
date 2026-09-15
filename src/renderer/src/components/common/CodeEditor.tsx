import { useEffect, useRef } from 'react'
import { javascript } from '@codemirror/lang-javascript'
import { indentWithTab } from '@codemirror/commands'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'

/** 与页面其余部分保持一致的浅色外观 */
const appTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    backgroundColor: '#F5F5F7',
    color: '#1D1D1F'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Liberation Mono", monospace',
    lineHeight: '1.7'
  },
  '.cm-gutters': {
    backgroundColor: '#F5F5F7',
    color: '#C7C7CC',
    border: 'none'
  },
  '.cm-activeLine': { backgroundColor: '#EDEDF0' },
  '.cm-activeLineGutter': { backgroundColor: '#EDEDF0', color: '#A1A1A6' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#D6E4FF' },
  '.cm-cursor': { borderLeftColor: '#0A84FF' }
})

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  /** Cmd/Ctrl+S 触发 */
  onSave: () => void
  readOnly: boolean
}

/**
 * CodeMirror 6 的受控包装。
 *
 * 编辑器实例只创建一次，后续靠 dispatch 同步——每次渲染重建会丢失光标与撤销历史。
 */
export default function CodeEditor({
  value,
  onChange,
  onSave,
  readOnly
}: CodeEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const readOnlyRef = useRef(new Compartment())

  // 回调放进 ref：扩展只在挂载时装一次，闭包里必须能拿到最新的处理函数
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!hostRef.current) return

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          javascript(),
          appTheme,
          // Tab 缩进要排在 basicSetup 之后才能盖掉默认的焦点切换
          keymap.of([
            indentWithTab,
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSaveRef.current()
                return true
              }
            }
          ]),
          readOnlyRef.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          })
        ]
      })
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 挂载时建一次即可，value/readOnly 的后续变化由下面两个 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部换了脚本或保存后回写时，整篇替换；内容相同则不动，避免打断正在输入的光标
  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyRef.current.reconfigure(EditorState.readOnly.of(readOnly))
    })
  }, [readOnly])

  return <div ref={hostRef} className="h-full overflow-hidden" />
}
