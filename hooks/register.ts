import type { Register } from 'claude-code'

// ---- tuning ----
const SHELL_MAX_LINES = 200 // trim shell output beyond this many lines
const SHELL_HEAD = 80 // lines kept from the start
const SHELL_TAIL = 80 // lines kept from the end
const SHELL_MAX_CHARS = 24_000 // also trim when output is this long
const BIG_FILE_LINES = 600 // whole-file reads above this get an outline first
const OUTLINE_MAX = 120 // outline entries shown
const COMPACT_REMIND_AT = [40, 70] // context % thresholds for a reminder
const COMPACT_RESET_BELOW = 25 // re-arm reminders once context drops below this

const BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|pdf|ipynb|zip|gz|exe|dll|woff2?)$/i

// ---- 1. shell output trimming ----
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g

function clean(text: string): string {
  const out: string[] = []
  let last = ''
  let repeats = 0
  for (const raw of text.replace(ANSI, '').split('\n')) {
    // keep only the final state of carriage-return progress bars
    const line = raw.includes('\r') ? (raw.split('\r').filter(s => s.trim()).pop() ?? '') : raw
    if (line === last && line.trim() !== '') {
      repeats++
      continue
    }
    if (repeats > 0) out.push(`  … (previous line repeated ${repeats} more times)`)
    repeats = 0
    out.push(line)
    last = line
  }
  if (repeats > 0) out.push(`  … (previous line repeated ${repeats} more times)`)
  return out.join('\n')
}

function trimmed(text: string, savedAt: string): string {
  const lines = text.split('\n')
  if (lines.length <= SHELL_MAX_LINES && text.length <= SHELL_MAX_CHARS) return text
  let head = lines.slice(0, SHELL_HEAD).join('\n')
  let tail = lines.slice(-SHELL_TAIL).join('\n')
  if (head.length > SHELL_MAX_CHARS / 2) head = head.slice(0, SHELL_MAX_CHARS / 2)
  if (tail.length > SHELL_MAX_CHARS / 2) tail = tail.slice(-SHELL_MAX_CHARS / 2)
  const dropped = Math.max(0, lines.length - SHELL_HEAD - SHELL_TAIL)
  return `${head}\n\n[token-saver: ${dropped} lines omitted out of ${lines.length}. Full output saved at ${savedAt}. Read or grep it if you need the middle.]\n\n${tail}`
}

// ---- 3. outline for large files ----
const OUTLINE = new RegExp(
  [
    String.raw`^\s*(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum|const|let|def|fn|func|impl|struct|trait|module|namespace)\b`,
    String.raw`^\s*(public|private|protected|static|internal)\b.*[({]\s*$`,
    String.raw`^#{1,4}\s`,
    String.raw`^\s*\w[\w.]*\s*[:=]\s*(async\s+)?\(?[\w, ]*\)?\s*=>`,
    String.raw`^\[[^\]]+\]\s*$`,
  ].join('|'),
)

function outline(text: string): string[] {
  const rows: string[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length && rows.length < OUTLINE_MAX; i++) {
    const line = lines[i] ?? ''
    if (OUTLINE.test(line)) rows.push(`${String(i + 1).padStart(6)}  ${line.trim().slice(0, 140)}`)
  }
  return rows
}

let outCounter = 0

async function shellHook($: any, e: any, next: any) {
  const ran = await next(e)
  if (ran.deny !== undefined || ran.isError || !ran.result) return ran
  const r = ran.result as { stdout?: string; stderr?: string; isImage?: boolean }
  if (r.isImage || typeof r.stdout !== 'string') return ran
  const cleaned = clean(r.stdout)
  const lines = cleaned.split('\n').length
  const isBig = lines > SHELL_MAX_LINES || cleaned.length > SHELL_MAX_CHARS
  if (!isBig && cleaned.length >= r.stdout.length * 0.9) return ran
  let stdout = cleaned
  if (isBig) {
    const path = `${$.plugin.root}/.output/${Date.now()}-${++outCounter}.txt`
    try {
      await $.fs.write(path, r.stdout.replace(ANSI, ''))
      stdout = trimmed(cleaned, path)
    } catch {
      stdout = cleaned // could not save the full copy: keep everything
    }
  }
  return { result: { ...r, stdout } }
}

export const register: Register = on => {
  // key -> mtime of the copy the model already holds
  const seen = new Map<string, number>()
  // keys the guard refused once; a second ask goes through
  const refusedOnce = new Set<string>()
  const reminded = new Set<number>()

  on('tool.call', { tool: 'Bash' }, shellHook)
  on('tool.call', { tool: 'PowerShell' }, shellHook)

  // ---- 2 + 3. Read guard ----
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (e.pages || BINARY_EXT.test(e.file_path)) return next(e)
    const stat = await $.fs.stat(e.file_path).catch(() => undefined)
    if (!stat || stat.kind !== 'file') return next(e)

    const key = `${e.file_path.toLowerCase()}|${e.offset ?? ''}|${e.limit ?? ''}`
    const isRetry = refusedOnce.has(key)
    refusedOnce.delete(key)

    // 2. duplicate read of an unchanged file
    if (!isRetry && seen.get(key) === stat.mtimeMs) {
      refusedOnce.add(key)
      return {
        deny:
          `token-saver: ${e.file_path} has not changed since you last read it (same range) in this conversation. ` +
          `Use the copy you already have. If you no longer have it, call Read again with the same arguments and it will go through.`,
      }
    }

    // 3. whole read of a large file
    const isWhole = e.offset === undefined && e.limit === undefined && !e.allow_large
    if (!isRetry && isWhole && stat.size > 20_000) {
      const text = await $.fs.read(e.file_path).catch(() => undefined)
      const total = typeof text === 'string' ? text.split('\n').length : 0
      if (typeof text === 'string' && total > BIG_FILE_LINES) {
        refusedOnce.add(key)
        const rows = outline(text)
        return {
          deny:
            `token-saver: ${e.file_path} has ${total} lines. Outline (line number, then the line):\n` +
            (rows.length ? rows.join('\n') : '  (no recognizable structure)') +
            `\n\nRead only the part you need with offset and limit. If you really need the whole file, call Read again with the same arguments and it will go through.`,
        }
      }
    }

    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) seen.set(key, stat.mtimeMs)
    return ran
  })

  // the model loses its copies when the conversation is compacted
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (!('skip' in done && done.skip)) {
      seen.clear()
      refusedOnce.clear()
    }
    return done
  })

  // ---- 4. compact reminder ----
  on('session.measure', ($, e, next) => {
    const pct = e.context.percent
    if (pct !== undefined) {
      if (pct < COMPACT_RESET_BELOW) reminded.clear()
      const hit = [...COMPACT_REMIND_AT].reverse().find(t => pct >= t && !reminded.has(t))
      if (hit !== undefined) {
        for (const t of COMPACT_REMIND_AT) if (t <= hit) reminded.add(t)
        $.ui.toast(`Context is ${pct}% full. Consider /compact (or /clear if you're switching tasks).`)
      }
    }
    return next(e)
  })
}
