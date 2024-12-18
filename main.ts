import { $ } from "@david/dax";
import {
  getBranchWorktrees,
  getRemovableBranches,
  getRemovableWorktrees,
  isNotNull,
} from "./lib.ts";

// Fetch the latest upstream branches
await $`git fetch --prune`;

const removableWorktrees = await getRemovableWorktrees($);
const selectedWorktrees = removableWorktrees.length > 0
  ? new Set(
    await $.multiSelect({
      message: "Which worktrees do you want to clean up?",
      options: removableWorktrees.map(({ path, ignored }) => ({
        text: path,
        selected: !ignored,
      })),
    }),
  )
  : new Set();

await Promise.all(removableWorktrees.map((worktree, index) => {
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

const removableBranches = await getRemovableBranches($);
const selectedBranches = removableBranches.length > 0
  ? new Set(
    await $.multiSelect({
      message: "Which branches do you want to clean up?",
      options: removableBranches.map(({ name, ignored }) => ({
        text: name,
        selected: !ignored,
      })),
    }),
  )
  : new Set();
const deletingBranches = removableBranches
  .filter((_branch, index) => selectedBranches.has(index))
  .map(({ name }) => name);

// Detach any worktree using a branch being deleted
const branchWorktrees = await getBranchWorktrees($);
const detaching = removableBranches
  .map((branch) => branchWorktrees.get(branch.name) ?? null)
  .filter(isNotNull);
await Promise.all(
  detaching.map((worktree) => $`git -C ${worktree} switch --detach`.printCommand()),
);

if (deletingBranches.length > 0) {
  // Delete all branches at once
  await $`git branch -D ${deletingBranches}`.printCommand();
}

// Remember branches that were deselected so that they start out deselected next time
const ignoredBranches = removableBranches
  .filter((_branch, index) => !selectedBranches.has(index))
  .map(({ name }) => name)
  .join(" ");
await $`git config set cleanup.ignoredBranches ${ignoredBranches}`;
