import { describe, it, expect } from 'vitest'
import {
  parseFilenameDate,
  parseProject,
  shouldInclude,
  parseGitLog,
  formatEdited,
  buildEntries,
  formatTable,
  type ThoughtEntry,
} from './latest.js'

describe('parseFilenameDate()', () => {
  it('parses the YYYY-MM-DD-slug shape', () => {
    expect(parseFilenameDate('2025-11-18-thoughts-subdirectory-structure.md')).toEqual({
      fileDate: '2025-11-18',
      name: 'thoughts-subdirectory-structure',
    })
  })

  it('parses the YYYY-MM-DD_HH-MM-SS_slug shape', () => {
    expect(parseFilenameDate('2026-08-11_12-27-07_call-lifecycle-slice-1-to-slice-2.md')).toEqual({
      fileDate: '2026-08-11',
      name: 'call-lifecycle-slice-1-to-slice-2',
    })
  })

  it('returns a blank date when there is no prefix', () => {
    expect(parseFilenameDate('feature_template.md')).toEqual({
      fileDate: '',
      name: 'feature_template',
    })
  })

  it('does not mistake a leading sequence number for a date', () => {
    expect(parseFilenameDate('03-upstream-smart-turn-path-deprecation.md')).toEqual({
      fileDate: '',
      name: '03-upstream-smart-turn-path-deprecation',
    })
  })

  it('keeps ticket identifiers in the name', () => {
    expect(parseFilenameDate('2026-02-12-NUM-62-fifo-tts-correlation-desync.md')).toEqual({
      fileDate: '2026-02-12',
      name: 'NUM-62-fifo-tts-correlation-desync',
    })
  })

  it('rejects an out-of-range date rather than stripping it', () => {
    expect(parseFilenameDate('2026-13-45-not-a-real-date.md')).toEqual({
      fileDate: '',
      name: '2026-13-45-not-a-real-date',
    })
  })
})

describe('parseProject()', () => {
  it('extracts the project from a repos/ path', () => {
    expect(parseProject('repos/humanlayer/shared/research/a.md', 'repos', 'global')).toBe('humanlayer')
  })

  it('labels global/ documents as global', () => {
    expect(parseProject('global/itissid/truenas/a.md', 'repos', 'global')).toBe('global')
  })

  it('returns null for a repos/ path with no document under the project', () => {
    expect(parseProject('repos/humanlayer', 'repos', 'global')).toBeNull()
  })

  it('returns null for paths outside repos/ and global/', () => {
    expect(parseProject('.github/workflows/claude.yml', 'repos', 'global')).toBeNull()
  })

  it('honours custom reposDir and globalDir names', () => {
    expect(parseProject('projects/acme/shared/a.md', 'projects', 'notes')).toBe('acme')
    expect(parseProject('notes/shared/a.md', 'projects', 'notes')).toBe('global')
  })
})

describe('shouldInclude()', () => {
  it('includes ordinary markdown thoughts', () => {
    expect(shouldInclude('repos/humanlayer/shared/research/2025-11-18-a.md')).toBe(true)
  })

  it('excludes non-markdown files', () => {
    expect(shouldInclude('repos/therapro-demo/chris/devops/abc.jsonl')).toBe(false)
    expect(shouldInclude('repos/therapro-demo/chris/devops/abc.meta.json')).toBe(false)
    expect(shouldInclude('repos/therapro-demo/shared/project_documentation/a.xlsx')).toBe(false)
    expect(shouldInclude('repos/therapro-demo/shared/project_documentation/s/a.png')).toBe(false)
  })

  it('excludes the generated searchable index at the repo root', () => {
    expect(
      shouldInclude(
        'searchable/repos/therapro-demo/shared/handoffs/NUM-42/2026-02-26_04-52-54_NUM-42_recording-upload-debug.md',
      ),
    ).toBe(false)
  })

  it('excludes a searchable index nested anywhere in the tree', () => {
    expect(shouldInclude('repos/humanlayer/searchable/shared/research/a.md')).toBe(false)
  })

  it('excludes READMEs and templates', () => {
    expect(shouldInclude('repos/humanlayer/README.md')).toBe(false)
    expect(shouldInclude('global/README.md')).toBe(false)
    expect(shouldInclude('repos/therapro-demo/shared/requirements/feature_template.md')).toBe(false)
  })
})

describe('parseGitLog()', () => {
  const log = [
    'aaa1111 2026-08-11T12:30:06+00:00',
    '',
    'repos/therapro-demo/shared/handoffs/general/2026-08-11_12-27-07_x.md',
    '',
    'bbb2222 2026-08-11T04:15:44+00:00',
    '',
    'repos/therapro-demo/shared/handoffs/general/2026-08-11_12-27-07_x.md',
    'repos/humanlayer/shared/plans/2026-08-01-y.md',
    '',
  ].join('\n')

  it('records the most recent commit that touched each path', () => {
    const result = parseGitLog(log)
    expect(result.get('repos/therapro-demo/shared/handoffs/general/2026-08-11_12-27-07_x.md')).toEqual({
      commit: 'aaa1111',
      date: '2026-08-11T12:30:06+00:00',
    })
  })

  it('still records paths first seen in an older commit', () => {
    const result = parseGitLog(log)
    expect(result.get('repos/humanlayer/shared/plans/2026-08-01-y.md')).toEqual({
      commit: 'bbb2222',
      date: '2026-08-11T04:15:44+00:00',
    })
  })

  it('keys strictly by path, so one document yields one entry', () => {
    expect(parseGitLog(log).size).toBe(2)
  })

  it('tolerates commits that touch no files', () => {
    const empty = [
      'aaa1111 2026-08-11T12:30:06+00:00',
      '',
      'bbb2222 2026-08-10T12:30:06+00:00',
      '',
      'repos/a/shared/b.md',
      '',
    ].join('\n')
    expect(parseGitLog(empty).size).toBe(1)
  })

  it('returns an empty map for empty output', () => {
    expect(parseGitLog('').size).toBe(0)
  })
})

describe('formatEdited()', () => {
  it('renders the committer-local date and time without timezone shifting', () => {
    expect(formatEdited('2026-08-11T12:30:06+00:00')).toBe('2026-08-11 12:30')
    expect(formatEdited('2026-02-26T04:52:54-05:00')).toBe('2026-02-26 04:52')
  })
})

describe('buildEntries() — dedup semantics', () => {
  const reposDir = 'repos'
  const globalDir = 'global'

  it('keeps a plan and its research doc as separate rows despite the shared basename', () => {
    const plan = 'repos/humanlayer/shared/plans/2026-07-08-add-fable5-model-to-wui.md'
    const research = 'repos/humanlayer/shared/research/2026-07-08-add-fable5-model-to-wui.md'
    const lastTouched = new Map([
      [plan, { commit: 'aaa', date: '2026-07-08T10:00:00+00:00' }],
      [research, { commit: 'bbb', date: '2026-07-08T09:00:00+00:00' }],
    ])
    const alive = new Set([plan, research])

    const entries = buildEntries(lastTouched, alive, reposDir, globalDir)

    expect(entries.map(e => e.relPath).sort()).toEqual([plan, research].sort())
    expect(entries).toHaveLength(2)
  })

  it('keeps the same-named research doc filed under two projects as separate rows', () => {
    const hl = 'repos/humanlayer/shared/research/2026-04-15-wui-file-suggestions-controls.md'
    const tp = 'repos/therapro-demo/shared/research/2026-04-15-wui-file-suggestions-controls.md'
    const lastTouched = new Map([
      [hl, { commit: 'aaa', date: '2026-04-15T10:00:00+00:00' }],
      [tp, { commit: 'bbb', date: '2026-04-15T09:00:00+00:00' }],
    ])

    const entries = buildEntries(lastTouched, new Set([hl, tp]), reposDir, globalDir)

    expect(entries).toHaveLength(2)
    expect(entries.map(e => e.project).sort()).toEqual(['humanlayer', 'therapro-demo'])
  })

  it('drops the searchable twin while keeping the canonical document', () => {
    const canonical =
      'repos/therapro-demo/shared/handoffs/NUM-42/2026-02-26_04-52-54_NUM-42_recording-upload-debug.md'
    const twin = `searchable/${canonical}`
    const lastTouched = new Map([
      [canonical, { commit: 'aaa', date: '2026-02-26T04:52:54+00:00' }],
      [twin, { commit: 'aaa', date: '2026-02-26T04:52:54+00:00' }],
    ])

    const entries = buildEntries(lastTouched, new Set([canonical, twin]), reposDir, globalDir)

    expect(entries).toHaveLength(1)
    expect(entries[0].relPath).toBe(canonical)
  })

  it('drops paths that no longer exist in the tree', () => {
    const gone = 'repos/humanlayer/shared/research/2026-01-01-deleted.md'
    const lastTouched = new Map([[gone, { commit: 'aaa', date: '2026-01-01T00:00:00+00:00' }]])

    expect(buildEntries(lastTouched, new Set(), reposDir, globalDir)).toHaveLength(0)
  })

  it('sorts most-recently-edited first regardless of git log ordering', () => {
    const older = 'repos/a/shared/research/2026-01-01-older.md'
    const newer = 'repos/a/shared/research/2026-01-02-newer.md'
    const lastTouched = new Map([
      [older, { commit: 'aaa', date: '2026-01-01T00:00:00+00:00' }],
      [newer, { commit: 'bbb', date: '2026-06-01T00:00:00+00:00' }],
    ])

    const entries = buildEntries(lastTouched, new Set([older, newer]), reposDir, globalDir)

    expect(entries.map(e => e.name)).toEqual(['newer', 'older'])
  })

  it('sorts correctly across differing timezone offsets', () => {
    // 12:00+00:00 is an hour LATER than 12:00+02:00, which naive string sorting gets wrong.
    const utc = 'repos/a/shared/research/2026-01-01-utc.md'
    const berlin = 'repos/a/shared/research/2026-01-01-berlin.md'
    const lastTouched = new Map([
      [berlin, { commit: 'bbb', date: '2026-01-01T12:00:00+02:00' }],
      [utc, { commit: 'aaa', date: '2026-01-01T12:00:00+00:00' }],
    ])

    const entries = buildEntries(lastTouched, new Set([utc, berlin]), reposDir, globalDir)

    expect(entries.map(e => e.name)).toEqual(['utc', 'berlin'])
  })
})

describe('formatTable()', () => {
  const entries: ThoughtEntry[] = [
    {
      relPath: 'repos/humanlayer/shared/research/2025-11-18-a.md',
      name: 'a',
      project: 'humanlayer',
      fileDate: '2025-11-18',
      commit: 'aaa',
      editedAt: '2026-08-11T12:30:06+00:00',
    },
    {
      relPath: 'global/itissid/truenas/notes.md',
      name: 'notes',
      project: 'global',
      fileDate: '',
      commit: 'bbb',
      editedAt: '2026-08-10T09:05:00+00:00',
    },
  ]

  it('emits a header and one row per entry', () => {
    const lines = formatTable(entries).split('\n')
    expect(lines[0]).toContain('NAME')
    expect(lines[0]).toContain('PROJECT')
    expect(lines[0]).toContain('DATE')
    expect(lines[0]).toContain('EDITED')
    expect(lines).toHaveLength(3)
  })

  it('renders a blank date column for undated documents', () => {
    const row = formatTable(entries).split('\n')[2]
    expect(row).toContain('notes')
    expect(row).toContain('global')
    expect(row).not.toContain('2026-08-10T')
    expect(row).toContain('2026-08-10 09:05')
  })

  it('reports when there is nothing to show', () => {
    expect(formatTable([])).toContain('No thoughts found')
  })
})
