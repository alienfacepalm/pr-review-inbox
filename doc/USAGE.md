# Using pr-review-inbox

## What you see

| Where | What |
| --- | --- |
| Toast (top right) | `Review requested: owner/repo#123 "title" by @author`, or `Assigned to you: ...` for a PR you were assigned to. More than three at once collapse to `N new PRs in your inbox`. |
| Band above the prompt | Shown while there are requests you have not looked at. `Review` opens the pane, `Dismiss` clears the band. |
| Footer badge (right end of the prompt footer, after the mode labels) | `[ ⇄ N PRs ]`; click it to open the pane. Highlighted while there are requests you have not looked at. Hidden when nothing waits. `[ ⇄ PRs: gh error ]` when `gh` fails; the pane shows the error. |
| `/prs` | Opens the pane and refreshes. |

## The pane

The pane asks for a tall, wide body and fits itself to whatever it gets, so it works with dozens of requests.

- **Header**: the count (`N`, or `shown of total` while a filter or `Hide drafts` is on), when it last updated, and
  `Refresh` (hotkey `f`).
- **Filter**: type in the `Filter` field to narrow the list as you type. Every word must match the repo, number,
  title, author or a label (case-insensitive). `Clear filter` (hotkey `x`) appears while a filter is set.
- **Controls**: `Sort: newest|oldest|repo` (hotkey `s`, cycles), `Hide drafts` / `Show drafts` (hotkey `d`),
  `Account: all|<name>` (hotkey `a`, cycles; drawn only when `gh` is signed in to more than one account),
  `↑ k` and `↓ j` to move the selection.
- **List**: one aligned line per request: `>` marks the selection and `●` a request you have not looked at, then
  `repo#N`, the title (`[draft]` for drafts), `@author` and the age. The author column drops out on a narrow pane.
  Only the rows that fit are drawn; the line under the list shows `first–last of total`. Scroll with the mouse wheel
  or the page keys, or step with `j` / `k`. Pressing a row, or moving the focus ring (Tab, arrows) onto it, selects it.
  On a very short terminal the pane body itself scrolls instead of the list.
- **Detail**: below the list, always in view: title, repository, why it is there, the account that sees it, author,
  age, comment count, draft flag and labels.

For the selected PR:

- `Open` (hotkey `o`): `gh pr view <url> --web`.
- `Review with Claude` (hotkey `v`): fills the prompt with a review request for that PR. It does not send it:
  press Esc to return to the prompt, edit, then send. The prompt tells Claude not to post to GitHub, and names the
  account that owns the PR with how to get its token (`gh auth token --user <account>`), because Claude's own
  `gh` calls run as the active account, which may not see a private repo.
- `Review in background` (hotkey `b`): starts a subagent with an empty context that reads the PR and reports a
  summary (what it changes, risks, review comments you could leave). Only the summary comes back to this session, so a
  big diff does not fill a session that is already deep. Nothing is posted. Use it when the session is long or the diff
  is large; use `Review with Claude` for a small PR you want to discuss in the current session.
- `Comment` field: text for the review body. Enter in the field starts a comment review.
- `Approve`, `Request changes`, `Comment`: each asks `<verb> repo#N on GitHub?` with `Confirm` / `Cancel`
  before anything is posted. `Request changes` and `Comment` need text in the field; `Approve` does not.
  The text is sent to `gh pr review` on stdin.

After a review is posted the pane refreshes. GitHub drops you from the requested reviewers, so the PR leaves the list.

## What counts as a request

Two searches per signed-in account (`gh auth status` lists them), all merged by URL (a PR found by both shows once,
tagged `review requested + assigned`, and lists every account that sees it). Each account's searches run with its own
token, so `@me` below means that account, not whichever one `gh` has active:

- `gh search prs --review-requested=@me --state=open --limit 100`: open PRs where you are asked directly.
  Requests made only to a team you belong to are not included.
- `gh search prs --assignee=@me --state=open --limit 100`: open PRs you are an assignee of. Add yourself as an
  assignee on GitHub and the PR appears at the next poll (or press `Refresh`).

Each search returns at most 100; the pane says so when any comes back full. If one account cannot be read (expired
token, no token), the other accounts still show and the pane says `Not read: <account>: <reason>`; the poll only
fails, with the `gh error` badge, when every account fails. If `gh` lists no accounts, one search runs as its
active account. The detail line under the list shows why a PR is there (`review requested`, `assigned`) and which
account sees it; typing `assigned`, `review` or an account name in the filter narrows by it.

Approve, Request changes, Comment and Open run as the PR's account: the one the `Account` button is on if it sees the
PR, otherwise the first account that does.

## First run

The first poll ever seeds the list silently, so an existing backlog does not toast all at once.
Later polls (including in new sessions) notify for anything not seen before. A PR that leaves the list and is
requested again notifies again.

State kept across sessions: `seenUrls` in the plugin's `$.store`.

## Troubleshooting

- `⇄ PRs: gh error` badge: click it; the pane shows what is wrong and how to fix it:
  - `GitHub CLI (gh) not found`: install it from https://cli.github.com, then restart Claude Code.
  - `gh is not signed in`: run `gh auth login` (check with `gh auth status`).
  - `gh is too old for "gh search"` or `gh is too old for several accounts`: upgrade `gh` to 2.46 or later (`gh --version`).
  - Any other text is `gh`'s own first error line.
- An account is missing or has no PRs: check `gh auth status`. Sign in with `gh auth login`, or repair a broken login
  with `gh auth login` / `gh auth refresh`, then `Refresh`. There is no need for `gh auth switch`.
- Nothing appears on desktop or mobile: the mod needs the terminal CLI (`$.process.run`); the pane is not drawn on mobile.
