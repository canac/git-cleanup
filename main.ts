import { $ } from "@david/dax";
import {
  getBranchWorktrees,
  getDeletableBranches,
  getMergedWorktrees,
  getWorktrees,
  isNotNull,
} from "./lib.ts";

// Fetch the latest upstream branches
await $`git fetch --prune`;

const mergedWorktrees = await getMergedWorktrees($, await getWorktrees($));
const selectedWorktrees = mergedWorktrees.length > 0
  ? new Set(
    await $.multiSelect({
      message: "Which worktrees do you want to clean up?",
      options: mergedWorktrees.map(({ path, ignored }) => ({
        text: path,
        selected: !ignored,
      })),
    }),
  )
  : new Set();

await Promise.all(mergedWorktrees.map((worktree, index) => {
  if (selectedWorktrees.has(index)) {
    // Remove the worktree
    return $`git worktree remove ${worktree.path} --force`.printCommand();
  } else if (!worktree.ignored) {
    // The user manually deselected this worktree, so ignore it so that it starts out deselected
    // next time
    return $`git -C ${worktree.path} config set --worktree cleanup.ignore true`;
  }
  // This worktree was left deselected, so do nothing
  return Promise.resolve(null);
}));

const deletableBranches = await getDeletableBranches($);
const selectedBranches = deletableBranches.length > 0
  ? new Set(
    await $.multiSelect({
      message: "Which branches do you want to clean up?",
      options: deletableBranches.map((branch) => ({
        text: branch,
        selected: true,
      })),
    }),
  )
  : new Set();
const deletingBranches = deletableBranches.filter((_branch, index) => selectedBranches.has(index));

// Detach any worktree using a branch being deleted
const branchWorktrees = await getBranchWorktrees($);
const detaching = deletableBranches
  .map((branch) => branchWorktrees.get(branch) ?? null)
  .filter(isNotNull);
await Promise.all(
  detaching.map((worktree) => $`git -C ${worktree} switch --detach`.printCommand()),
);

if (deletingBranches.length > 0) {
  // Delete all branches at once
  await $`git branch -D ${deletingBranches}`.printCommand();
}
