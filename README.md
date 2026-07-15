# GodMode Git plugin

Official marketplace plugin: structured **git** tools for Intelligence over the coding root.

## Requirements

- `git` on the host PATH
- GodMode kernel client API version 1. The plugin rejects a mismatched host before
  registering its ObjectType or tools.
- Working directory must be a git checkout (local GodMode / operator workspace). Hub tenant sandboxes only work if they are real clones with remotes.

## Kernel model

The plugin registers an adapter-backed `GitRepository` ObjectType with one
tenant-local record:

- ObjectType: `GitRepository`
- record ID: `coding-root`
- operations: `list`, `get`
- record actions: `branch`, `add`, `commit`, `push`, `fetch`, `pull`

The generic HTTP form of those actions is:

`POST /api/records/GitRepository/coding-root/actions/:action`

The JSON request body is the action input itself. HTTP clients send
`X-Kernel-Confirmation` when satisfying a confirmation challenge. The plugin's
compatibility tools do not make that HTTP request: they call the versioned
in-process `api.kernel.runAction(...)` client against the same record action.

## Tools

| Tool | Mode | Purpose |
|------|------|---------|
| `git_status` | auto | Branch + porcelain status |
| `git_diff` | auto | Unstaged, staged, triple-dot revision-range, or path-limited diff |
| `git_log` | auto | Up to 50 recent commits |
| `git_branches` | auto | List local branches and upstream details |
| `git_branch` | confirm | Check out a branch, creating it when `create=true` |
| `git_add` | confirm | Stage pathspecs |
| `git_commit` | confirm | Commit staged changes; hooks run unless `skipHooks=true` |
| `git_push` | confirm | Push `HEAD` to the same branch name; set upstream by default |
| `git_fetch` | confirm | Fetch the Git-configured default or one optional remote |
| `git_pull` | confirm | Pull the configured upstream or one optional remote; ff-only by default |

## Auth / safety

- The four read tools execute bounded Git reads directly. The six confirm-mode
  tools are semantic wrappers over the corresponding `GitRepository` record
  actions.
- Every action requires kernel confirmation. `branch`, `add`, and `commit` have
  `write` effect; `push`, `fetch`, and `pull` have `external` effect.
- A confirmed compatibility tool first calls `api.kernel.runAction(...)`. If the
  kernel returns `KERNEL_CONFIRMATION_REQUIRED`, the wrapper retries once with
  the returned confirmation grant because the host tool gate was already
  approved.
- Every `cwd` is contained by the active tenant coding root.
- Force push and hard reset are **rejected** in this plugin.
- Git is spawned directly without a Windows command shell.
- Does not store credentials; uses the host git config / credential helper.

## Verification

`npm run validate` runs TypeScript checking, the Vitest contract/security/tenant
suite, and the production bundle. The contract tests validate the ObjectType
definition, action policy, API-version fail-fast behavior, semantic tool
delegation, and confirmation-grant retry.

## Install

Marketplace → Official → **Git**, or Unofficial with this repo URL. GodMode builds `dist/` on activate if needed.

See also **GitHub** plugin (`godmode-plugin-github`) for PRs and CI.
