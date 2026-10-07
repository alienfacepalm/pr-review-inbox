import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { IPendingAction, IPullRequest, TReviewAction } from '../types'
import {
  ACTION_VERBS,
  SEARCH_LIMIT,
  badgeLabel,
  clampOffset,
  describeFresh,
  diffInbox,
  explainGhFailure,
  formatAge,
  formatRow,
  listRowBudget,
  nextSortMode,
  openArgv,
  organizePullRequests,
  parsePullRequests,
  refColumnWidth,
  reviewArgv,
  revealOffset,
  searchArgv,
  shortRef,
  spaceAfterIcon,
  truncate,
} from './github'

type TEngine = EngineInterface

const PANE = 'pr-review'
const ROW_KEY_PREFIX = 'pr:'
const SEEN_KEY = 'seenUrls'
const DEFAULT_POLL_MINUTES = 5
const PANE_ROWS = 30
const PANE_COLUMNS = 100
const TOAST_MS = 8000

const pullRequests = atom({ plugin: 'pr-review-inbox', key: 'pullRequests' } as const, [])
const selectedUrl = atom({ plugin: 'pr-review-inbox', key: 'selectedUrl' } as const, null)
const draftComment = atom({ plugin: 'pr-review-inbox', key: 'draftComment' } as const, '')
const pending = atom({ plugin: 'pr-review-inbox', key: 'pending' } as const, null)
const unseenUrls = atom({ plugin: 'pr-review-inbox', key: 'unseenUrls' } as const, [])
const message = atom({ plugin: 'pr-review-inbox', key: 'message' } as const, '')
const pollError = atom({ plugin: 'pr-review-inbox', key: 'pollError' } as const, null)
const lastPolledAt = atom({ plugin: 'pr-review-inbox', key: 'lastPolledAt' } as const, null)
const isBusy = atom({ plugin: 'pr-review-inbox', key: 'isBusy' } as const, false)
const filterText = atom({ plugin: 'pr-review-inbox', key: 'filterText' } as const, '')
const sortMode = atom({ plugin: 'pr-review-inbox', key: 'sortMode' } as const, 'newest')
const isHidingDrafts = atom({ plugin: 'pr-review-inbox', key: 'isHidingDrafts' } as const, false)
const listOffset = atom({ plugin: 'pr-review-inbox', key: 'listOffset' } as const, 0)

// Module variables restart on a hot reload, which only costs one repeated toast.
let isPolling = false
let lastErrorText = ''
// How many list rows the pane last had room for; the keyboard handlers need it between renders.
let lastListRows = listRowBudget(PANE_ROWS)

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? ''
}

function asStringList(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? (value as unknown[]).filter((item): item is string => typeof item === 'string')
    : undefined
}

function errorText(error: unknown): string {
  return explainGhFailure(error instanceof Error ? error.message : String(error))
}

function say($: TEngine, text: string) {
  return update($, message, () => text)
}

async function fetchPullRequests($: TEngine): Promise<IPullRequest[]> {
  const run = await $.process.run(searchArgv(), { timeoutMs: 30_000 })
  if (run.exitCode !== 0) {
    throw new Error(firstLine(run.stderr) || `gh exited with code ${run.exitCode}`)
  }

  return parsePullRequests(run.stdout)
}

// The rows the pane draws: the inbox after the filter, the drafts toggle and the sort.
async function visibleList($: TEngine): Promise<IPullRequest[]> {
  return organizePullRequests(
    await read($, pullRequests),
    await read($, filterText),
    await read($, sortMode),
    await read($, isHidingDrafts),
  )
}

// Keeps the selection on a drawn row. The window follows the selection only when it moved
// (or when asked), so a background poll never yanks a list the person has scrolled.
async function syncSelection($: TEngine, shouldReveal = false): Promise<void> {
  const list = await visibleList($)
  const url = await read($, selectedUrl)
  if (list.length === 0) {
    await update($, selectedUrl, () => null)
    await update($, listOffset, () => 0)
    return
  }

  const found = list.findIndex(pullRequest => pullRequest.url === url)
  const index = found >= 0 ? found : 0
  const nextUrl = list[index]?.url ?? null
  const hasMoved = nextUrl !== url
  if (hasMoved) {
    await update($, selectedUrl, () => nextUrl)
    await update($, pending, () => null)
  }

  await update($, listOffset, offset => {
    const clamped = clampOffset(offset, list.length, lastListRows)
    return hasMoved || shouldReveal ? revealOffset(clamped, index, lastListRows) : clamped
  })
}

async function refresh($: TEngine): Promise<void> {
  if (isPolling) return
  isPolling = true

  try {
    const current = await fetchPullRequests($)
    const { fresh, seenUrls } = diffInbox(asStringList(await $.store.get(SEEN_KEY)), current)
    await $.store.set(SEEN_KEY, seenUrls)

    const currentUrls = new Set(seenUrls)
    const now = await $.clock.now()
    await update($, pullRequests, () => current)
    await update($, unseenUrls, list => [
      ...list.filter(url => currentUrls.has(url)),
      ...fresh.map(pullRequest => pullRequest.url),
    ])
    await syncSelection($)
    await update($, lastPolledAt, () => now)
    await update($, pollError, () => null)
    lastErrorText = ''

    if (fresh.length > 0) {
      $.ui.toast(describeFresh(fresh).join('\n'), { timeoutMs: TOAST_MS })
    }
  } catch (error) {
    const text = errorText(error)
    await update($, pollError, () => text)
    if (text !== lastErrorText) {
      lastErrorText = text
      $.ui.toast(`PR inbox: ${truncate(text, 120)}`)
    }
  } finally {
    isPolling = false
  }
}

async function openPane($: TEngine): Promise<void> {
  await update($, unseenUrls, () => [])
  await $.ui.open({
    id: PANE,
    title: 'PR reviews',
    focus: true,
    rows: PANE_ROWS,
    columns: PANE_COLUMNS,
  })
}

async function withBusy($: TEngine, work: () => Promise<void>): Promise<void> {
  if (await read($, isBusy)) return

  await update($, isBusy, () => true)
  try {
    await work()
  } catch (error) {
    await say($, errorText(error))
  } finally {
    await update($, isBusy, () => false)
  }
}

async function findSelected($: TEngine) {
  const url = await read($, selectedUrl)
  return (await read($, pullRequests)).find(pullRequest => pullRequest.url === url)
}

async function selectRow($: TEngine, url: string): Promise<void> {
  await update($, selectedUrl, () => url)
  await update($, pending, () => null)
}

// Moves the selection `delta` rows through the visible list and brings it into the window.
async function stepSelection($: TEngine, delta: number): Promise<void> {
  const list = await visibleList($)
  if (list.length === 0) return

  const url = await read($, selectedUrl)
  const found = list.findIndex(pullRequest => pullRequest.url === url)
  const index = found < 0 ? 0 : Math.max(0, Math.min(list.length - 1, found + delta))
  const target = list[index]
  if (target === undefined) return

  await selectRow($, target.url)
  await update($, listOffset, offset =>
    revealOffset(clampOffset(offset, list.length, lastListRows), index, lastListRows),
  )
}

// A new filter, sort or drafts setting starts the list from the top.
async function changeView($: TEngine, change: () => Promise<void>): Promise<void> {
  await change()
  await update($, listOffset, () => 0)
  await syncSelection($, true)
}

function setFilter($: TEngine, text: string): Promise<void> {
  return changeView($, () => update($, filterText, () => text))
}

function cycleSort($: TEngine): Promise<void> {
  return changeView($, () => update($, sortMode, mode => nextSortMode(mode)))
}

function toggleDrafts($: TEngine): Promise<void> {
  return changeView($, () => update($, isHidingDrafts, isHiding => !isHiding))
}

async function requestAction($: TEngine, action: TReviewAction): Promise<void> {
  const selected = await findSelected($)
  if (selected === undefined) return

  const hasBody = (await read($, draftComment)).trim().length > 0
  if (action !== 'approve' && !hasBody) {
    await say($, 'Type a comment in the field first.')
    return
  }

  await update($, pending, () => ({ action, url: selected.url }))
  await say($, '')
}

function submitReview($: TEngine, request: IPendingAction): Promise<void> {
  return withBusy($, async () => {
    const body = (await read($, draftComment)).trim()
    const run = await $.process.run(reviewArgv(request.action, request.url, body.length > 0), {
      stdin: body,
      timeoutMs: 60_000,
    })
    await update($, pending, () => null)

    if (run.exitCode !== 0) {
      await say($, explainGhFailure(firstLine(run.stderr) || `gh exited with code ${run.exitCode}`))
      return
    }

    await update($, draftComment, () => '')
    await say($, `Done: ${ACTION_VERBS[request.action]} ${request.url}`)
    await refresh($)
  })
}

function openInBrowser($: TEngine): Promise<void> {
  return withBusy($, async () => {
    const selected = await findSelected($)
    if (selected === undefined) return

    const run = await $.process.run(openArgv(selected.url), { timeoutMs: 15_000 })
    await say($, run.exitCode === 0 ? `Opened ${shortRef(selected)}` : firstLine(run.stderr))
  })
}

// Fills (never submits) the prompt, so the person reads it before a turn starts.
async function reviewWithClaude($: TEngine): Promise<void> {
  const selected = await findSelected($)
  if (selected === undefined) return

  const filled = await $.prompt.fill({
    text:
      `Review ${selected.url} (${shortRef(selected)}). Use \`gh pr view\` and \`gh pr diff\` to read it, ` +
      'then summarize what it changes, flag risks, and suggest review comments. ' +
      'Do not post anything to GitHub.',
  })
  await say(
    $,
    filled.isFilled
      ? 'Prompt drafted: press Esc to return to it, edit, then send.'
      : 'Could not draft the prompt right now.',
  )
}

export const register: Register = (on, options) => {
  const pollMinutes =
    typeof options.pollMinutes === 'number' && options.pollMinutes >= 1
      ? options.pollMinutes
      : DEFAULT_POLL_MINUTES

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prs',
      description: 'Show the GitHub PRs awaiting your review',
    })

    void refresh($)
    $.clock.every(pollMinutes * 60_000, () => refresh($))

    return next(e)
  })

  on('command.run', { command: 'prs' }, async $ => {
    await openPane($)
    void refresh($)

    return { text: 'PR reviews pane opened.' }
  })

  // The count rides as a pressable badge after the footer's own mode labels, at
  // the right end of the status line's row, instead of a pinned notice line.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const spaced = { ...e, props: { ...e.props, modes: e.props.modes.map(spaceAfterIcon) } }
    const hasError = (await read($, pollError)) !== null
    const label = badgeLabel((await read($, pullRequests)).length, hasError)
    if (label === undefined) return next(spaced)

    const { Box, Button } = $.ui.resolve(e)
    const hasUnseen = (await read($, unseenUrls)).length > 0

    return (
      <Box gap={1}>
        {await next(spaced)}
        <Button
          key="pr-badge"
          label={label}
          variant={hasUnseen || hasError ? 'primary' : undefined}
          onPress={() => openPane($)}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const unseen = await read($, unseenUrls)
    if (e.props.hasSurvey || unseen.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const first = (await read($, pullRequests)).find(pullRequest => pullRequest.url === unseen[0])
    const label =
      unseen.length === 1 && first !== undefined
        ? `Review requested: ${shortRef(first)} ${truncate(first.title, 50)}`
        : `${unseen.length} new PR review requests`

    return (
      <Box gap={1}>
        <Text color="yellow">{label}</Text>
        <Button key="open" label="Review" variant="primary" onPress={() => openPane($)} />
        <Button key="dismiss" label="Dismiss" onPress={() => update($, unseenUrls, () => [])} />
      </Box>
    )
  })

  // The list draws only the rows that fit, so the wheel and page keys move our own window.
  // A tree taller than the body (a short terminal) is left to the engine to scroll.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (e.contentRows > e.bodyRows) return next(e)

    const total = (await visibleList($)).length
    lastListRows = listRowBudget(e.bodyRows)
    await update($, listOffset, offset => clampOffset(offset + e.by, total, lastListRows))
    $.ui.invalidate('ui.render')

    return {}
  }).catch(($, e, next) => next(e))

  // Tab, the arrows or a click landing on a row selects it.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.element?.startsWith(ROW_KEY_PREFIX)) {
      await selectRow($, e.element.slice(ROW_KEY_PREFIX.length))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // The mobile app draws no Input yet, so the pane is for the other surfaces.
    if (e.surface === 'mobile') return next(e)

    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const all = await read($, pullRequests)
    const filter = await read($, filterText)
    const mode = await read($, sortMode)
    const isHiding = await read($, isHidingDrafts)
    const list = organizePullRequests(all, filter, mode, isHiding)
    const url = await read($, selectedUrl)
    const request = await read($, pending)
    const error = await read($, pollError)
    const note = await read($, message)
    const polledAt = await read($, lastPolledAt)
    const draft = await read($, draftComment)
    const unseen = new Set(await read($, unseenUrls))
    const width = Math.max(30, e.props.bodyColumns)
    const now = await $.clock.now()

    const rowBudget = listRowBudget(e.props.scroll.bodyRows)
    lastListRows = rowBudget
    const offset = clampOffset(await read($, listOffset), list.length, rowBudget)
    const rows = list.slice(offset, offset + rowBudget)
    const refWidth = refColumnWidth(rows)
    const selected = list.find(pullRequest => pullRequest.url === url)
    const confirming =
      request !== null ? list.find(pullRequest => pullRequest.url === request.url) : undefined

    const isNarrowed = filter.trim() !== '' || isHiding
    const count = isNarrowed ? `${list.length} of ${all.length}` : `${all.length}`
    const isCapped = all.length >= SEARCH_LIMIT
    let windowLine = ''
    if (list.length > 0) {
      windowLine =
        `${offset + 1}–${offset + rows.length} of ${list.length}` +
        (isCapped ? ` · only the first ${SEARCH_LIMIT} requests are fetched` : '')
    } else if (error === null && polledAt !== null) {
      windowLine = all.length === 0 ? 'Nothing is waiting on your review.' : 'No requests match.'
    }

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold>{`Review requests (${count})`}</Text>
          <Text dimColor>
            {polledAt === null
              ? 'loading…'
              : `updated ${formatAge(new Date(polledAt).toISOString(), now)} ago`}
          </Text>
          <Button key="refresh" label="Refresh" hotkey="f" onPress={() => refresh($)} />
        </Box>

        <Input
          key="filter"
          label="Filter"
          placeholder="repo, title, author or label"
          value={filter}
          onInput={text => setFilter($, text)}
          onSubmit={text => setFilter($, text)}
        />

        <Box gap={1} flexWrap="wrap">
          <Button key="sort" label={`Sort: ${mode}`} hotkey="s" onPress={() => cycleSort($)} />
          <Button
            key="drafts"
            label={isHiding ? 'Show drafts' : 'Hide drafts'}
            hotkey="d"
            onPress={() => toggleDrafts($)}
          />
          <Button key="prev" label="↑ k" hotkey="k" onPress={() => stepSelection($, -1)} />
          <Button key="next" label="↓ j" hotkey="j" onPress={() => stepSelection($, 1)} />
          {filter !== '' && (
            <Button key="clear" label="Clear filter" hotkey="x" onPress={() => setFilter($, '')} />
          )}
        </Box>

        {error !== null && <Text color="red">{`gh: ${truncate(error, width - 4)}`}</Text>}

        {rows.map(pullRequest => (
          <Button
            key={`${ROW_KEY_PREFIX}${pullRequest.url}`}
            plain
            dimColor={pullRequest.url !== url}
            label={formatRow(pullRequest, {
              width,
              nowMs: now,
              refWidth,
              isSelected: pullRequest.url === url,
              isUnseen: unseen.has(pullRequest.url),
            })}
            onPress={() => selectRow($, pullRequest.url)}
          />
        ))}
        <Text dimColor>{windowLine}</Text>

        {selected !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold wrap="truncate">
              {selected.title}
            </Text>
            <Text dimColor wrap="truncate">
              {[
                shortRef(selected),
                `@${selected.author}`,
                `opened ${formatAge(selected.createdAt, now)} ago`,
                `${selected.commentsCount} comments`,
                selected.isDraft ? 'draft' : '',
                ...selected.labels,
              ]
                .filter(part => part !== '')
                .join(' · ')}
            </Text>

            <Box gap={1}>
              <Button key="open" label="Open" hotkey="o" onPress={() => openInBrowser($)} />
              <Button
                key="claude"
                label="Review with Claude"
                hotkey="v"
                onPress={() => reviewWithClaude($)}
              />
            </Box>

            <Input
              key="draft"
              label="Comment"
              placeholder="Text for a review comment (optional for approve)"
              value={draft}
              submitLabel="comment"
              onInput={text => update($, draftComment, () => text)}
              onSubmit={text =>
                update($, draftComment, () => text).then(() => requestAction($, 'comment'))
              }
            />

            {confirming === undefined || request === null ? (
              <Box gap={1}>
                <Button key="approve" label="Approve" onPress={() => requestAction($, 'approve')} />
                <Button
                  key="changes"
                  label="Request changes"
                  onPress={() => requestAction($, 'request-changes')}
                />
                <Button key="comment" label="Comment" onPress={() => requestAction($, 'comment')} />
              </Box>
            ) : (
              <Box gap={1}>
                <Text color="yellow">
                  {`${ACTION_VERBS[request.action]} ${shortRef(confirming)} on GitHub?`}
                </Text>
                <Button
                  key="confirm"
                  label="Confirm"
                  variant="primary"
                  onPress={() => submitReview($, request)}
                />
                <Button key="cancel" label="Cancel" onPress={() => update($, pending, () => null)} />
              </Box>
            )}
          </Box>
        )}

        {note !== '' && (
          <Text dimColor wrap="wrap">
            {note}
          </Text>
        )}
      </Box>
    )
  })
}
