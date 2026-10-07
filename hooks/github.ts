import type { IPullRequest, TReviewAction } from '../types'

const SEARCH_FIELDS =
  'number,title,url,repository,author,isDraft,createdAt,commentsCount,labels'
const SEARCH_LIMIT = '50'

const REVIEW_FLAGS: Readonly<Record<TReviewAction, string>> = {
  approve: '--approve',
  'request-changes': '--request-changes',
  comment: '--comment',
}

export const ACTION_VERBS: Readonly<Record<TReviewAction, string>> = {
  approve: 'Approve',
  'request-changes': 'Request changes on',
  comment: 'Comment on',
}

export const searchArgv = (): string[] => [
  'gh',
  'search',
  'prs',
  '--review-requested=@me',
  '--state=open',
  '--json',
  SEARCH_FIELDS,
  '--limit',
  SEARCH_LIMIT,
]

// Turns the three ways the GitHub CLI dependency typically fails into a message that says what to do;
// anything else passes through unchanged.
export const MIN_GH_VERSION = '2.21'

export const explainGhFailure = (message: string): string => {
  if (/\bENOENT\b|is not recognized|command not found|no such file or directory/i.test(message)) {
    return 'GitHub CLI (gh) not found. Install it from https://cli.github.com, then restart Claude Code.'
  }
  if (/unknown command/i.test(message)) {
    return `gh is too old for "gh search". Upgrade to ${MIN_GH_VERSION} or later (gh --version).`
  }
  if (/gh auth login|not logged in|bad credentials|http 401/i.test(message)) {
    return 'gh is not signed in. Run `gh auth login`, then reopen /prs.'
  }
  return message
}

export const openArgv = (url: string): string[] => ['gh', 'pr', 'view', url, '--web']

// The body goes in on stdin (`--body-file -`) so quoting and length never matter.
export const reviewArgv = (
  action: TReviewAction,
  url: string,
  hasBody: boolean,
): string[] => [
  'gh',
  'pr',
  'review',
  url,
  REVIEW_FLAGS[action],
  ...(hasBody ? ['--body-file', '-'] : []),
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

export const parsePullRequests = (stdout: string): IPullRequest[] => {
  const parsed: unknown = JSON.parse(stdout)
  if (!Array.isArray(parsed)) {
    throw new Error('gh returned something other than a list')
  }

  const pullRequests: IPullRequest[] = []
  for (const raw of parsed as unknown[]) {
    if (!isRecord(raw) || typeof raw.url !== 'string') continue

    const repository = isRecord(raw.repository) ? asText(raw.repository.nameWithOwner) : ''
    const author = isRecord(raw.author) ? asText(raw.author.login) : ''
    const labels = Array.isArray(raw.labels)
      ? (raw.labels as unknown[]).flatMap(label =>
          isRecord(label) && typeof label.name === 'string' ? [label.name] : [],
        )
      : []

    pullRequests.push({
      url: raw.url,
      number: typeof raw.number === 'number' ? raw.number : 0,
      title: asText(raw.title),
      repository,
      author,
      isDraft: raw.isDraft === true,
      createdAt: asText(raw.createdAt),
      commentsCount: typeof raw.commentsCount === 'number' ? raw.commentsCount : 0,
      labels,
    })
  }

  return pullRequests
}

export interface IInboxDiff {
  readonly fresh: IPullRequest[]
  readonly seenUrls: string[]
  readonly isFirstRun: boolean
}

// `previousSeen` is undefined only before the first poll ever: that poll is
// seeded silently so an existing backlog does not toast all at once. Seen URLs
// are pruned to the current list, so a PR that is re-requested later is fresh again.
export const diffInbox = (
  previousSeen: readonly string[] | undefined,
  current: readonly IPullRequest[],
): IInboxDiff => {
  const seenUrls = current.map(pullRequest => pullRequest.url)
  if (previousSeen === undefined) {
    return { fresh: [], seenUrls, isFirstRun: true }
  }

  const known = new Set(previousSeen)
  return {
    fresh: current.filter(pullRequest => !known.has(pullRequest.url)),
    seenUrls,
    isFirstRun: false,
  }
}

export const shortRef = (pullRequest: IPullRequest): string =>
  `${pullRequest.repository}#${pullRequest.number}`

export const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`

export const formatAge = (iso: string, nowMs: number): string => {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'unknown age'

  const minutes = Math.max(0, Math.round((nowMs - then) / 60000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

// The badge at the right of the prompt footer; no badge at all when nothing waits.
export const badgeLabel = (count: number, hasError: boolean): string | undefined => {
  if (hasError) return '⇄ PRs: gh error'
  if (count <= 0) return undefined
  return `⇄ ${count} ${count === 1 ? 'PR' : 'PRs'}`
}

export const describeFresh =(fresh: readonly IPullRequest[]): string[] => {
  if (fresh.length > 3) return [`${fresh.length} new PR review requests`]
  return fresh.map(
    pullRequest =>
      `Review requested: ${shortRef(pullRequest)} "${truncate(pullRequest.title, 60)}" by @${pullRequest.author}`,
  )
}
