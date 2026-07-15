---
name: git-workflow
description: Local Git workflow for Intelligence using bounded read tools and confirmed GitRepository record actions
tools: ["git_status", "git_diff", "git_log", "git_branches", "git_branch", "git_add", "git_commit", "git_push", "git_fetch", "git_pull"]
---

1. Start with the direct read tools: use `git_status`, then `git_diff`; use
   `staged=true` to review the index or `base` (and optional `head`) for a
   triple-dot range. Use `git_log` and `git_branches` when history or upstream
   state matters.
2. Use `git_branch` with `create=true` when a feature branch is needed. The same
   tool checks out an existing branch with `create=false`; there is no
   `git_checkout` tool.
3. Use `git_add` with explicit pathspecs. Re-run `git_diff` with `staged=true`,
   summarize exactly what will ship, and exclude secret files.
4. Use `git_commit` with a concise message focused on why. Hooks run by default;
   set `skipHooks=true` only when the user explicitly requests it.
5. Use `git_fetch` or `git_pull` only when remote synchronization is needed.
   `git_pull` is fast-forward-only by default.
6. Use `git_push` to push `HEAD` to the same branch name on `origin` and set its
   upstream by default. Then use **godmode-plugin-github** (`gh_pr_create`) when
   a pull request is needed.

`git_branch`, `git_add`, `git_commit`, `git_push`, `git_fetch`, and `git_pull`
are confirm-mode compatibility tools over record actions on
`GitRepository/coding-root`. They use the kernel client and its confirmation
grant flow; do not call a legacy plugin route or construct an HTTP action
request manually.
