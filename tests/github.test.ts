import { describe, expect, test } from 'claude-code/testing'

import {
  SEARCH_LIMIT,
  badgeLabel,
  clampOffset,
  describeFresh,
  diffInbox,
  explainGhFailure,
  filterPullRequests,
  formatAge,
  formatRow,
  listRowBudget,
  mergePullRequests,
  nextSortMode,
  organizePullRequests,
  parsePullRequests,
  reasonLabel,
  refColumnWidth,
  reviewArgv,
  revealOffset,
  searchArgv,
  sortPullRequests,
  spaceAfterIcon,
} from '../hooks/github'
import type { IPullRequest } from '../types'

const SAMPLE = JSON.stringify([
  {
    number: 7,
    title: 'Fix login',
    url: 'https://github.com/acme/app/pull/7',
    repository: { nameWithOwner: 'acme/app' },
    author: { login: 'sam' },
    isDraft: false,
    createdAt: '2026-10-05T00:00:00Z',
    commentsCount: 2,
    labels: [{ name: 'bug' }],
  },
  { not: 'a pull request' },
])

describe('explainGhFailure', () => {
  test('says how to install gh when it is missing', () => {
    expect(explainGhFailure('spawn gh ENOENT')).toContain('https://cli.github.com')
    expect(explainGhFailure("'gh' is not recognized as an internal or external command")).toContain(
      'not found',
    )
  })

  test('says how to sign in when gh has no credentials', () => {
    expect(
      explainGhFailure('To get started with GitHub CLI, please run:  gh auth login'),
    ).toContain('gh auth login')
  })

  test('says to upgrade when gh predates `gh search`', () => {
    expect(explainGhFailure('unknown command "search" for "gh"')).toContain('2.21')
  })

  test('leaves other errors untouched', () => {
    expect(explainGhFailure('HTTP 502: bad gateway')).toBe('HTTP 502: bad gateway')
  })
})

describe('github helpers', () => {
  test('parses gh search output and skips rows without a url', () => {
    const [first, ...rest] = parsePullRequests(SAMPLE)

    expect(rest).toHaveLength(0)
    expect(first).toEqual({
      url: 'https://github.com/acme/app/pull/7',
      number: 7,
      title: 'Fix login',
      repository: 'acme/app',
      author: 'sam',
      isDraft: false,
      createdAt: '2026-10-05T00:00:00Z',
      commentsCount: 2,
      labels: ['bug'],
      reasons: ['review'],
    })
  })

  test('rejects output that is not a list', () => {
    expect(() => parsePullRequests('{}')).toThrow('list')
  })

  test('asks gh for open PRs that request the signed-in user', () => {
    expect(searchArgv()).toContain('--review-requested=@me')
    expect(searchArgv('assigned')).toContain('--assignee=@me')
    expect(searchArgv('assigned')).not.toContain('--review-requested=@me')
  })

  test('sends review bodies on stdin and never as an argument', () => {
    expect(reviewArgv('approve', 'u', false)).toEqual(['gh', 'pr', 'review', 'u', '--approve'])
    expect(reviewArgv('request-changes', 'u', true)).toEqual([
      'gh', 'pr', 'review', 'u', '--request-changes', '--body-file', '-',
    ])
  })

  test('seeds the first poll silently, then reports only new URLs', () => {
    const [pullRequest] = parsePullRequests(SAMPLE)
    if (pullRequest === undefined) throw new Error('sample did not parse')

    const first = diffInbox(undefined, [pullRequest])
    expect(first.isFirstRun).toBe(true)
    expect(first.fresh).toHaveLength(0)

    expect(diffInbox(first.seenUrls, [pullRequest]).fresh).toHaveLength(0)
    expect(diffInbox([], [pullRequest]).fresh).toHaveLength(1)
  })

  test('a PR that left the list is fresh again when it returns', () => {
    const [pullRequest] = parsePullRequests(SAMPLE)
    if (pullRequest === undefined) throw new Error('sample did not parse')

    const afterRemoval = diffInbox(['https://github.com/acme/app/pull/7'], [])
    expect(afterRemoval.seenUrls).toEqual([])
    expect(diffInbox(afterRemoval.seenUrls, [pullRequest]).fresh).toHaveLength(1)
  })

  test('collapses a burst of requests into one line', () => {
    const [pullRequest] = parsePullRequests(SAMPLE)
    if (pullRequest === undefined) throw new Error('sample did not parse')

    expect(describeFresh([pullRequest])[0]).toContain('acme/app#7')
    expect(describeFresh([pullRequest, pullRequest, pullRequest, pullRequest])).toEqual([
      '4 new PRs in your inbox',
    ])
  })

  test('labels the footer badge, and draws none for an empty inbox', () => {
    expect(badgeLabel(0, false)).toBeUndefined()
    expect(badgeLabel(1, false)).toBe('⇄ 1 PR')
    expect(badgeLabel(3, false)).toBe('⇄ 3 PRs')
    expect(badgeLabel(0, true)).toBe('⇄ PRs: gh error')
  })

  test('formats ages', () => {
    const now = Date.parse('2026-10-06T00:00:00Z')

    expect(formatAge('2026-10-05T23:30:00Z', now)).toBe('30m')
    expect(formatAge('2026-10-05T18:00:00Z', now)).toBe('6h')
    expect(formatAge('2026-10-01T00:00:00Z', now)).toBe('5d')
    expect(formatAge('nope', now)).toBe('unknown age')
  })
})

const NOW = Date.parse('2026-10-06T00:00:00Z')

const makePullRequest = (number: number, overrides: Partial<IPullRequest> = {}): IPullRequest => ({
  url: `https://github.com/acme/app/pull/${number}`,
  number,
  title: `Task ${number}`,
  repository: 'acme/app',
  author: 'sam',
  isDraft: false,
  createdAt: new Date(NOW - number * 3_600_000).toISOString(),
  commentsCount: 0,
  labels: [],
  reasons: ['review'],
  ...overrides,
})

describe('list helpers', () => {
  const list = [
    makePullRequest(1, { title: 'Fix login', labels: ['bug'] }),
    makePullRequest(2, { title: 'Add dark mode', author: 'jchen', isDraft: true }),
    makePullRequest(3, { title: 'Migrate billing', repository: 'acme/billing' }),
  ]

  test('asks gh for as many requests as the pane can window', () => {
    expect(searchArgv()).toContain(String(SEARCH_LIMIT))
  })

  test('filters on every word across ref, title, author and labels', () => {
    expect(filterPullRequests(list, '', false)).toHaveLength(3)
    expect(filterPullRequests(list, 'LOGIN', false).map(row => row.number)).toEqual([1])
    expect(filterPullRequests(list, 'bug acme/app', false).map(row => row.number)).toEqual([1])
    expect(filterPullRequests(list, '@jchen', false)).toHaveLength(0)
    expect(filterPullRequests(list, 'jchen', false).map(row => row.number)).toEqual([2])
    expect(filterPullRequests(list, 'billing', false).map(row => row.number)).toEqual([3])
    expect(filterPullRequests(list, 'nothing like this', false)).toHaveLength(0)
  })

  test('hides drafts on request', () => {
    expect(filterPullRequests(list, '', true).map(row => row.number)).toEqual([1, 3])
  })

  test('sorts newest first, oldest first, or by repo', () => {
    expect(sortPullRequests(list, 'newest').map(row => row.number)).toEqual([1, 2, 3])
    expect(sortPullRequests(list, 'oldest').map(row => row.number)).toEqual([3, 2, 1])
    expect(sortPullRequests(list, 'repo').map(row => row.number)).toEqual([2, 1, 3])
    expect(list.map(row => row.number)).toEqual([1, 2, 3])
  })

  test('cycles the sort mode and filters before it sorts', () => {
    expect(nextSortMode('newest')).toBe('oldest')
    expect(nextSortMode('oldest')).toBe('repo')
    expect(nextSortMode('repo')).toBe('newest')
    expect(organizePullRequests(list, 'acme', 'oldest', true).map(row => row.number)).toEqual([3, 1])
  })

  test('sizes the list from the body, within a floor and a ceiling', () => {
    expect(listRowBudget(30)).toBe(17)
    expect(listRowBudget(4)).toBe(5)
    expect(listRowBudget(500)).toBe(40)
  })

  test('clamps the window and reveals a row by the smallest move', () => {
    expect(clampOffset(-3, 60, 17)).toBe(0)
    expect(clampOffset(99, 60, 17)).toBe(43)
    expect(clampOffset(5, 10, 17)).toBe(0)
    expect(revealOffset(10, 12, 17)).toBe(10)
    expect(revealOffset(10, 4, 17)).toBe(4)
    expect(revealOffset(10, 40, 17)).toBe(24)
  })

  test('formats rows to one aligned width and drops the author when narrow', () => {
    const rows = [
      makePullRequest(1),
      makePullRequest(22, { title: 'A very long title '.repeat(10), isDraft: true }),
    ]
    const refWidth = refColumnWidth(rows)
    const draw = (width: number, index: number) =>
      formatRow(rows[index] as IPullRequest, {
        width,
        nowMs: NOW,
        refWidth,
        isSelected: index === 0,
        isUnseen: index === 1,
      })

    expect(draw(80, 0)).toHaveLength(78)
    expect(draw(80, 1)).toHaveLength(78)
    expect(draw(80, 0)).toMatch(/^> acme\/app#1 /)
    expect(draw(80, 1)).toMatch(/^● acme\/app#22 {2}\[draft\] /)
    expect(draw(80, 0)).toContain('@sam')
    expect(draw(40, 0)).not.toContain('@sam')
    expect(draw(40, 0)).toContain('1h')
  })
})

describe('footer labels', () => {
  test('puts two spaces after a leading icon, and leaves plain labels alone', () => {
    expect(spaceAfterIcon('⏸ plan mode on')).toBe('⏸  plan mode on')
    expect(spaceAfterIcon('⏸plan mode on')).toBe('⏸  plan mode on')
    expect(spaceAfterIcon('⏸  plan mode on')).toBe('⏸  plan mode on')
    expect(spaceAfterIcon('focus')).toBe('focus')
    expect(spaceAfterIcon('')).toBe('')
  })
})

describe('assigned PRs', () => {
  test('tags what each search found, then merges by URL and unions the reasons', () => {
    const [reviewed] = parsePullRequests(SAMPLE, 'review')
    const [assigned] = parsePullRequests(SAMPLE, 'assigned')
    if (reviewed === undefined || assigned === undefined) throw new Error('sample did not parse')
    expect(assigned.reasons).toEqual(['assigned'])

    const other = makePullRequest(9, { reasons: ['assigned'] })
    const merged = mergePullRequests([[reviewed], [assigned, other]])
    expect(merged.map(row => row.number)).toEqual([7, 9])
    expect(merged[0]?.reasons).toEqual(['review', 'assigned'])
    expect(merged[1]?.reasons).toEqual(['assigned'])
  })

  test('says why a PR is there, and lets the filter find it by that', () => {
    const both = makePullRequest(1, { reasons: ['review', 'assigned'] })
    const mine = makePullRequest(2, { reasons: ['assigned'] })

    expect(reasonLabel(both)).toBe('review requested + assigned')
    expect(reasonLabel(mine)).toBe('assigned')
    expect(filterPullRequests([both, mine], 'assigned', false)).toHaveLength(2)
    expect(filterPullRequests([both, mine], 'review', false).map(row => row.number)).toEqual([1])
    expect(describeFresh([mine])[0]).toContain('Assigned to you: acme/app#2')
    expect(describeFresh([both])[0]).toContain('Review requested: acme/app#1')
  })
})
