import { describe, expect, test } from 'claude-code/testing'

import {
  badgeLabel,
  describeFresh,
  diffInbox,
  explainGhFailure,
  formatAge,
  parsePullRequests,
  reviewArgv,
  searchArgv,
} from '../hooks/github'

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
    })
  })

  test('rejects output that is not a list', () => {
    expect(() => parsePullRequests('{}')).toThrow('list')
  })

  test('asks gh for open PRs that request the signed-in user', () => {
    expect(searchArgv()).toContain('--review-requested=@me')
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
      '4 new PR review requests',
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
