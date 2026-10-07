import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'pr-review-inbox'
const PR_URL = 'https://github.com/acme/app/pull/7'
const SEARCH_RESULT = JSON.stringify([
  {
    number: 7,
    title: 'Fix login',
    url: PR_URL,
    repository: { nameWithOwner: 'acme/app' },
    author: { login: 'sam' },
    isDraft: false,
    createdAt: '2026-10-05T00:00:00Z',
    commentsCount: 2,
    labels: [],
  },
])

const PANE = {
  plugin: PLUGIN,
  surface: 'terminal',
  component: 'Pane',
  requestId: 'pr-review',
  props: {
    title: 'PR reviews',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const FOOTER = {
  plugin: PLUGIN,
  surface: 'terminal',
  component: 'SessionMode',
  props: { modes: ['focus'] },
} as const

// Stands in for the engine's own footer: the dim mode labels, joined as it joins them.
const engineFooter = (_$: unknown, e: { props: { modes: readonly string[] } }) => ({
  type: 'Text' as const,
  props: { dimColor: true },
  children: [e.props.modes.join(' & ')],
})

const ok = (stdout: string) => ({
  exitCode: 0,
  stdout,
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
})

test('a new request toasts, the pane lists it, and a review posts only after confirm', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T00:00:00Z') })
  mock.store(on, { seenUrls: [] })

  const calls: { argv: readonly string[]; stdin: string | undefined }[] = []
  const toasts: string[] = []
  on('process.run', (_$, e) => {
    calls.push({ argv: e.argv, stdin: e.init?.stdin })
    return { value: ok(e.argv[1] === 'search' ? SEARCH_RESULT : '') }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(toasts.join('\n')).toContain('acme/app#7')

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: `pr:${PR_URL}` })).toBeDefined()

  await ui.press({ key: 'approve' })
  expect(calls.some(call => call.argv.includes('review'))).toBe(false)
  expect(await ui.find({ key: 'confirm' })).toBeDefined()

  await ui.press({ key: 'confirm' })
  const review = calls.find(call => call.argv.includes('review'))
  expect(review?.argv).toEqual(['gh', 'pr', 'review', PR_URL, '--approve'])
  await ui.unmount()
})

test('request changes needs text and sends it on stdin', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T00:00:00Z') })
  mock.store(on, { seenUrls: [PR_URL] })

  const calls: { argv: readonly string[]; stdin: string | undefined }[] = []
  on('process.run', (_$, e) => {
    calls.push({ argv: e.argv, stdin: e.init?.stdin })
    return { value: ok(e.argv[1] === 'search' ? SEARCH_RESULT : '') }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'changes' })
  expect(await ui.find({ key: 'confirm' })).toBeUndefined()

  await ui.input({ key: 'draft', text: 'please add tests', kind: 'change' })
  await ui.press({ key: 'changes' })
  await ui.press({ key: 'confirm' })

  const review = calls.find(call => call.argv.includes('review'))
  expect(review?.argv).toEqual([
    'gh', 'pr', 'review', PR_URL, '--request-changes', '--body-file', '-',
  ])
  expect(review?.stdin).toBe('please add tests')
  await ui.unmount()
})

test('the footer badge counts the requests, keeps the mode labels, and opens the pane', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T00:00:00Z') })
  mock.store(on, { seenUrls: [PR_URL] })

  const statuses: (string | undefined)[] = []
  const opened: string[] = []
  on('process.run', () => ({ value: ok(SEARCH_RESULT) }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'SessionMode' }, engineFooter)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount(FOOTER)
  expect((await ui.find({ key: 'pr-badge' }))?.text).toContain('⇄ 1 PR')
  expect(await ui.find({ text: 'focus' })).toBeDefined()

  await ui.press({ key: 'pr-badge' })
  expect(opened).toEqual(['pr-review'])
  expect(statuses.filter(text => text !== undefined)).toEqual([])
  await ui.unmount()
})

test('no badge when nothing waits on review', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T00:00:00Z') })
  mock.store(on, { seenUrls: [] })

  on('process.run', () => ({ value: ok('[]') }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'SessionMode' }, engineFooter)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount(FOOTER)
  expect(await ui.find({ key: 'pr-badge' })).toBeUndefined()
  expect(await ui.find({ text: 'focus' })).toBeDefined()
  await ui.unmount()
})

test('a failing gh shows an error badge instead of a status line', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T00:00:00Z') })
  mock.store(on, { seenUrls: [] })

  const statuses: (string | undefined)[] = []
  on('process.run', () => ({
    value: {
      exitCode: 4,
      stdout: '',
      stderr: 'To get started with GitHub CLI, please run:  gh auth login\n',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'SessionMode' }, engineFooter)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', (_$, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const footer = await $.ui.mount(FOOTER)
  expect((await footer.find({ key: 'pr-badge' }))?.text).toContain('gh error')
  expect(statuses.filter(text => text !== undefined)).toEqual([])
  await footer.unmount()

  const pane = await $.ui.mount(PANE)
  expect((await pane.find({ text: 'gh auth login' }))?.text).toContain('gh: To get started')
  await pane.unmount()
})

test('mock mode lists sample PRs and never runs gh', { options: { shouldUseMockData: true } }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T00:00:00Z') })
  mock.store(on, { seenUrls: [] })

  const calls: (readonly string[])[] = []
  on('process.run', (_$, e) => {
    calls.push(e.argv)
    return { value: ok('') }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ key: 'pr:https://github.com/acme/web-app/pull/128' })).toBeDefined()
  expect(await ui.find({ key: 'pr:https://github.com/acme/billing/pull/9' })).toBeDefined()

  await ui.press({ key: 'open' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'confirm' })
  expect(calls).toEqual([])
  await ui.unmount()
})
