# Git Cheatsheet

A quick reference for the git commands I reach for most often.

## Inspecting state

| Command | What it does |
| --- | --- |
| `git status` | Show working tree status |
| `git log --oneline -20` | Last 20 commits, compact |
| `git diff` | Unstaged changes |
| `git diff --staged` | Staged changes |
| `git blame <file>` | Who last touched each line |

## Undoing things

- `git restore <file>` — discard unstaged changes to a file
- `git restore --staged <file>` — unstage without losing changes
- `git reset --soft HEAD~1` — undo last commit, keep changes staged
- `git reset --hard HEAD~1` — undo last commit, **destroy changes**
- `git revert <sha>` — create a new commit that undoes `<sha>` (safe for shared branches)

## Branching

```sh
git switch -c feature/x        # create and switch
git switch main                # switch to existing
git branch -d feature/x        # delete merged branch
git branch -D feature/x        # force delete
```

## Rebasing

```sh
git fetch origin
git rebase origin/main         # replay your commits on top of main
git rebase --continue          # after resolving conflicts
git rebase --abort             # bail out
```

> Never rebase commits that have been pushed and that others might be using.

## Stashing

```sh
git stash push -m "wip: foo"   # stash with a label
git stash list                 # see stashes
git stash pop                  # apply latest and drop it
git stash apply stash@{2}      # apply a specific one, keep it
```

## Remotes

```sh
git remote -v
git remote add origin git@github.com:user/repo.git
git push -u origin main        # set upstream
```

## Useful one-offs

- `git log -S "needle"` — find commits that added/removed a string
- `git log --follow <file>` — history through renames
- `git reflog` — your local "undo history" when things go sideways
