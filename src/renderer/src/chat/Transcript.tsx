import { useEffect, useRef } from 'react'
import type { TranscriptEntry } from '@shared/types'

const MAX_RENDERED = 50

interface TranscriptProps {
  entries: TranscriptEntry[]
  /** In-progress reply text, or '' when nothing is streaming - see
   * useAssistant's streamingText. Rendered as one extra transient line;
   * never part of `entries` since the real onMessage event is what commits
   * an entry. */
  streamingText?: string
}

export function Transcript({ entries, streamingText }: TranscriptProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const shown = entries.slice(-MAX_RENDERED)
  const isEmpty = shown.length === 0 && !streamingText

  // Keep the newest line in view as the conversation grows, without forcing
  // a scroll position on the user while they're reading back through it -
  // this only runs when the entry count itself changes (or streamed text
  // grows, so a long in-progress reply keeps scrolling into view too).
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown.length, streamingText])

  return (
    <div className="transcript" ref={listRef}>
      {isEmpty ? (
        <p className="transcript-empty">Nothing said yet.</p>
      ) : (
        <>
          {shown.map((entry) => (
            <p key={entry.id} className={`transcript-entry transcript-entry-${entry.role}`}>
              {entry.text}
            </p>
          ))}
          {streamingText && (
            <p className="transcript-entry transcript-entry-assistant transcript-entry-streaming">
              {streamingText}
              <span className="transcript-cursor">▋</span>
            </p>
          )}
        </>
      )}
    </div>
  )
}
