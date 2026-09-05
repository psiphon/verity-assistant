import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '#test': resolve(__dirname, 'test')
    }
  },
  test: {
    globals: true,
    // Vitest 5 dropped environmentMatchGlobs (silently ignored, not an
    // error - confirmed by a diagnostic test where `window` came back
    // undefined under it). jsdom only adds window/document on top of Node
    // without removing any Node API, so using it as the single project-wide
    // environment is safe for the main-process tests too.
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        // Electron process bootstrap - window/tray construction and options
        // objects, not meaningfully unit-testable without a real Electron
        // runtime. Covered in practice by manual testing (see `run` skill).
        'src/main/index.ts',
        'src/renderer/src/main.tsx',
        // Dev-only scaffolding for previewing the renderer in a plain
        // browser tab outside Electron - not part of the shipped app.
        'src/renderer/src/devMockVerity.ts'
      ]
    }
  }
})
