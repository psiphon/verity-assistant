import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { installDevMockVerityIfNeeded } from './devMockVerity'

installDevMockVerityIfNeeded()

window.addEventListener('error', (e) => {
  window.verity?.logs.reportError(`Uncaught: ${e.message} (${e.filename}:${e.lineno})`)
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? e.reason.stack || e.reason.message : String(e.reason)
  window.verity?.logs.reportError(`Unhandled rejection: ${reason}`)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
