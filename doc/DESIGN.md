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
- The fetch asks `gh` for `SEARCH_LIMIT` (100) requests; a result that long shows a notice in the pane, since the
  inbox may have been cut off.
- The `SessionMode` hook rewrites the engine's mode labels to put two spaces after a leading icon: terminals that draw
  `⏸` two cells wide otherwise glue it to the text.
- Posting actions are two-step on purpose (select action, then `Confirm`).
- Review bodies go through `--body-file -` on stdin to avoid quoting and length problems on Windows.
- Account choice is left to `gh`. Supporting several accounts would mean handling tokens, which this mod avoids.
