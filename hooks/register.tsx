import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { IPendingAction, IPullRequest, TReviewAction } from '../types'
import {
  ACTION_VERBS,
  badgeLabel,
  describeFresh,
  diffInbox,
  explainGhFailure,
  formatAge,
  mockPullRequests,
  openArgv,
  parsePullRequests,
  reviewArgv,
  searchArgv,
  shortRef,
  truncate,
} from './github'

type TEngine = EngineInterface

const PANE = 'pr-review'
const SEEN_KEY = 'seenUrls'
const DEFAULT_POLL_MINUTES = 5
const LIST_ROWS = 8
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

// Module variables restart on a hot reload, which only costs one repeated toast.
let isPolling = false
let lastErrorText = ''
let isMockMode = false

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
  if (isMockMode) return mockPullRequests(await $.clock.now())

  const run = await $.process.run(searchArgv(), { timeoutMs: 30_000 })
  if (run.exitCode !== 0) {
    throw new Error(firstLine(run.stderr) || `gh exited with code ${run.exitCode}`)
  }

  return parsePullRequests(run.stdout)
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
    await update($, selectedUrl, url =>
      url !== null && currentUrls.has(url) ? url : (current[0]?.url ?? null),
    )
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
  await $.ui.open({ id: PANE, title: 'PR reviews', focus: true })
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
    if (isMockMode) {
      await update($, pending, () => null)
      await say($, 'Mock data: nothing was sent to GitHub.')
      return
    }

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

    if (isMockMode) {
      await say($, 'Mock data: nothing was opened.')
      return
    }

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
  isMockMode = options.shouldUseMockData === true

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
    const hasError = (await read($, pollError)) !== null
    const label = badgeLabel((await read($, pullRequests)).length, hasError)
    if (label === undefined) return next(e)

    const { Box, Button } = $.ui.resolve(e)
    const hasUnseen = (await read($, unseenUrls)).length > 0

    return (
      <Box gap={1}>
        {await next(e)}
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    // The mobile app draws no Input yet, so the pane is for the other surfaces.
    if (e.surface === 'mobile') return next(e)

    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const list = await read($, pullRequests)
    const url = await read($, selectedUrl)
    const request = await read($, pending)
    const error = await read($, pollError)
    const note = await read($, message)
    const polledAt = await read($, lastPolledAt)
    const draft = await read($, draftComment)
    const width = Math.max(30, e.props.bodyColumns)
    const now = await $.clock.now()

    const selectedIndex = Math.max(0, list.findIndex(pullRequest => pullRequest.url === url))
    const start = Math.min(
      Math.max(0, selectedIndex - Math.floor(LIST_ROWS / 2)),
      Math.max(0, list.length - LIST_ROWS),
    )
    const rows = list.slice(start, start + LIST_ROWS)
    const selected = list.find(pullRequest => pullRequest.url === url)
    const confirming =
      request !== null ? list.find(pullRequest => pullRequest.url === request.url) : undefined

    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text bold>{`Review requests (${list.length})`}</Text>
          <Text dimColor>
            {polledAt === null
              ? 'loading…'
              : `updated ${formatAge(new Date(polledAt).toISOString(), now)} ago`}
          </Text>
          <Button key="refresh" label="Refresh" hotkey="f" onPress={() => refresh($)} />
        </Box>

        {error !== null && <Text color="red">{`gh: ${truncate(error, width - 4)}`}</Text>}
        {error === null && list.length === 0 && polledAt !== null && (
          <Text dimColor>Nothing is waiting on your review.</Text>
        )}

        {start > 0 && <Text dimColor>{`  ↑ ${start} more`}</Text>}
        {rows.map(pullRequest => (
          <Button
            key={`pr:${pullRequest.url}`}
            plain
            dimColor={pullRequest.url !== url}
            label={truncate(
              `${pullRequest.url === url ? '>' : ' '} ${shortRef(pullRequest)}  ${pullRequest.title}  @${pullRequest.author}`,
              width - 2,
            )}
            onPress={async () => {
              await update($, selectedUrl, () => pullRequest.url)
              await update($, pending, () => null)
            }}
          />
        ))}
        {start + rows.length < list.length && (
          <Text dimColor>{`  ↓ ${list.length - start - rows.length} more`}</Text>
        )}

        {selected !== undefined && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold wrap="wrap">
              {selected.title}
            </Text>
            <Text dimColor wrap="wrap">
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
            <Text dimColor>{selected.url}</Text>

            <Box gap={1} marginTop={1}>
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
