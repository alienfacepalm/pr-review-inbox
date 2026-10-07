# pr-review-inbox

A Claude Code mod that pops up when someone requests your review on a GitHub pull request,
shows the open requests as a list, and lets you act on the one you pick.

- **Pop-up**: a toast when a new request arrives, a band above the prompt (`Review` / `Dismiss`),
  and a `[ ⇄ N PRs ]` badge at the right end of the prompt footer. Click the badge to open the list.
- **List**: `/prs` (or the badge, or the band's `Review` button) opens a pane listing every open PR that is
  waiting on your review. Pick one to see its details.
- **Actions**: open in browser, draft a Claude review prompt, approve, request changes, comment.
  Anything that posts to GitHub asks for a confirm first.

It runs `gh` on your machine, so it uses whichever GitHub account `gh` has active
(`gh auth status`). There is no token handling in the mod.

## Requirements

- Claude Code terminal session (the mod uses `$.process.run`, which is CLI only)
- [GitHub CLI](https://cli.github.com) signed in: `gh auth login`

## Install

From GitHub (any device with Claude Code and `gh` signed in):

```
/plugin marketplace add alienfacepalm/pr-review-inbox
/plugin install pr-review-inbox@alienfacepalm
```

or, from a local folder:

```
claude plugin marketplace add <path-to-this-folder>
claude plugin install pr-review-inbox@alienfacepalm
```

Restart Claude Code or run `/reload-plugins`, then run `/prs`. Pick up later versions with
`/plugin marketplace update` (bump `version` in `plugin.json` when you release).

For development: `claude --plugin-dir <path-to-this-folder>`.

`dev-fake-gh/gh.exe` is a Windows-only demo binary built from `gh.cs`; it is not committed. Build it with
`csc` to run `dev-fake-gh/run-demo.ps1`.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `pollMinutes` | `5` | How often to ask GitHub (1 to 60 minutes) |
| `shouldUseMockData` | `false` | List three sample PRs instead of calling `gh`. Open and review actions send nothing to GitHub. |

Set them in `/config` under the plugin's rows.

## Develop

```
claude plugin validate .
claude plugin test .
```

See `doc/USAGE.md` for behavior details and `doc/DESIGN.md` for how it is built.
