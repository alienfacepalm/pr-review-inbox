# pr-review-inbox

A Claude Code mod that pops up when someone requests your review on a GitHub pull request,
shows the open requests as a list, and lets you act on the one you pick.

- **Pop-up**: a toast when a new request arrives, a band above the prompt (`Review` / `Dismiss`),
  and a `[ ⇄ N PRs ]` badge at the right end of the prompt footer. Click the badge to open the list.
- **List**: `/prs` (or the badge, or the band's `Review` button) opens a pane listing every open PR that is
  waiting on your review (up to 100). It scrolls, filters as you type, sorts and can hide drafts, so dozens of
  requests stay easy to work through. Pick one to see its details.
- **Actions**: open in browser, draft a Claude review prompt, approve, request changes, comment.
  Anything that posts to GitHub asks for a confirm first.

It runs `gh` on your machine, so it uses whichever GitHub account `gh` has active
(`gh auth status`). There is no token handling in the mod.

## Requirements

| Dependency | Needed for | Check |
| --- | --- | --- |
| Claude Code, terminal CLI | the mod runtime (`$.process.run` is CLI only; not drawn on desktop or mobile). Developed on 2.1.293; the minimum is untested. | `claude --version` |
| [GitHub CLI](https://cli.github.com) 2.21 or later | listing (`gh search prs`), open, and review actions. Developed on 2.93.0. | `gh --version` |
| `gh` signed in to the account that gets review requests | every call; the mod has no token handling | `gh auth status`, fix with `gh auth login` |

Nothing else to install: the plugin has no npm packages and no build step. The `claude-code` module it imports
comes from the host. Git is needed only to install from a GitHub marketplace.

If a dependency is missing the mod says so instead of failing silently: the footer shows `⇄ PRs: gh error` and
the pane and toast give the fix (install `gh`, run `gh auth login`, or upgrade `gh`).

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

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `pollMinutes` | `5` | How often to ask GitHub (1 to 60 minutes) |

Set them in `/config` under the plugin's rows.

## Develop

```
claude plugin validate .
claude plugin test .
```

See `doc/USAGE.md` for behavior details and `doc/DESIGN.md` for how it is built.
