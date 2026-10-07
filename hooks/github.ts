import type { IPullRequest, TRequestReason, TReviewAction, TSortMode } from '../types'

const SEARCH_FIELDS =
  'number,title,url,repository,author,isDraft,createdAt,commentsCount,labels'
// How many requests one poll asks `gh` for; a result this long may have been cut off.
export const SEARCH_LIMIT = 100

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

// `gh search` cannot OR two qualifiers, so each reason is its own search and the results are merged.
export const SEARCH_REASONS: readonly TRequestReason[] = ['review', 'assigned']

const REASON_FLAGS: Readonly<Record<TRequestReason, string>> = {
  review: '--review-requested=@me',
  assigned: '--assignee=@me',
}

export const searchArgv = (reason: TRequestReason = 'review'): string[] => [
  'gh',
  'search',
  'prs',
  REASON_FLAGS[reason],
  '--state=open',
  '--json',
  SEARCH_FIELDS,
  '--limit',
  String(SEARCH_LIMIT),
]

const GH_HOST = 'github.com'

export const accountsArgv = (): string[] => ['gh', 'auth', 'status', '--hostname', GH_HOST]

export const tokenArgv = (account: string): string[] => [
  'gh',
  'auth',
  'token',
  '--hostname',
  GH_HOST,
  '--user',
  account,
]

// The signed-in accounts, in the order `gh auth status` lists them. Older gh prints the report on
// stderr and exits 1 when any account is broken, so the caller hands in both streams.
export const parseAccounts = (text: string): string[] => [
  ...new Set([...text.matchAll(/Logged in to \S+ account (\S+)/g)].map(match => match[1] ?? '')),
]

// Per-call credentials: `gh` reads GH_TOKEN ahead of its stored login, so no account is ever switched.
export const tokenEnv = (token: string): Record<string, string> => ({ GH_TOKEN: token })

// The account to act as for `pullRequest`: the one the pane is narrowed to if it sees the PR,
// otherwise the first account that found it. Undefined means `gh`'s own active account.
export const actingAccount = (
  pullRequest: IPullRequest,
  accountFilter: string,
): string | undefined =>
  pullRequest.accounts.includes(accountFilter) ? accountFilter : pullRequest.accounts[0]

// '' (every account), then each account in turn, then back to ''.
export const nextAccountFilter = (current: string, accounts: readonly string[]): string => {
  const index = accounts.indexOf(current)
  return accounts[index + 1] ?? (current === '' && accounts[0] !== undefined ? accounts[0] : '')
}

// Turns the ways the GitHub CLI dependency typically fails into a message that says what to do;
// anything else passes through unchanged.
export const MIN_GH_VERSION = '2.46'

export const explainGhFailure = (message: string): string => {
  if (/\bENOENT\b|is not recognized|command not found|no such file or directory/i.test(message)) {
    return 'GitHub CLI (gh) not found. Install it from https://cli.github.com, then restart Claude Code.'
  }
  if (/unknown command/i.test(message)) {
    return `gh is too old for "gh search". Upgrade to ${MIN_GH_VERSION} or later (gh --version).`
  }
  if (/unknown flag/i.test(message)) {
    return `gh is too old for several accounts. Upgrade to ${MIN_GH_VERSION} or later (gh --version).`
  }
  if (/gh auth login|not logged in|bad credentials|http 401/i.test(message)) {
    return 'gh is not signed in. Run `gh auth login`, then reopen /prs.'
  }
  return message
}

// What Claude is asked when a PR is picked up. gh acts as its active account unless told otherwise, and
// that account may not see this repo, so a PR from another account says how to get that account's token.
export const reviewPrompt = (
  pullRequest: IPullRequest,
  account: string | undefined,
  isBackground = false,
): string => {
  const asAccount =
    account === undefined
      ? ''
      : ` This PR belongs to the gh account "${account}", which may not be gh's active one: run every gh command ` +
        `with GH_TOKEN set to the output of \`gh auth token --hostname github.com --user ${account}\`. ` +
        `PowerShell: \`$env:GH_TOKEN = (gh auth token --hostname github.com --user ${account})\` once, then run gh. ` +
        `bash: \`GH_TOKEN=$(gh auth token --hostname github.com --user ${account}) gh pr diff <url>\`. ` +
        'Never print the token.'
  const report = isBackground
    ? ' Finish with a summary under 300 words: what it changes, the risks, and the review comments you would leave.'
    : ''

  return (
    `Review ${pullRequest.url} (${shortRef(pullRequest)}). Use \`gh pr view\` and \`gh pr diff\` to read it, ` +
    'then summarize what it changes, flag risks, and suggest review comments. ' +
    `Do not post anything to GitHub.${report}${asAccount}`
  )
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

export const parsePullRequests = (
  stdout: string,
  reason: TRequestReason = 'review',
  account = '',
): IPullRequest[] => {
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
      reasons: [reason],
      accounts: account === '' ? [] : [account],
    })
  }

  return pullRequests
}

// One entry per URL, in first-seen order, with the reasons and accounts of every search that found it.
export const mergePullRequests = (
  lists: readonly (readonly IPullRequest[])[],
): IPullRequest[] => {
  const byUrl = new Map<string, IPullRequest>()
  for (const pullRequest of lists.flat()) {
    const known = byUrl.get(pullRequest.url)
    byUrl.set(
      pullRequest.url,
      known === undefined
        ? pullRequest
        : {
            ...known,
            reasons: [...new Set([...known.reasons, ...pullRequest.reasons])],
            accounts: [...new Set([...known.accounts, ...pullRequest.accounts])],
          },
    )
  }
  return [...byUrl.values()]
}

export const reasonLabel = (pullRequest: IPullRequest): string =>
  pullRequest.reasons.map(reason => (reason === 'review' ? 'review requested' : 'assigned')).join(' + ')

// The lead of a toast or band: a requested review outranks a plain assignment.
export const describeReason = (pullRequest: IPullRequest): string =>
  pullRequest.reasons.includes('review') ? 'Review requested' : 'Assigned to you'

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
  if (fresh.length > 3) return [`${fresh.length} new PRs in your inbox`]
  return fresh.map(
    pullRequest =>
      `${describeReason(pullRequest)}: ${shortRef(pullRequest)} "${truncate(pullRequest.title, 60)}" by @${pullRequest.author}`,
  )
}

export const SORT_MODES: readonly TSortMode[] = ['newest', 'oldest', 'repo']

export const nextSortMode = (mode: TSortMode): TSortMode =>
  SORT_MODES[(SORT_MODES.indexOf(mode) + 1) % SORT_MODES.length] ?? 'newest'

const createdMs = (pullRequest: IPullRequest): number => {
  const ms = Date.parse(pullRequest.createdAt)
  return Number.isNaN(ms) ? 0 : ms
}

// Every word of `query` must appear in the ref, account, title, author or a label (case-insensitive).
export const filterPullRequests = (
  list: readonly IPullRequest[],
  query: string,
  isHidingDrafts: boolean,
  accountFilter = '',
): IPullRequest[] => {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== '')

  return list.filter(pullRequest => {
    if (isHidingDrafts && pullRequest.isDraft) return false
    if (accountFilter !== '' && !pullRequest.accounts.includes(accountFilter)) return false
    if (words.length === 0) return true

    const haystack = [
      shortRef(pullRequest),
      reasonLabel(pullRequest),
      ...pullRequest.accounts,
      pullRequest.title,
      pullRequest.author,
      ...pullRequest.labels,
    ]
      .join(' ')
      .toLowerCase()
    return words.every(word => haystack.includes(word))
  })
}

export const sortPullRequests = (
  list: readonly IPullRequest[],
  mode: TSortMode,
): IPullRequest[] => {
  const sorted = [...list]
  if (mode === 'newest') return sorted.sort((a, b) => createdMs(b) - createdMs(a))
  if (mode === 'oldest') return sorted.sort((a, b) => createdMs(a) - createdMs(b))
  return sorted.sort(
    (a, b) => a.repository.localeCompare(b.repository) || b.number - a.number,
  )
}

// The rows of the list the pane draws and the keyboard steps through.
export const organizePullRequests = (
  list: readonly IPullRequest[],
  query: string,
  mode: TSortMode,
  isHidingDrafts: boolean,
  accountFilter = '',
): IPullRequest[] =>
  sortPullRequests(filterPullRequests(list, query, isHidingDrafts, accountFilter), mode)

// Rows the pane draws besides the list: header, filter, controls, window line, detail, actions, notes.
export const CHROME_ROWS = 13
export const MIN_LIST_ROWS = 5
export const MAX_LIST_ROWS = 40

// How many list rows fit in a body of `bodyRows`.
export const listRowBudget = (bodyRows: number): number =>
  Math.min(MAX_LIST_ROWS, Math.max(MIN_LIST_ROWS, Math.floor(bodyRows) - CHROME_ROWS))

export const clampOffset = (offset: number, total: number, rows: number): number =>
  Math.max(0, Math.min(Math.floor(offset), Math.max(0, total - rows)))

// The smallest move that brings row `index` into the window of `rows` starting at `offset`.
export const revealOffset = (offset: number, index: number, rows: number): number => {
  if (index < offset) return index
  if (index >= offset + rows) return index - rows + 1
  return offset
}

const MAX_REF_WIDTH = 30

// The width of the ref column: the longest ref among the drawn rows, capped.
export const refColumnWidth = (rows: readonly IPullRequest[]): number =>
  Math.min(MAX_REF_WIDTH, rows.reduce((longest, row) => Math.max(longest, shortRef(row).length), 0))

const AUTHOR_WIDTH = 14
const AGE_WIDTH = 5
const MIN_TITLE_WIDTH = 20

export interface IRowOptions {
  readonly width: number
  readonly nowMs: number
  readonly refWidth: number
  readonly isSelected: boolean
  readonly isUnseen: boolean
}

// One aligned line: marker, ref, title (takes the slack), author, age. The author column is
// dropped when the body is too narrow to leave the title room.
export const formatRow = (pullRequest: IPullRequest, options: IRowOptions): string => {
  const marker = options.isSelected ? '>' : options.isUnseen ? '●' : ' '
  const ref = truncate(shortRef(pullRequest), options.refWidth).padEnd(options.refWidth)
  const age = formatAge(pullRequest.createdAt, options.nowMs).padStart(AGE_WIDTH)
  const title = pullRequest.isDraft ? `[draft] ${pullRequest.title}` : pullRequest.title

  const lead = 2 + options.refWidth + 2
  const available = options.width - 2 // the button's own padding
  const withAuthor = available - lead - (2 + AUTHOR_WIDTH + 1 + AGE_WIDTH)
  if (withAuthor >= MIN_TITLE_WIDTH) {
    const author = truncate(`@${pullRequest.author}`, AUTHOR_WIDTH).padEnd(AUTHOR_WIDTH)
    return `${marker} ${ref}  ${truncate(title, withAuthor).padEnd(withAuthor)}  ${author} ${age}`
  }

  const titleWidth = Math.max(8, available - lead - (1 + AGE_WIDTH))
  return `${marker} ${ref}  ${truncate(title, titleWidth).padEnd(titleWidth)} ${age}`
}

// Footer mode labels start with an icon (`⏸ plan mode on`). Many terminals draw that icon two cells
// wide over the one-cell gap, which glues it to the text, so the gap is made two spaces wide.
export const spaceAfterIcon = (mode: string): string =>
  mode.replace(/^(\p{Extended_Pictographic}\uFE0F?) */u, '$1  ')
