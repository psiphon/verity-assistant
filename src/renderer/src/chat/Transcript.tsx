import { useEffect, useRef } from 'react'
import type { TranscriptEntry } from '@shared/types'

const MAX_RENDERED = 50

interface TranscriptProps {
  entries: TranscriptEntry[]
}

export function Transcript({ entries }: TranscriptProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const shown = entries.slice(-MAX_RENDERED)

  // Keep the newest line in view as the conversation grows, without forcing
  // a scroll position on the user while they're reading back through it -
  // this only runs when the entry count itself changes.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown.length])

  return (
    <div className="transcript" ref={listRef}>
      {shown.length === 0 ? (
        <p className="transcript-empty">Nothing said yet.</p>
      ) : (
        shown.map((entry) => (
          <p key={entry.id} className={`transcript-entry transcript-entry-${entry.role}`}>
            {entry.text}
          </p>
        ))
      )}
    </div>
  )
}
