import { promises as fsp } from 'node:fs'
import type { Dirent } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ToolDefinition } from '../llm/types'

const MAX_DIR_ENTRIES = 200
const MAX_READ_BYTES = 50 * 1024
const MAX_SEARCH_RESULTS = 100
const MAX_CONTENT_MATCHES = 100
const MAX_HITS_PER_FILE = 5
const MAX_CONTENT_FILE_BYTES = 2 * 1024 * 1024
const MAX_SEARCH_DEPTH = 10
const MAX_NODES_VISITED = 15000

// Directories that are huge and almost never what someone means by "find
// this on disk" - pruned outright rather than just slowing every search down.
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  'appdata',
  '$recycle.bin',
  'system volume information'
])

// Substrings checked case-insensitively against a full path - reading or
// grepping any of these could hand real credentials to whatever LLM
// provider is configured, so they're refused outright (unlike directory
// listing/name search, which only reveal structure, not contents).
const SENSITIVE_PATH_PATTERNS = [
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.kube',
  '.docker/config',
  '.docker\\config',
  'gcloud',
  '.terraform',
  'terraform.tfstate',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'authorized_keys',
  'known_hosts',
  'credentials',
  'secring',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.pgpass',
  '.git-credentials',
  '.env',
  'wp-config.php',
  'login data',
  'logins.json',
  'key3.db',
  'key4.db',
  'cert9.db',
  'signons.sqlite',
  'cookies',
  'local state',
  'wallet.dat',
  'keystore'
]

// Individual path segments that are off-limits no matter where they sit -
// catches e.g. a symlinked or unusually-nested "~/backup/.ssh" that the
// substring list above might still let through with the wrong separator.
const SENSITIVE_PATH_SEGMENTS = new Set([
  '.ssh',
  '.aws',
  '.azure',
  '.gnupg',
  '.gpg',
  '.kube',
  '.password-store',
  'keychains'
])

// File extensions that are almost always private key / credential material.
const SENSITIVE_EXTENSIONS = new Set([
  '.pem',
  '.key',
  '.pfx',
  '.p12',
  '.keystore',
  '.jks',
  '.ppk',
  '.kdbx',
  '.ovpn',
  '.asc',
  '.gpg'
])

function isSensitivePath(p: string): boolean {
  const lower = p.toLowerCase()
  if (SENSITIVE_PATH_PATTERNS.some((pattern) => lower.includes(pattern))) return true
  if (SENSITIVE_EXTENSIONS.has(path.extname(lower))) return true
  const segments = lower.split(/[\\/]+/)
  return segments.some((seg) => SENSITIVE_PATH_SEGMENTS.has(seg))
}

/** Resolve symlinks before a sensitive-path check so a benign-looking link
 * (`~/notes/pwd` -> `~/.ssh/id_rsa`) can't smuggle past the denylist. Falls
 * back to the literal path if it can't be resolved (e.g. doesn't exist yet -
 * the caller's own stat/read will then surface the real error). */
async function realPathOrSelf(p: string): Promise<string> {
  try {
    return await fsp.realpath(p)
  } catch {
    return p
  }
}

function resolveUserPath(input: string | undefined): string {
  const raw = (input ?? '').trim()
  if (!raw) return os.homedir()
  const expanded = raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw
  return path.isAbsolute(expanded) ? expanded : path.join(os.homedir(), expanded)
}

interface WalkBudget {
  remaining: number
}

async function* walk(
  root: string,
  depth: number,
  budget: WalkBudget
): AsyncGenerator<{ fullPath: string; isDirectory: boolean }> {
  if (depth > MAX_SEARCH_DEPTH || budget.remaining <= 0) return
  let entries: Dirent[]
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (budget.remaining <= 0) return
    budget.remaining--
    const fullPath = path.join(root, entry.name)
    if (isSensitivePath(fullPath)) continue
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name.toLowerCase())) continue
      yield { fullPath, isDirectory: true }
      yield* walk(fullPath, depth + 1, budget)
    } else if (entry.isFile()) {
      yield { fullPath, isDirectory: false }
    }
  }
}

export function filesystemToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: 'list_directory',
      description:
        "List the files and folders in a directory on the user's machine. Defaults to their home folder if no path is given.",
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path, or one relative to the home folder. Omit for home folder.'
          }
        }
      }
    },
    {
      name: 'read_text_file',
      description:
        "Read a text file's contents from the user's machine. Refuses obviously binary files and files that look like credentials/keys, and truncates anything past 50KB.",
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path, or one relative to the home folder.'
          }
        },
        required: ['path']
      }
    },
    {
      name: 'search_files',
      description:
        "Find files or folders by name (case-insensitive substring match) under a directory, recursively. Use this to help the user find something on disk when they don't know exactly where it is.",
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to look for in file/folder names.' },
          path: {
            type: 'string',
            description: 'Directory to search under. Defaults to the home folder.'
          },
          maxResults: { type: 'number', description: 'Cap on results, default 50, max 100.' }
        },
        required: ['query']
      }
    },
    {
      name: 'search_file_contents',
      description:
        'Search inside text files under a directory for a literal string (like a simple grep), recursively. Good for finding code, notes, or config by what they contain rather than their name. Skips binary and very large files.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Literal text to search for (not a regex).' },
          path: {
            type: 'string',
            description: 'Directory to search under. Defaults to the home folder.'
          },
          caseSensitive: { type: 'boolean', description: 'Default false.' },
          maxResults: { type: 'number', description: 'Cap on matching lines, default 50, max 100.' }
        },
        required: ['query']
      }
    }
  ]
}

async function listDirectory(pathInput: string | undefined): Promise<string> {
  const dirPath = resolveUserPath(pathInput)
  let entries: Dirent[]
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true })
  } catch (err) {
    return `Could not list ${dirPath}: ${err instanceof Error ? err.message : String(err)}`
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  const shown = entries.slice(0, MAX_DIR_ENTRIES)
  const lines = shown.map((e) => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`)
  const extra = entries.length - shown.length
  if (extra > 0) lines.push(`...and ${extra} more`)
  return lines.length ? `${dirPath}:\n${lines.join('\n')}` : `${dirPath} is empty.`
}

async function readTextFile(pathInput: string): Promise<string> {
  const filePath = resolveUserPath(pathInput)
  if (isSensitivePath(filePath) || isSensitivePath(await realPathOrSelf(filePath))) {
    return `Refusing to read ${filePath} - looks like a credential or key file.`
  }
  let stat: Awaited<ReturnType<typeof fsp.stat>>
  try {
    stat = await fsp.stat(filePath)
  } catch (err) {
    return `Could not read ${filePath}: ${err instanceof Error ? err.message : String(err)}`
  }
  if (stat.isDirectory()) return `${filePath} is a directory - use list_directory instead.`

  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES + 1))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (buffer.subarray(0, Math.min(bytesRead, 1000)).includes(0)) {
      return `${filePath} looks like a binary file - not shown.`
    }
    const truncated = bytesRead > MAX_READ_BYTES
    const text = buffer.toString('utf8', 0, Math.min(bytesRead, MAX_READ_BYTES))
    return truncated
      ? `${text}\n...[truncated - showing first ${MAX_READ_BYTES / 1024}KB of ${(stat.size / 1024).toFixed(1)}KB]`
      : text
  } finally {
    await handle.close()
  }
}

async function searchFiles(
  query: string,
  rootInput: string | undefined,
  maxResultsInput: unknown
): Promise<string> {
  const root = resolveUserPath(rootInput)
  const maxResults = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Number(maxResultsInput) || 50))
  const needle = query.toLowerCase()
  const budget: WalkBudget = { remaining: MAX_NODES_VISITED }
  const matches: string[] = []
  let truncated = false

  for await (const node of walk(root, 0, budget)) {
    if (path.basename(node.fullPath).toLowerCase().includes(needle)) {
      matches.push(`${node.isDirectory ? '[dir]' : '[file]'} ${node.fullPath}`)
      if (matches.length >= maxResults) {
        truncated = true
        break
      }
    }
  }
  if (budget.remaining <= 0) truncated = true

  if (matches.length === 0) return `(no files matching "${query}" found under ${root})`
  const note = truncated
    ? '\n(results may be incomplete - narrow the path or query for a fuller search)'
    : ''
  return matches.join('\n') + note
}

async function searchFileContents(
  query: string,
  rootInput: string | undefined,
  caseSensitiveInput: unknown,
  maxResultsInput: unknown
): Promise<string> {
  const root = resolveUserPath(rootInput)
  const caseSensitive = Boolean(caseSensitiveInput)
  const maxResults = Math.max(1, Math.min(MAX_CONTENT_MATCHES, Number(maxResultsInput) || 50))
  const needle = caseSensitive ? query : query.toLowerCase()
  const budget: WalkBudget = { remaining: MAX_NODES_VISITED }
  const results: string[] = []
  let truncated = false

  outer: for await (const node of walk(root, 0, budget)) {
    if (node.isDirectory) continue
    if (isSensitivePath(await realPathOrSelf(node.fullPath))) continue
    let stat: Awaited<ReturnType<typeof fsp.stat>>
    try {
      stat = await fsp.stat(node.fullPath)
    } catch {
      continue
    }
    if (stat.size === 0 || stat.size > MAX_CONTENT_FILE_BYTES) continue

    let buf: Buffer
    try {
      buf = await fsp.readFile(node.fullPath)
    } catch {
      continue
    }
    if (buf.subarray(0, 1000).includes(0)) continue // binary

    const lines = buf.toString('utf8').split('\n')
    let hitsInFile = 0
    for (let i = 0; i < lines.length; i++) {
      const haystack = caseSensitive ? lines[i] : lines[i].toLowerCase()
      if (!haystack.includes(needle)) continue
      results.push(`${node.fullPath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
      hitsInFile++
      if (results.length >= maxResults) {
        truncated = true
        break outer
      }
      if (hitsInFile >= MAX_HITS_PER_FILE) break
    }
  }
  if (budget.remaining <= 0) truncated = true

  if (results.length === 0) return `(no matches for "${query}" under ${root})`
  const note = truncated
    ? '\n(results may be incomplete - narrow the path or query for a fuller search)'
    : ''
  return results.join('\n') + note
}

export async function callFilesystemTool(
  name: string,
  input: Record<string, unknown>
): Promise<string | undefined> {
  switch (name) {
    case 'list_directory':
      return listDirectory(input.path as string | undefined)
    case 'read_text_file': {
      const p = String(input.path ?? '')
      if (!p) return 'path is required'
      return readTextFile(p)
    }
    case 'search_files': {
      const query = String(input.query ?? '')
      if (!query) return 'query is required'
      return searchFiles(query, input.path as string | undefined, input.maxResults)
    }
    case 'search_file_contents': {
      const query = String(input.query ?? '')
      if (!query) return 'query is required'
      return searchFileContents(
        query,
        input.path as string | undefined,
        input.caseSensitive,
        input.maxResults
      )
    }
    default:
      return undefined
  }
}
