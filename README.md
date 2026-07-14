# GodMode Git plugin

Official marketplace plugin: structured **git** tools for Intelligence over the coding root.

## Requirements

- `git` on the host PATH
- Working directory must be a git checkout (local GodMode / operator workspace). Hub tenant sandboxes only work if they are real clones with remotes.

## Tools

| Tool | Mode | Purpose |
|------|------|---------|
| `git_status` | auto | Branch + porcelain status |
| `git_diff` | auto | Staged / unstaged / range (size-capped) |
| `git_log` | auto | Recent commits |
| `git_branches` | auto | List branches |
| `git_checkout` | confirm | Create (`create=true`) and/or checkout a branch |
| `git_add` | confirm | Stage pathspecs |
| `git_commit` | confirm | Commit staged changes (no force amend in v1) |
| `git_push` | confirm | Push current branch (no `--force`) |
| `git_fetch` | auto | Fetch remotes |
| `git_pull` | confirm | Pull with ff-only by default |

## Auth / safety

- Mutating tools use confirm mode.
- Force push and hard reset are **rejected** in this plugin.
- Does not store credentials; uses the host git config / credential helper.

## Install

Marketplace → Official → **Git**, or Unofficial with this repo URL. GodMode builds `dist/` on activate if needed.

See also **GitHub** plugin (`godmode-plugin-github`) for PRs and CI.
