import { describe, it, expect } from 'vitest'
import {
  parseFilenameDate,
  parseProject,
  parseKind,
  shouldInclude,
  parseGitLog,
  parseTags,
  formatEdited,
  buildEntries,
  formatTable,
  type ThoughtEntry,
} from './latest.js'

describe('parseFilenameDate()', () => {
  it('parses the YYYY-MM-DD-slug shape', () => {
    expect(parseFilenameDate('2025-11-18-thoughts-subdirectory-structure.md')).toBe('2025-11-18')
  })

  it('parses the YYYY-MM-DD_HH-MM-SS_slug shape', () => {
    expect(parseFilenameDate('2026-08-11_12-27-07_call-lifecycle-slice-1-to-slice-2.md')).toBe(
      '2026-08-11',
    )
  })

  it('returns blank when there is no prefix', () => {
    expect(parseFilenameDate('feature_template.md')).toBe('')
  })

  it('does not mistake a leading sequence number for a date', () => {
    expect(parseFilenameDate('03-upstream-smart-turn-path-deprecation.md')).toBe('')
  })

  it('parses a date that precedes a ticket identifier', () => {
    expect(parseFilenameDate('2026-02-12-NUM-62-fifo-tts-correlation-desync.md')).toBe('2026-02-12')
  })

  it('rejects an out-of-range date', () => {
    expect(parseFilenameDate('2026-13-45-not-a-real-date.md')).toBe('')
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

describe('parseKind()', () => {
  it('reads the category folder under a repos/ project', () => {
    expect(parseKind('repos/humanlayer/shared/research/2025-11-18-a.md', 'repos', 'global')).toBe(
      'research',
    )
    expect(parseKind('repos/humanlayer/shared/plans/2026-07-08-a.md', 'repos', 'global')).toBe('plans')
  })

  it('reads the category from a personal directory too', () => {
    expect(parseKind('repos/therapro-demo/chris/notes/2026-06-19-a.md', 'repos', 'global')).toBe(
      'notes',
    )
  })

  it('reports the top-level category for deeply nested documents', () => {
    expect(
      parseKind(
        'repos/therapro-demo/shared/tickets/local/eval-harness-v1/issues/01-a.md',
        'repos',
        'global',
      ),
    ).toBe('tickets')
  })

  it('reads the category under global/', () => {
    expect(parseKind('global/itissid/truenas/truenas_config.md', 'repos', 'global')).toBe('truenas')
    expect(parseKind('global/shared/research/a.md', 'repos', 'global')).toBe('research')
  })

  it('returns blank when the document sits directly under the user or shared segment', () => {
    expect(parseKind('repos/therapro-demo/itissid/cheatsheet.md', 'repos', 'global')).toBe('')
    expect(
      parseKind('global/itissid/2025-11-06-humanlayer-quick-reference.md', 'repos', 'global'),
    ).toBe('')
  })

  it('returns blank for paths outside repos/ and global/', () => {
    expect(parseKind('.github/workflows/claude.yml', 'repos', 'global')).toBe('')
  })
})

describe('parseTags()', () => {
  const doc = (body: string): string => body.replace(/^\n/, '')

  it('extracts inline-flow tags from frontmatter', () => {
    expect(
      parseTags(
        doc(`
---
date: 2025-11-17
tags: [research, codebase, linear, mcp]
status: complete
---

# Research
`),
      ),
    ).toEqual(['research', 'codebase', 'linear', 'mcp'])
  })

  it('ignores a tags: line inside a fenced code block', () => {
    // Verbatim from repos/therapro-demo/shared/plans/2026-04-04-referral-intake-xstate-…md:154,
    // which a document-wide grep would misread as metadata.
    expect(
      parseTags(
        doc(`
---
date: 2026-04-04
status: draft
---

#### 4. Tags type declaration

\`\`\`typescript
tags: {} as 'bot_conversation' | 'staff_workflow' | 'terminal',
\`\`\`
`),
      ),
    ).toEqual([])
  })

  it('returns no tags when the document has no frontmatter at all', () => {
    expect(parseTags('# Just a heading\n\ntags: [not, metadata]\n')).toEqual([])
  })

  it('returns no tags when frontmatter carries no tags key', () => {
    expect(parseTags(doc('\n---\ndate: 2025-11-17\nstatus: complete\n---\n\n# Doc\n'))).toEqual([])
  })

  it('returns no tags when the frontmatter fence is never closed', () => {
    expect(
      parseTags(doc('\n---\ntags: [research, codebase]\n\n# Doc without a closing fence\n')),
    ).toEqual([])
  })

  it('handles an empty tag list', () => {
    expect(parseTags(doc('\n---\ntags: []\n---\n'))).toEqual([])
  })

  it('strips quotes and surplus whitespace from tags', () => {
    expect(parseTags(doc(`\n---\ntags: ['research',  "codebase" , mcp]\n---\n`))).toEqual([
      'research',
      'codebase',
      'mcp',
    ])
  })

  it('tolerates CRLF line endings', () => {
    expect(parseTags('---\r\ntags: [research, mcp]\r\n---\r\n')).toEqual(['research', 'mcp'])
  })

  it('returns no tags for empty input', () => {
    expect(parseTags('')).toEqual([])
  })
})

describe('formatEdited()', () => {
  it('renders the requested Eastern-time format', () => {
    // 19:34 UTC on 2026-08-08 is 15:34 EDT.
    expect(formatEdited('2026-08-08T19:34:00+00:00')).toBe('Aug  8 2026 03:34 PM')
  })

  it('converts to ET rather than preserving the committer timezone', () => {
    // 12:30 UTC is 08:30 EDT, not 12:30.
    expect(formatEdited('2026-08-11T12:30:06+00:00')).toBe('Aug 11 2026 08:30 AM')
  })

  it('applies EST in winter and EDT in summer', () => {
    // 17:00 UTC in February is 12:00 EST (-5); in July it is 13:00 EDT (-4).
    expect(formatEdited('2026-02-15T17:00:00+00:00')).toBe('Feb 15 2026 12:00 PM')
    expect(formatEdited('2026-07-15T17:00:00+00:00')).toBe('Jul 15 2026 01:00 PM')
  })

  it('normalizes a non-UTC committer offset to the same ET instant', () => {
    // 09:52 EST expressed from a -05:00 machine stays 09:52 ET.
    expect(formatEdited('2026-02-26T09:52:54-05:00')).toBe('Feb 26 2026 09:52 AM')
    // The same instant written from Berlin must render identically.
    expect(formatEdited('2026-02-26T15:52:54+01:00')).toBe('Feb 26 2026 09:52 AM')
  })

  it('renders midnight and noon unambiguously', () => {
    expect(formatEdited('2026-07-15T04:00:00+00:00')).toBe('Jul 15 2026 12:00 AM')
    expect(formatEdited('2026-07-15T16:00:00+00:00')).toBe('Jul 15 2026 12:00 PM')
  })

  it('is fixed width regardless of single- or double-digit day', () => {
    expect(formatEdited('2026-08-08T19:34:00+00:00')).toHaveLength(20)
    expect(formatEdited('2026-08-11T12:30:06+00:00')).toHaveLength(20)
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

    expect(entries.map(e => e.name)).toEqual(['2026-01-02-newer', '2026-01-01-older'])
  })

  it('keeps the filename date prefix in the displayed name', () => {
    const doc = 'repos/a/shared/research/2026-01-02-newer.md'
    const entries = buildEntries(
      new Map([[doc, { commit: 'aaa', date: '2026-01-02T00:00:00+00:00' }]]),
      new Set([doc]),
      reposDir,
      globalDir,
    )

    expect(entries[0].name).toBe('2026-01-02-newer')
    expect(entries[0].fileDate).toBe('2026-01-02')
    expect(entries[0].kind).toBe('research')
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

    expect(entries.map(e => e.name)).toEqual(['2026-01-01-utc', '2026-01-01-berlin'])
  })
})

describe('formatTable()', () => {
  const entries: ThoughtEntry[] = [
    {
      relPath: 'repos/humanlayer/shared/research/2025-11-18-a.md',
      name: '2025-11-18-a',
      project: 'humanlayer',
      kind: 'research',
      tags: ['research', 'codebase', 'mcp'],
      fileDate: '2025-11-18',
      commit: 'aaa',
      editedAt: '2026-08-11T12:30:06+00:00',
    },
    {
      relPath: 'global/itissid/notes.md',
      name: 'notes',
      project: 'global',
      kind: '',
      tags: [],
      fileDate: '',
      commit: 'bbb',
      editedAt: '2026-08-10T09:05:00+00:00',
    },
  ]

  // Entries render as blocks separated by a blank line: header, '', block, '', block…
  const blockOf = (index: number): string[] => formatTable(entries).split('\n\n')[index + 1].split('\n')

  it('emits every column in the header', () => {
    const header = formatTable(entries).split('\n')[0]
    expect(header).toContain('NAME')
    expect(header).toContain('PROJECT')
    expect(header).toContain('KIND')
    expect(header).toContain('TAGS')
    expect(header).toContain('DATE')
    expect(header).toContain('EDITED (ET)')
  })

  it('separates the header and each entry with a blank line', () => {
    const lines = formatTable(entries).split('\n')
    expect(lines[1]).toBe('')
    expect(lines[3]).toBe('')
    expect(lines).toHaveLength(5)
  })

  it('renders the kind column from the containing folder', () => {
    expect(blockOf(0)[0]).toContain('research')
  })

  it('renders tags as a comma-separated list', () => {
    expect(blockOf(0)[0]).toContain('research, codebase, mcp')
  })

  it('renders blank date, kind and tag columns for an undated, uncategorized document', () => {
    const row = blockOf(1)[0]
    expect(row).toContain('notes')
    expect(row).toContain('global')
    expect(row).not.toContain('research')
    expect(row).not.toContain('2026-08-10T')
    // 09:05 UTC is 05:05 EDT.
    expect(row).toContain('Aug 10 2026 05:05 AM')
  })

  it('wraps a long tag list onto continuation lines aligned under the TAGS column', () => {
    const wide: ThoughtEntry[] = [
      {
        ...entries[0],
        tags: ['research', 'dropbox', 'truenas', 'sshfs', 'nfs', 'gpu', 'rtx3090', 'clip'],
      },
    ]
    const block = formatTable(wide).split('\n\n')[1].split('\n')

    expect(block.length).toBeGreaterThan(1)

    // Every continuation line starts at the TAGS column and stays inside its width.
    const indent = 52 + 2 + 16 + 2 + 14 + 2
    for (const line of block.slice(1)) {
      expect(line.slice(0, indent)).toBe(' '.repeat(indent))
      expect(line.trimEnd().length - indent).toBeLessThanOrEqual(28)
    }

    // No tag is lost in the wrapping.
    expect(block.join(' ')).toContain('rtx3090')
    expect(block.join(' ')).toContain('clip')
  })

  it('breaks a single tag longer than the column rather than overflowing', () => {
    const long = 'a'.repeat(40)
    const block = formatTable([{ ...entries[0], tags: [long] }])
      .split('\n\n')[1]
      .split('\n')

    expect(block.length).toBeGreaterThan(1)
    for (const line of block) {
      expect(line.trimEnd().length).toBeLessThanOrEqual(52 + 2 + 16 + 2 + 14 + 2 + 28 + 2 + 10 + 2 + 20)
    }
  })

  it('reports when there is nothing to show', () => {
    expect(formatTable([])).toContain('No thoughts found')
  })
})
