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
  `↑ k` and `↓ j` to move the selection.
- **List**: one aligned line per request: `>` marks the selection and `●` a request you have not looked at, then
  `repo#N`, the title (`[draft]` for drafts), `@author` and the age. The author column drops out on a narrow pane.
  Only the rows that fit are drawn; the line under the list shows `first–last of total`. Scroll with the mouse wheel
  or the page keys, or step with `j` / `k`. Pressing a row, or moving the focus ring (Tab, arrows) onto it, selects it.
  On a very short terminal the pane body itself scrolls instead of the list.
- **Detail**: below the list, always in view: title, repository, author, age, comment count, draft flag and labels.

For the selected PR:

- `Open` (hotkey `o`): `gh pr view <url> --web`.
- `Review with Claude` (hotkey `v`): fills the prompt with a review request for that PR. It does not send it:
  press Esc to return to the prompt, edit, then send. The prompt tells Claude not to post to GitHub.
- `Comment` field: text for the review body. Enter in the field starts a comment review.
- `Approve`, `Request changes`, `Comment`: each asks `<verb> repo#N on GitHub?` with `Confirm` / `Cancel`
  before anything is posted. `Request changes` and `Comment` need text in the field; `Approve` does not.
  The text is sent to `gh pr review` on stdin.

After a review is posted the pane refreshes. GitHub drops you from the requested reviewers, so the PR leaves the list.

## What counts as a request

Two searches, merged by URL (a PR found by both shows once, tagged `review requested + assigned`):

- `gh search prs --review-requested=@me --state=open --limit 100`: open PRs where you are asked directly.
  Requests made only to a team you belong to are not included.
- `gh search prs --assignee=@me --state=open --limit 100`: open PRs you are an assignee of. Add yourself as an
  assignee on GitHub and the PR appears at the next poll (or press `Refresh`).

Each search returns at most 100; the pane says so when either comes back full. The detail line under the list shows
why a PR is there (`review requested`, `assigned`), and typing `assigned` or `review` in the filter narrows by it.

## First run

The first poll ever seeds the list silently, so an existing backlog does not toast all at once.
Later polls (including in new sessions) notify for anything not seen before. A PR that leaves the list and is
requested again notifies again.

State kept across sessions: `seenUrls` in the plugin's `$.store`.

## Troubleshooting

- `⇄ PRs: gh error` badge: click it; the pane shows what is wrong and how to fix it:
  - `GitHub CLI (gh) not found`: install it from https://cli.github.com, then restart Claude Code.
  - `gh is not signed in`: run `gh auth login` (check with `gh auth status`).
  - `gh is too old for "gh search"`: upgrade `gh` to 2.21 or later (`gh --version`).
  - Any other text is `gh`'s own first error line.
- Wrong account: `gh auth switch`, then `/prs`.
- Nothing appears on desktop or mobile: the mod needs the terminal CLI (`$.process.run`); the pane is not drawn on mobile.
