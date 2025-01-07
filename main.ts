import { $ } from "@david/dax";
import {
  deleteBranches,
  deleteWorktree,
  getRemovableBranches,
  getRemovableWorktrees,
  ignoreWorktree,
  setIgnoredBranches,
} from "./git.ts";
import { prompt } from "./prompt.ts";

// Fetch the latest upstream branches
await $`git fetch --prune`;

const removableWorktrees = await getRemovableWorktrees($);
const { selected: selectedWorktrees, deselected: deselectedWorktrees } = await prompt(
  $,
  "Which worktrees do you want to clean up?",
  removableWorktrees.map(({ path, ignored }) => ({ text: path, selected: !ignored })),
);
await Promise.all([
  // Remove the selected worktrees
  ...selectedWorktrees.map((path) => deleteWorktree($, path)),
  // Ignore any worktrees manually deselected so that they will start out unselected next time
  ...deselectedWorktrees.map((path) => ignoreWorktree($, path)),
]);

const removableBranches = await getRemovableBranches($);
const { selected: selectedBranches, unselected: unselectedBranches } = await prompt(
  $,
  "Which branches do you want to clean up?",
  removableBranches.map(({ name, ignored }) => ({ text: name, selected: !ignored })),
);
await deleteBranches($, selectedBranches);
// Remember branches that were deselected so that they start out deselected next time
setIgnoredBranches($, unselectedBranches);
