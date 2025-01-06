import { $ } from "@david/dax";
import {
  deleteBranches,
  deleteWorktree,
  getRemovableBranches,
  getRemovableWorktrees,
  ignoreWorktree,
  prompt,
  setIgnoredBranches,
} from "./git.ts";

// Fetch the latest upstream branches
await $`git fetch --prune`;

const removableWorktrees = await getRemovableWorktrees($);
const [selectedWorktrees, unselectedWorktrees] = await prompt(
  $,
  "Which worktrees do you want to clean up?",
  removableWorktrees.map(({ path, ignored }) => ({ text: path, selected: !ignored })),
);
await Promise.all([
  // Remove the selected worktrees
  ...selectedWorktrees.map(({ text: path }) => deleteWorktree($, path)),
  // Ignore any worktrees manually deselected so that they will start out deselected next time
  ...unselectedWorktrees
    .filter(({ selected: initiallySelected }) => initiallySelected)
    .map(({ text: path }) => ignoreWorktree($, path)),
]);

const removableBranches = await getRemovableBranches($);
const [selectedBranches, unselectedBranches] = await prompt(
  $,
  "Which branches do you want to clean up?",
  removableBranches.map(({ name, ignored }) => ({ text: name, selected: !ignored })),
);
await deleteBranches($, selectedBranches.map(({ text: branch }) => branch));
// Remember branches that were deselected so that they start out deselected next time
setIgnoredBranches($, unselectedBranches.map(({ text: name }) => name));
