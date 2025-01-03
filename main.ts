import { $ } from "@david/dax";
import { mapNotNullish } from "@std/collections";
import { getBranchWorktrees, getRemovableBranches, getRemovableWorktrees, prompt } from "./git.ts";

// Fetch the latest upstream branches
await $`git fetch --prune`;

const removableWorktrees = await getRemovableWorktrees($);
const [selectedWorktrees, unselectedWorktrees] = await prompt(
  $,
  "Which worktrees do you want to clean up?",
  removableWorktrees.map(({ path, ignored }) => ({
    text: path,
    selected: !ignored,
  })),
);
await Promise.all([
  // Remove the selected worktrees
  ...selectedWorktrees.map(({ text: path }) =>
    $`git worktree remove ${path} --force`.printCommand()
  ),
  // Ignore any worktrees manually deselected so that they will start out deselected next time
  ...unselectedWorktrees
    .filter(({ selected: initiallySelected }) => initiallySelected)
    .map(({ text: path }) => $`git -C ${path} config set --worktree cleanup.ignore true`),
]);

const removableBranches = await getRemovableBranches($);
const [selectedBranches, unselectedBranches] = await prompt(
  $,
  "Which branches do you want to clean up?",
  removableBranches.map(({ name, ignored }) => ({
    text: name,
    selected: !ignored,
  })),
);

// Detach any worktree using a branch being deleted
const branchWorktrees = await getBranchWorktrees($);
const detaching = mapNotNullish(
  selectedBranches,
  ({ text: branch }) => branchWorktrees.get(branch) ?? null,
);
await Promise.all(
  detaching.map((worktree) => $`git -C ${worktree} switch --detach`.printCommand()),
);

if (selectedBranches.length > 0) {
  // Delete all branches at once
  await $`git branch -D ${selectedBranches.map(({ text: name }) => name)}`.printCommand();
}

// Remember branches that were deselected so that they start out deselected next time
const ignoredBranches = unselectedBranches.map(({ text: name }) => name).join(" ");
await $`git config set cleanup.ignoredBranches ${ignoredBranches}`;
