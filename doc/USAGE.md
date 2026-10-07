# Using pr-review-inbox

## What you see

| Where | What |
| --- | --- |
| Toast (top right) | `Review requested: owner/repo#123 "title" by @author`. More than three at once collapse to `N new PR review requests`. |
| Band above the prompt | Shown while there are requests you have not looked at. `Review` opens the pane, `Dismiss` clears the band. |
| Footer badge (right end of the prompt footer, after the mode labels) | `[ ⇄ N PRs ]`; click it to open the pane. Highlighted while there are requests you have not looked at. Hidden when nothing waits. `[ ⇄ PRs: gh error ]` when `gh` fails; the pane shows the error. |
| `/prs` | Opens the pane and refreshes. |

## The pane

The top line has the count, when it last updated, and `Refresh` (hotkey `f`).
Below it is the list of requests (up to 8 rows, scrolling with the selection). Press a row to select it.

For the selected PR the pane shows title, repository, author, age, comment count, draft flag, labels and URL, then:

- `Open` (hotkey `o`): `gh pr view <url> --web`.
- `Review with Claude` (hotkey `v`): fills the prompt with a review request for that PR. It does not send it:
  press Esc to return to the prompt, edit, then send. The prompt tells Claude not to post to GitHub.
- `Comment` field: text for the review body. Enter in the field starts a comment review.
- `Approve`, `Request changes`, `Comment`: each asks `<verb> repo#N on GitHub?` with `Confirm` / `Cancel`
  before anything is posted. `Request changes` and `Comment` need text in the field; `Approve` does not.
  The text is sent to `gh pr review` on stdin.

After a review is posted the pane refreshes. GitHub drops you from the requested reviewers, so the PR leaves the list.

## What counts as a request

`gh search prs --review-requested=@me --state=open`: open PRs where you are asked directly.
Requests made only to a team you belong to are not included.

## First run

The first poll ever seeds the list silently, so an existing backlog does not toast all at once.
Later polls (including in new sessions) notify for anything not seen before. A PR that leaves the list and is
requested again notifies again.

State kept across sessions: `seenUrls` in the plugin's `$.store`.

## Mock data

Turn on `shouldUseMockData` (in `/config`, then `/reload-plugins`) to fill the pane with three sample PRs
without `gh` or a network. `Open` and the review buttons then report `Mock data: nothing was ...` and
do nothing. Turn it off to go back to your real requests.

## Troubleshooting

- `⇄ PRs: gh error` badge: click it; the pane shows what is wrong and how to fix it:
  - `GitHub CLI (gh) not found`: install it from https://cli.github.com, then restart Claude Code.
  - `gh is not signed in`: run `gh auth login` (check with `gh auth status`).
  - `gh is too old for "gh search"`: upgrade `gh` to 2.21 or later (`gh --version`).
  - Any other text is `gh`'s own first error line.
- Wrong account: `gh auth switch`, then `/prs`.
- Nothing appears on desktop or mobile: the mod needs the terminal CLI (`$.process.run`); the pane is not drawn on mobile.
