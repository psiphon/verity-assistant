import { useEffect, useState } from 'react'
import { FaceStage } from './face/FaceStage'
import { ChatInput } from './chat/ChatInput'
import { useAssistant } from './chat/useAssistant'
import { SettingsPanel } from './settings/SettingsPanel'
import { unlockAudio } from './audio/sfx'

function App(): React.JSX.Element {
  const { entries, faceState, rapport, thinking, activeTool, send } = useAssistant()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => window.verity.window.onOpenSettings(() => setSettingsOpen(true)), [])

  const lastAssistantEntry = [...entries].reverse().find((e) => e.role !== 'user')

  return (
    <div className="app-shell">
      {settingsOpen ? (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      ) : (
        <>
          <FaceStage
            state={faceState}
            rapport={rapport}
            onClick={() => {
              unlockAudio()
              setExpanded((v) => !v)
            }}
          />

          {/* Always mounted (space reserved) rather than conditionally
              rendered - toggling with display/mount would change the
              app-shell's total content height, and since it's centered
              vertically, the ball itself would visibly shift each time. */}
          <div className={`expand-panel${expanded ? '' : ' expand-panel-hidden'}`}>
            <div className="status-line">
              {thinking && !activeTool && <span className="status-pill">thinking…</span>}
              {activeTool && <span className="status-pill">using {activeTool}…</span>}
              {!thinking && !activeTool && lastAssistantEntry && (
                <span className="status-text">{lastAssistantEntry.text}</span>
              )}
            </div>

            <ChatInput disabled={thinking || !expanded} onSend={send} />
          </div>
        </>
      )}
    </div>
  )
}

export default App
