# Thread Rewind only restores worktree files

Thread Rewind restores project file contents without changing Git refs, `HEAD`, the current branch, the index, stash entries, commits, or reflog. If a discarded Run created commits, switched branches, or staged files, that Git state remains and the restored file contents may appear as staged or unstaged changes, preserving recoverability and avoiding implicit destructive Git operations.
