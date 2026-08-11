import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import chalk from 'chalk'
import wrapAnsi from 'wrap-ansi'
import { loadThoughtsConfig, expandPath } from '../../thoughtsConfig.js'

export interface ThoughtEntry {
  /** Path relative to the thoughts repo root. Unique per document, so it is the dedup key. */
  relPath: string
  /** Filename with the .md extension stripped. The date prefix is retained. */
  name: string
  /** Project the document belongs to, or 'global'. */
  project: string
  /** Containing category folder (research, plans, tickets, …), or '' when uncategorized. */
  kind: string
  /** Tags from the document's YAML frontmatter. Empty when absent or unreadable. */
  tags: string[]
  /** Date parsed from the filename prefix, or '' when the filename carries no date. */
  fileDate: string
  /** Full sha of the most recent commit touching relPath. */
  commit: string
  /** ISO committer date of that commit. */
  editedAt: string
}

const NAME_WIDTH = 52
const PROJECT_WIDTH = 16
const KIND_WIDTH = 14
const TAGS_WIDTH = 28
const DATE_WIDTH = 10
const DEFAULT_LIMIT = 20

/**
 * Frontmatter is a small header, so each document is read as a bounded prefix rather than in
 * full. 8 KiB clears the largest frontmatter block in the corpus with room to spare; a document
 * whose frontmatter somehow exceeds it reports no tags rather than risking a bad parse.
 */
const FRONTMATTER_READ_BYTES = 8192

/** Timestamps are normalized to one zone so rows committed from different machines compare. */
const DISPLAY_TIMEZONE = 'America/New_York'

/**
 * Reads the leading date off a thoughts filename, if it has one.
 *
 * Two shapes are in use: `2025-11-18-slug.md` and `2026-08-11_12-27-07_slug.md`. Anything else
 * (`feature_template.md`, `03-upstream-foo.md`) reports no date.
 */
export function parseFilenameDate(basename: string): string {
  const stem = basename.replace(/\.md$/i, '')
  const match = stem.match(/^(\d{4})-(\d{2})-(\d{2})(?:_\d{2}-\d{2}-\d{2})?[-_]/)

  if (!match) {
    return ''
  }

  const [, year, month, day] = match
  if (!isRealDate(Number(year), Number(month), Number(day))) {
    return ''
  }

  return `${year}-${month}-${day}`
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * Derives the owning project from a thoughts-repo-relative path.
 *
 * Worktrees never affect this: `sync` normalizes every worktree path to the same
 * `<reposDir>/<project>/` directory before writing, so a document has exactly one path here.
 */
export function parseProject(relPath: string, reposDir: string, globalDir: string): string | null {
  const segments = relPath.split('/')

  if (segments[0] === globalDir && segments.length >= 2) {
    return 'global'
  }

  if (segments[0] === reposDir && segments.length >= 3) {
    return segments[1]
  }

  return null
}

/**
 * Reads the category folder a document is filed under — research, plans, tickets, handoffs, …
 *
 * The category sits directly after the `user|shared` segment:
 *   repos/<project>/<user|shared>/<kind>/…/<file>.md
 *   global/<user|shared>/<kind>/…/<file>.md
 *
 * A handful of documents sit directly under the user or shared segment with no category folder;
 * the length guard keeps those from reporting their own filename as a kind.
 */
export function parseKind(relPath: string, reposDir: string, globalDir: string): string {
  const segments = relPath.split('/')

  if (segments[0] === reposDir && segments.length > 4) {
    return segments[3]
  }

  if (segments[0] === globalDir && segments.length > 3) {
    return segments[2]
  }

  return ''
}

/**
 * Filters the thoughts repo down to actual thoughts documents.
 *
 * `searchable/` holds hard-link copies of canonical documents that `sync` regenerates on every
 * run. One such copy was committed by accident in the past, so excluding it here keeps a future
 * stray from silently showing up as a duplicate row.
 */
export function shouldInclude(relPath: string): boolean {
  if (!relPath.toLowerCase().endsWith('.md')) {
    return false
  }

  const segments = relPath.split('/')
  if (segments.includes('searchable')) {
    return false
  }

  const basename = segments[segments.length - 1]
  if (basename === 'README.md' || basename.endsWith('_template.md')) {
    return false
  }

  return true
}

/**
 * Reduces a `git log --name-only --format='%H %cI'` stream to the last commit per path.
 *
 * git emits commits newest-first, so the first time a path appears is the most recent commit
 * that touched it — which is both its last-edited date and the sha a permalink needs.
 */
export function parseGitLog(stdout: string): Map<string, { commit: string; date: string }> {
  const lastTouched = new Map<string, { commit: string; date: string }>()
  let commit = ''
  let date = ''

  for (const line of stdout.split('\n')) {
    if (!line) {
      continue
    }

    const header = line.match(/^([0-9a-f]{4,40}) (\d{4}-\d{2}-\d{2}T\S+)$/)
    if (header) {
      commit = header[1]
      date = header[2]
      continue
    }

    if (commit && !lastTouched.has(line)) {
      lastTouched.set(line, { commit, date })
    }
  }

  return lastTouched
}

/**
 * Extracts tags from a document's YAML frontmatter.
 *
 * Scoped strictly to the leading `---` fence, never searched document-wide. A bare `^tags:`
 * match would pick up prose and code: one plan contains the TypeScript line
 * `tags: {} as 'bot_conversation' | ...` inside a fenced code block, which is not metadata.
 *
 * Only the inline flow form (`tags: [a, b, c]`) occurs in the corpus; anything else — no
 * frontmatter, no closing fence, no `tags:` key, or a form we do not recognize — yields no tags,
 * leaving the document listed with an empty cell.
 */
export function parseTags(fileContents: string): string[] {
  const lines = fileContents.split('\n').map(line => line.replace(/\r$/, ''))

  if (lines[0]?.trim() !== '---') {
    return []
  }

  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closing === -1) {
    return []
  }

  const tagLine = lines.slice(1, closing).find(line => /^tags:/.test(line))
  const match = tagLine?.match(/^tags:\s*\[(.*)\]\s*$/)
  if (!match) {
    return []
  }

  return match[1]
    .split(',')
    .map(tag => tag.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

/** Reads the head of a file, returning '' if it cannot be opened. */
function readFileHead(filePath: string): string {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(FRONTMATTER_READ_BYTES)
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd)
    }
  }
}

/**
 * Populates tags for the entries about to be displayed.
 *
 * Called after the limit is applied, so a default run touches ~20 files rather than every
 * document in the repo, keeping the git walk the dominant cost.
 */
export function attachTags(repo: string, entries: ThoughtEntry[]): ThoughtEntry[] {
  return entries.map(entry => ({
    ...entry,
    tags: parseTags(readFileHead(path.join(repo, entry.relPath))),
  }))
}

/**
 * Renders an ISO committer date as `Aug  8 2026 03:34 PM`, converted to Eastern Time.
 *
 * Every row is normalized to one zone: a commit made from a machine in another timezone would
 * otherwise print its own wall-clock, so times could not be compared down the column. The named
 * zone (rather than a fixed offset) means EST and EDT rows are both correct.
 *
 * Assembled from parts because en-US otherwise injects commas ('Aug 11, 2026, 08:30 AM'). The
 * day is space-padded to two so the field is a fixed 20 characters.
 */
export function formatEdited(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DISPLAY_TIMEZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(iso))

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? ''

  const day = get('day').padStart(2, ' ')
  return `${get('month')} ${day} ${get('year')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}`
}

/**
 * Turns the git walk into sorted, displayable entries.
 *
 * `alive` is the set of paths still present in the tree, which drops documents deleted in an
 * earlier commit. Entries are keyed by path only: two documents sharing a basename (a plan and
 * its research doc, or the same note filed under two projects) are genuinely distinct and both
 * survive.
 */
export function buildEntries(
  lastTouched: Map<string, { commit: string; date: string }>,
  alive: Set<string>,
  reposDir: string,
  globalDir: string,
): ThoughtEntry[] {
  const entries: ThoughtEntry[] = []

  for (const [relPath, { commit, date }] of lastTouched) {
    if (!alive.has(relPath) || !shouldInclude(relPath)) {
      continue
    }

    const project = parseProject(relPath, reposDir, globalDir)
    if (!project) {
      continue
    }

    const basename = relPath.split('/').pop()!
    entries.push({
      relPath,
      name: basename.replace(/\.md$/i, ''),
      project,
      kind: parseKind(relPath, reposDir, globalDir),
      tags: [],
      fileDate: parseFilenameDate(basename),
      commit,
      editedAt: date,
    })
  }

  // Sort on parsed timestamps, not the raw strings: ISO dates carrying different UTC offsets
  // do not compare correctly as text. Ties break on path so output is stable run to run.
  return entries.sort((a, b) => {
    const delta = Date.parse(b.editedAt) - Date.parse(a.editedAt)
    return delta !== 0 ? delta : a.relPath.localeCompare(b.relPath)
  })
}

function fit(value: string, width: number): string {
  if (value.length <= width) {
    return value.padEnd(width)
  }
  return `${value.slice(0, width - 1)}…`
}

export function formatTable(entries: ThoughtEntry[]): string {
  if (entries.length === 0) {
    return 'No thoughts found.'
  }

  const header = [
    'NAME'.padEnd(NAME_WIDTH),
    'PROJECT'.padEnd(PROJECT_WIDTH),
    'KIND'.padEnd(KIND_WIDTH),
    'TAGS'.padEnd(TAGS_WIDTH),
    'DATE'.padEnd(DATE_WIDTH),
    'EDITED (ET)',
  ].join('  ')

  // Continuation lines for wrapped tags line up under the TAGS column.
  const tagsIndent = ' '.repeat(NAME_WIDTH + 2 + PROJECT_WIDTH + 2 + KIND_WIDTH + 2)

  const blocks = entries.map(entry => {
    // `hard` also breaks a single tag longer than the column, which plain wrapping would
    // otherwise let overflow.
    const tagLines = entry.tags.length
      ? wrapAnsi(entry.tags.join(', '), TAGS_WIDTH, { hard: true }).split('\n')
      : ['']

    const head = [
      fit(entry.name, NAME_WIDTH),
      fit(entry.project, PROJECT_WIDTH),
      fit(entry.kind, KIND_WIDTH),
      tagLines[0].padEnd(TAGS_WIDTH),
      entry.fileDate.padEnd(DATE_WIDTH),
      formatEdited(entry.editedAt),
    ].join('  ')

    return [head, ...tagLines.slice(1).map(line => tagsIndent + line)]
      .map(line => line.trimEnd())
      .join('\n')
  })

  return [header, ...blocks].join('\n\n')
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  })
}

interface LatestOptions {
  configFile?: string
  limit?: string
}

export async function thoughtsLatestCommand(options: LatestOptions): Promise<void> {
  try {
    const config = loadThoughtsConfig(options as Record<string, unknown>)

    if (!config) {
      console.error(chalk.red('Error: Thoughts not configured. Run "humanlayer thoughts init" first.'))
      process.exit(1)
    }

    // Read the repo location from config rather than deriving it from cwd: this is what makes
    // one binary work unchanged on devbox (/home/dev/...) and the Mac (/Users/...), and what
    // makes the command independent of which project or worktree you invoke it from.
    const repo = expandPath(config.thoughtsRepo)

    if (!fs.existsSync(path.join(repo, '.git'))) {
      console.error(chalk.red(`Error: Thoughts repository is not a git repository: ${repo}`))
      process.exit(1)
    }

    let logOutput: string
    let treeOutput: string
    try {
      logOutput = git(repo, ['log', 'HEAD', '--name-only', '--no-renames', '--format=%H %cI'])
      treeOutput = git(repo, ['ls-tree', '-r', '--name-only', 'HEAD'])
    } catch {
      console.error(chalk.red(`Error: Could not read git history in ${repo} (no commits yet?)`))
      process.exit(1)
      return
    }

    const alive = new Set(treeOutput.split('\n').filter(Boolean))
    const entries = buildEntries(parseGitLog(logOutput), alive, config.reposDir, config.globalDir)

    const limit = Number(options.limit ?? DEFAULT_LIMIT)
    if (!Number.isFinite(limit) || limit < 1) {
      console.error(chalk.red(`Error: --limit must be a positive number, got "${options.limit}"`))
      process.exit(1)
    }

    // Tags come from file contents, so they are read only for the rows actually shown.
    console.log(formatTable(attachTags(repo, entries.slice(0, limit))))
  } catch (error) {
    console.error(chalk.red(`Error listing thoughts: ${error}`))
    process.exit(1)
  }
}
