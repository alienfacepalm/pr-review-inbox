# Design

- `hooks/register.tsx`: hooks. `session.start` registers `/prs`, polls once and starts `$.clock.every`.
  `ui.render` hooks draw the footer badge (wrapping the engine's `SessionMode` labels), the `AbovePrompt` band
  and the `Pane`. `ui.scroll` and `ui.focus` hooks drive the pane's own list window and selection. Helpers that receive `$` are top-level function declarations, which `claude plugin validate`
  requires.
- `tests/`: `github.test.ts` for helpers, `register.test.ts` drives session start, the footer badge, the pane and the
  confirm flow with `process.run` mocked beneath the plugin (and the engine's footer stubbed beneath the badge).
- `hooks/github.ts`: pure helpers (argv builders, `gh` JSON parsing, new-request diff, filter/sort, list windowing,
  row formatting). No `$`.
- `types/index.d.ts`: the `$.state` contract (`pr-review-inbox.*`) and shared types.

Notes

- Pane state lives in `$.state` so a hot reload keeps it; the dedupe list lives in `$.store` so it survives sessions.
- The PR count is a pressable footer badge rather than `$.ui.status`, which pins a separate notice line under the
  prompt. A gh failure shows as an error badge; the pane holds the error text, run through `explainGhFailure` so a missing, signed-out or too-old `gh` (the plugin's only external dependency) says how to fix it.
- The pane has no scroll box, so the list is windowed by hand: only the rows that fit `scroll.bodyRows` (minus
  `CHROME_ROWS` for the header, filter, controls, detail and actions) are drawn, which keeps 100 requests as cheap as 10.
  `listOffset` is the window, moved by the `ui.scroll` hook (wheel, page keys) and by `j`/`k`. When the tree is taller
  than the body (a short terminal) the hook passes the scroll to the engine instead. The `ui.focus` hook selects the
  row the Tab/arrow ring lands on. The list is filtered, then sorted, before it is windowed; a background poll
  re-clamps the window but never moves it to the selection.
- `gh search` cannot OR qualifiers, so each reason in `SEARCH_REASONS` (review requested, assigned) is its own search,
  run in parallel and merged by URL (`mergePullRequests`); each PR keeps its `reasons`. Either search failing fails the
  poll. Each asks for `SEARCH_LIMIT` (100) results; when one comes back full the `isTruncated` state shows a notice in
  the pane, since the inbox may have been cut off.
- The `SessionMode` hook rewrites the engine's mode labels to put two spaces after a leading icon: terminals that draw
  `⏸` two cells wide otherwise glue it to the text.
- `reviewPrompt` builds the review request for both buttons. `Review in background` calls `$.agent.spawn` (a
  background `general-purpose` subagent), so the diff is read in a fresh context and only its summary returns. It cannot
  take an env, so the prompt carries the account hint; the mod never gives the subagent a token.
- Posting actions are two-step on purpose (select action, then `Confirm`).
- Review bodies go through `--body-file -` on stdin to avoid quoting and length problems on Windows.
- Accounts: `gh search ... @me` means gh's active account, so two machines with different active accounts saw
  different inboxes. Each poll runs `gh auth status` (`parseAccounts`) and searches once per account, setting
  `GH_TOKEN` from `gh auth token --user` in the `env` of that `$.process.run` call. `gh auth switch` is never used: it
  changes global gh state for every terminal, and parallel searches would race it. Tokens live in local variables
  only, never in `$.state` or `$.store`. Accounts are searched with `Promise.allSettled`, so one bad token does not
  blank the rest (`accountNotice`); the seen list keeps a failed account's old URLs so recovery does not re-toast them.
  `IPullRequest.accounts` is unioned in `mergePullRequests` like `reasons`. Posting and Open use `actingAccount`. Claude's own
  `gh` calls cannot be given an env by the mod, so the drafted prompt tells it to set `GH_TOKEN` itself.
