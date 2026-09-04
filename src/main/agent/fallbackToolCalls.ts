export interface FallbackCall {
  name: string
  input: Record<string, unknown>
}

/**
 * Some models/backends (especially local ones via an OpenAI-compatible
 * server) accept a `tools` param but don't reliably use real structured
 * tool-calling - they instead write the call out as text in the reply
 * itself, e.g. `-play_sound{"sound": "chime"}`. That text would otherwise
 * get shown/spoken to the user verbatim and the intended action would
 * never actually run. This scans a final (non-tool-call) reply for that
 * pattern, executes any matches, and strips them from the visible text.
 */
export function extractFallbackToolCalls(
  text: string,
  knownToolNames: string[]
): { cleanedText: string; calls: FallbackCall[] } {
  if (knownToolNames.length === 0) return { cleanedText: text, calls: [] }

  const calls: FallbackCall[] = []
  const namePattern = knownToolNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  // Matches: optional leading bullet/dash, a known tool name, an optional
  // "(", then a single-line (non-nested) JSON object, an optional ")".
  const re = new RegExp(`[-*]?\\s*(${namePattern})\\s*\\(?(\\{[^{}]*\\})\\)?`, 'g')

  const cleanedText = text
    .replace(re, (match, name: string, jsonStr: string) => {
      try {
        const input = JSON.parse(jsonStr) as Record<string, unknown>
        calls.push({ name, input })
        return ''
      } catch {
        return match // malformed JSON - leave it, might just be coincidental text
      }
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { cleanedText, calls }
}
