# Design

- `hooks/register.tsx`: hooks. `session.start` registers `/prs`, polls once and starts `$.clock.every`.
  `ui.render` hooks draw the footer badge (wrapping the engine's `SessionMode` labels), the `AbovePrompt` band
  and the `Pane`. Helpers that receive `$` are top-level function declarations, which `claude plugin validate`
  requires.
- `tests/`: `github.test.ts` for helpers, `register.test.ts` drives session start, the footer badge, the pane and the
  confirm flow with `process.run` mocked beneath the plugin (and the engine's footer stubbed beneath the badge).
- `hooks/github.ts`: pure helpers (argv builders, `gh` JSON parsing, new-request diff, formatting). No `$`.
- `types/index.d.ts`: the `$.state` contract (`pr-review-inbox.*`) and shared types.

Notes

- Pane state lives in `$.state` so a hot reload keeps it; the dedupe list lives in `$.store` so it survives sessions.
- The PR count is a pressable footer badge rather than `$.ui.status`, which pins a separate notice line under the
  prompt. A gh failure shows as an error badge; the pane holds the error text, run through `explainGhFailure` so a missing, signed-out or too-old `gh` (the plugin's only external dependency) says how to fix it.
- Posting actions are two-step on purpose (select action, then `Confirm`).
- Review bodies go through `--body-file -` on stdin to avoid quoting and length problems on Windows.
- Account choice is left to `gh`. Supporting several accounts would mean handling tokens, which this mod avoids.
