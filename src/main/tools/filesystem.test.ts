import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { callFilesystemTool, filesystemToolDefinitions } from './filesystem'

let sandbox: string

async function write(relPath: string, content: string): Promise<string> {
  const full = path.join(sandbox, relPath)
  await fsp.mkdir(path.dirname(full), { recursive: true })
  await fsp.writeFile(full, content)
  return full
}

beforeEach(async () => {
  sandbox = await fsp.mkdtemp(path.join(os.tmpdir(), 'verity-fs-test-'))
})

afterEach(async () => {
  await fsp.rm(sandbox, { recursive: true, force: true })
})

describe('filesystemToolDefinitions', () => {
  it('declares all four read-only tools', () => {
    const names = filesystemToolDefinitions().map((t) => t.name)
    expect(names).toEqual([
      'list_directory',
      'read_text_file',
      'search_files',
      'search_file_contents'
    ])
  })
})

describe('list_directory', () => {
  it('lists directories before files, alphabetically within each group', async () => {
    await write('b.txt', 'x')
    await write('a.txt', 'x')
    await write('zdir/inner.txt', 'x')
    await write('adir/inner.txt', 'x')

    const result = await callFilesystemTool('list_directory', { path: sandbox })
    const lines = (result as string).split('\n').slice(1)
    expect(lines).toEqual(['[dir] adir', '[dir] zdir', '[file] a.txt', '[file] b.txt'])
  })

  it('reports an empty directory distinctly', async () => {
    const result = await callFilesystemTool('list_directory', { path: sandbox })
    expect(result).toBe(`${sandbox} is empty.`)
  })

  it('caps output at 200 entries with a count of the rest', async () => {
    for (let i = 0; i < 205; i++) await write(`file-${String(i).padStart(3, '0')}.txt`, 'x')
    const result = (await callFilesystemTool('list_directory', { path: sandbox })) as string
    expect(result).toContain('...and 5 more')
    expect(result.split('\n')).toHaveLength(1 + 200 + 1)
  })

  it('returns a friendly error for a path that does not exist', async () => {
    const result = (await callFilesystemTool('list_directory', {
      path: path.join(sandbox, 'nope')
    })) as string
    expect(result).toContain('Could not list')
  })

  it('defaults to the home directory when no path is given', async () => {
    const result = (await callFilesystemTool('list_directory', {})) as string
    expect(result.startsWith(os.homedir())).toBe(true)
  })
})

describe('read_text_file', () => {
  it('reads a small text file in full', async () => {
    await write('hello.txt', 'hello world')
    const result = await callFilesystemTool('read_text_file', {
      path: path.join(sandbox, 'hello.txt')
    })
    expect(result).toBe('hello world')
  })

  it('requires a path', async () => {
    const result = await callFilesystemTool('read_text_file', {})
    expect(result).toBe('path is required')
  })

  it('refuses files that look like credentials', async () => {
    const file = await write('.env', 'SECRET=abc123')
    const result = (await callFilesystemTool('read_text_file', { path: file })) as string
    expect(result).toContain('Refusing to read')
  })

  it('refuses a file under a sensitive directory name', async () => {
    const file = await write('.ssh/id_rsa', 'not a real key')
    const result = (await callFilesystemTool('read_text_file', { path: file })) as string
    expect(result).toContain('Refusing to read')
  })

  it.each([
    'Library/Keychains/login.keychain-db',
    'project/server.pem',
    '.mozilla/firefox/abc/logins.json',
    'work/.kube/config',
    'app/wp-config.php',
    'backups/.aws/old-credentials'
  ])('refuses %s as credential-shaped', async (rel) => {
    const file = await write(rel, 'secret')
    const result = (await callFilesystemTool('read_text_file', { path: file })) as string
    expect(result).toContain('Refusing to read')
  })

  it('refuses a symlink that resolves to a sensitive file', async () => {
    const realSecret = await write('.ssh/id_ed25519', 'KEY')
    const link = path.join(sandbox, 'notes-pointer.txt')
    try {
      await fsp.symlink(realSecret, link)
    } catch {
      return // symlink creation not permitted (e.g. Windows without privilege) - skip
    }
    const result = (await callFilesystemTool('read_text_file', { path: link })) as string
    expect(result).toContain('Refusing to read')
  })

  it('redirects to list_directory for a directory path', async () => {
    await write('somedir/inner.txt', 'x')
    const result = (await callFilesystemTool('read_text_file', {
      path: path.join(sandbox, 'somedir')
    })) as string
    expect(result).toContain('use list_directory instead')
  })

  it('refuses to display an obviously binary file', async () => {
    const file = path.join(sandbox, 'binary.bin')
    await fsp.writeFile(file, Buffer.from([0x48, 0x65, 0x00, 0x6c, 0x6c, 0x6f]))
    const result = (await callFilesystemTool('read_text_file', { path: file })) as string
    expect(result).toContain('looks like a binary file')
  })

  it('truncates a file past 50KB and notes the original size', async () => {
    const file = await write('big.txt', 'a'.repeat(60 * 1024))
    const result = (await callFilesystemTool('read_text_file', { path: file })) as string
    expect(result).toContain('...[truncated - showing first 50KB of 60.0KB]')
    expect(result.length).toBeLessThan(60 * 1024)
  })

  it('returns a friendly error for a missing file', async () => {
    const result = (await callFilesystemTool('read_text_file', {
      path: path.join(sandbox, 'nope.txt')
    })) as string
    expect(result).toContain('Could not read')
  })
})

describe('search_files', () => {
  it('finds files and directories by case-insensitive substring match', async () => {
    await write('invoices/march-INVOICE.txt', 'x')
    await write('notes/todo.txt', 'x')
    const result = (await callFilesystemTool('search_files', {
      query: 'invoice',
      path: sandbox
    })) as string
    expect(result).toContain('[file]')
    expect(result).toContain('march-INVOICE.txt')
    expect(result).toContain('[dir]')
    expect(result).toContain('invoices')
    expect(result).not.toContain('todo.txt')
  })

  it('requires a query', async () => {
    const result = await callFilesystemTool('search_files', { path: sandbox })
    expect(result).toBe('query is required')
  })

  it('prunes noisy directories like node_modules', async () => {
    await write('node_modules/some-invoice-pkg/index.js', 'x')
    await write('src/invoice.js', 'x')
    const result = (await callFilesystemTool('search_files', {
      query: 'invoice',
      path: sandbox
    })) as string
    expect(result).toContain('invoice.js')
    expect(result).not.toContain('node_modules')
  })

  it('excludes matches under a sensitive path', async () => {
    await write('.aws/credentials-invoice-backup', 'x')
    const result = (await callFilesystemTool('search_files', {
      query: 'invoice',
      path: sandbox
    })) as string
    expect(result).toBe(`(no files matching "invoice" found under ${sandbox})`)
  })

  it('caps results at maxResults and notes it may be incomplete', async () => {
    for (let i = 0; i < 5; i++) await write(`match-${i}.txt`, 'x')
    const result = (await callFilesystemTool('search_files', {
      query: 'match',
      path: sandbox,
      maxResults: 2
    })) as string
    const fileLines = result.split('\n').filter((l) => l.startsWith('[file]'))
    expect(fileLines).toHaveLength(2)
    expect(result).toContain('may be incomplete')
  })

  it('reports no matches clearly', async () => {
    await write('a.txt', 'x')
    const result = await callFilesystemTool('search_files', { query: 'zzz', path: sandbox })
    expect(result).toBe(`(no files matching "zzz" found under ${sandbox})`)
  })
})

describe('search_file_contents', () => {
  it('finds a literal substring and reports file:line: snippet', async () => {
    await write('a.txt', 'first line\nsecond line with NEEDLE here\nthird')
    const result = (await callFilesystemTool('search_file_contents', {
      query: 'NEEDLE',
      path: sandbox
    })) as string
    expect(result).toContain(`${path.join(sandbox, 'a.txt')}:2:`)
    expect(result).toContain('second line with NEEDLE here')
  })

  it('requires a query', async () => {
    const result = await callFilesystemTool('search_file_contents', { path: sandbox })
    expect(result).toBe('query is required')
  })

  it('is case-insensitive by default', async () => {
    await write('a.txt', 'has NeEdLe in it')
    const result = await callFilesystemTool('search_file_contents', {
      query: 'needle',
      path: sandbox
    })
    expect(result).toContain('has NeEdLe in it')
  })

  it('honors caseSensitive: true', async () => {
    await write('a.txt', 'has NeEdLe in it')
    const result = await callFilesystemTool('search_file_contents', {
      query: 'needle',
      path: sandbox,
      caseSensitive: true
    })
    expect(result).toBe(`(no matches for "needle" under ${sandbox})`)
  })

  it('skips binary files instead of matching inside them', async () => {
    const file = path.join(sandbox, 'binary.bin')
    await fsp.writeFile(
      file,
      Buffer.concat([Buffer.from('NEEDLE'), Buffer.from([0x00]), Buffer.from('more')])
    )
    const result = await callFilesystemTool('search_file_contents', {
      query: 'NEEDLE',
      path: sandbox
    })
    expect(result).toBe(`(no matches for "NEEDLE" under ${sandbox})`)
  })

  it('skips files larger than the content-scan cap', async () => {
    await write('huge.txt', `NEEDLE\n${'a'.repeat(2 * 1024 * 1024 + 100)}`)
    const result = await callFilesystemTool('search_file_contents', {
      query: 'NEEDLE',
      path: sandbox
    })
    expect(result).toBe(`(no matches for "NEEDLE" under ${sandbox})`)
  })

  it('caps hits per file at 5', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i} has NEEDLE`)
    await write('many.txt', lines.join('\n'))
    const result = (await callFilesystemTool('search_file_contents', {
      query: 'NEEDLE',
      path: sandbox
    })) as string
    const matchCount = result.split('\n').filter((l) => l.includes('NEEDLE')).length
    expect(matchCount).toBe(5)
  })

  it('excludes sensitive files from content search', async () => {
    await write('.env', 'SECRET_KEY=NEEDLE')
    const result = await callFilesystemTool('search_file_contents', {
      query: 'NEEDLE',
      path: sandbox
    })
    expect(result).toBe(`(no matches for "NEEDLE" under ${sandbox})`)
  })

  it('reports no matches clearly', async () => {
    await write('a.txt', 'nothing interesting here')
    const result = await callFilesystemTool('search_file_contents', { query: 'zzz', path: sandbox })
    expect(result).toBe(`(no matches for "zzz" under ${sandbox})`)
  })
})

describe('callFilesystemTool', () => {
  it('returns undefined for an unrelated tool name', async () => {
    const result = await callFilesystemTool('get_current_time', {})
    expect(result).toBeUndefined()
  })
})
