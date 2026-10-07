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
  expect((await pane.find({ text: 'gh auth login' }))?.text).toContain('gh: gh is not signed in')
  await pane.unmount()
})

const searchResultOf = (count: number): string =>
  JSON.stringify(
    Array.from({ length: count }, (_, index) => {
      const number = index + 1
      return {
        number,
        title: `Task ${number}`,
        url: `https://github.com/acme/app/pull/${number}`,
        repository: { nameWithOwner: 'acme/app' },
        author: { login: 'sam' },
        isDraft: number % 10 === 0,
        createdAt: new Date(Date.parse('2026-10-05T00:00:00Z') - number * 3_600_000).toISOString(),
        commentsCount: 0,
        labels: [],
      }
    }),
  )

const TALL_PANE = { ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 30 } } } as const

const rowKeysOf = async (ui: { findAll: (query: { type: 'Button' }) => Promise<readonly { key?: string }[]> }) =>
  (await ui.findAll({ type: 'Button' }))
    .map(button => button.key ?? '')
    .filter(key => key.startsWith('pr:'))

const startWith = async ($: any, on: any, count: number) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-06T00:00:00Z') })
  mock.store(on, { seenUrls: [] })

  on('process.run', () => ({ value: ok(searchResultOf(count)) }))
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.register', (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await clock.settle()
}

test('sixty requests draw only the rows that fit, newest first', async ($, on) => {
  await startWith($, on, 60)

  const ui = await $.ui.mount(TALL_PANE)
  const keys = await rowKeysOf(ui)
  expect(keys).toHaveLength(17)
  expect(keys[0]).toBe('pr:https://github.com/acme/app/pull/1')
  expect((await ui.find({ text: /1–17 of 60/ }))?.text).toContain('1–17 of 60')
  await ui.unmount()
})

test('the filter narrows the list and the drafts toggle hides drafts', async ($, on) => {
  await startWith($, on, 60)

  const ui = await $.ui.mount(TALL_PANE)
  await ui.input({ key: 'filter', text: '#5', kind: 'change' })
  expect(await rowKeysOf(ui)).toHaveLength(11)
  expect(await ui.find({ text: /11 of 60/ })).toBeDefined()

  await ui.press({ key: 'drafts' })
  expect(await rowKeysOf(ui)).toHaveLength(10)
  expect(await ui.find({ key: 'pr:https://github.com/acme/app/pull/50' })).toBeUndefined()

  await ui.input({ key: 'filter', text: 'no such pr', kind: 'change' })
  expect(await rowKeysOf(ui)).toHaveLength(0)
  expect(await ui.find({ text: /No requests match/ })).toBeDefined()
  await ui.unmount()
})

test('next steps the selection and the window follows it', async ($, on) => {
  await startWith($, on, 60)

  const ui = await $.ui.mount(TALL_PANE)
  for (let step = 0; step < 20; step += 1) await ui.press({ key: 'next' })

  const keys = await rowKeysOf(ui)
  expect(keys).toContain('pr:https://github.com/acme/app/pull/21')
  expect(keys).not.toContain('pr:https://github.com/acme/app/pull/1')
  const selectedRow = await ui.find({ key: 'pr:https://github.com/acme/app/pull/21' })
  expect(selectedRow?.text.startsWith('>')).toBe(true)
  await ui.unmount()
})

test('a full inbox says it may have been cut off', async ($, on) => {
  await startWith($, on, 100)

  const ui = await $.ui.mount(TALL_PANE)
  expect(await ui.find({ text: /only the first 100 requests/ })).toBeDefined()
  await ui.unmount()
})

test('the wheel moves the list window, and a tall tree is left to the engine', async ($, on) => {
  // Stands in for the engine's own window beneath the plugin; it hears only what the plugin passes on.
  const engineScrolls: number[] = []
  on('ui.scroll', (_$: unknown, e: { by: number }) => {
    engineScrolls.push(e.by)
    return {}
  })

  await startWith($, on, 60)

  const ui = await $.ui.mount(TALL_PANE)
  const scroll = (by: number, contentRows: number) =>
    $.ui.scroll({
      component: 'Pane',
      requestId: 'pr-review',
      offset: 0,
      by,
      bodyRows: 30,
      contentRows,
      origin: { kind: 'person' },
    })

  await scroll(5, 30)
  let keys = await rowKeysOf(ui)
  expect(keys[0]).toBe('pr:https://github.com/acme/app/pull/6')

  await scroll(999, 30)
  keys = await rowKeysOf(ui)
  expect(keys).toHaveLength(17)
  expect(keys[0]).toBe('pr:https://github.com/acme/app/pull/44')

  await scroll(-999, 30)
  expect((await rowKeysOf(ui))[0]).toBe('pr:https://github.com/acme/app/pull/1')

  expect(engineScrolls).toEqual([])

  await scroll(5, 45)
  expect((await rowKeysOf(ui))[0]).toBe('pr:https://github.com/acme/app/pull/1')
  expect(engineScrolls).toEqual([5])
  await ui.unmount()
})

test('the focus ring landing on a row selects it', async ($, on) => {
  on('ui.focus', () => ({}))
  await startWith($, on, 60)

  const ui = await $.ui.mount(TALL_PANE)
  const target = 'pr:https://github.com/acme/app/pull/9'
  await $.ui.focus({
    component: 'Pane',
    requestId: 'pr-review',
    plugin: PLUGIN,
    element: target,
    origin: { kind: 'person' },
  })

  expect((await ui.find({ key: target }))?.text.startsWith('>')).toBe(true)
  expect((await ui.find({ key: 'pr:https://github.com/acme/app/pull/1' }))?.text.startsWith('>')).toBe(false)
  await ui.unmount()
})

test('the footer keeps its own labels but widens the gap after an icon', async ($, on) => {
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

  const ui = await $.ui.mount({ ...FOOTER, props: { modes: ['⏸ plan mode on'] } })
  expect(await ui.find({ text: '⏸  plan mode on' })).toBeDefined()
  await ui.unmount()
})
