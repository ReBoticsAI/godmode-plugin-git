---
name: git-workflow
description: Local git workflow for Intelligence — status, diff, stage, commit, push via plugin tools
tools: ["git_status", "git_diff", "git_log", "git_branches", "git_branch", "git_add", "git_commit", "git_push", "git_fetch", "git_pull"]
---

1. `git_status` — note branch and dirty files.
2. `git_diff` (and staged diff if needed) — summarize what will ship; exclude secret files.
3. `git_branch` with `create=true` when you need a feature branch (avoid committing straight to main unless asked).
4. `git_add` with explicit pathspecs for the change set.
5. `git_commit` with a concise message focused on why.
6. `git_push` to origin (confirm). Then use **godmode-plugin-github** (`gh_pr_create`) when a pull request is needed.
