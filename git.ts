import type { $Type } from "@david/dax";
import { firstNotNullishOf, mapNotNullish } from "@std/collections";
import { isNotNull, stripPrefix } from "./lib.ts";

interface RemovableWorktree {
  path: string;
  ignored: boolean;
}

/**
 * Given an array of worktree paths, filter the list of worktrees to ones whose checked out branch
 * has been deleted upstream and indicate whether the worktree was manually ignored from cleanup
 * during a past run.
 */
export const getRemovableWorktrees = async (
  $: $Type,
): Promise<RemovableWorktree[]> => {
  const worktrees = await getWorktrees($);
  const removableWorktrees = await Promise.all(worktrees.map(async (path) => {
    // If the worktree's current branch is deleted upstream, its entry will be [gone] *
    const deletedPromise = $`git -C ${path} branch --format '%(upstream:track) %(HEAD)'`.lines()
      .then((lines) => lines.some((line) => line === "[gone] *"));
    const ignoredPromise = $`git -C ${path} config get --worktree cleanup.ignore`
      // Suppress errors if worktreeConfig is not enabled
      .quiet("stderr")
      .noThrow()
      .text().then((ignore) => ignore === "true");

    const [deleted, ignored] = await Promise.all([deletedPromise, ignoredPromise]);
    // If the worktree's current branch wasn't deleted upstream, return null so it will be filtered out
    return deleted ? { path, ignored } : null;
  }));

  return removableWorktrees.filter(isNotNull);
};

/**
 * Return an array of the paths of the current directory's worktrees.
 */
export const getWorktrees = async ($: $Type): Promise<string[]> => {
  // List the worktrees in the current directory
  const lines = await $`git worktree list --porcelain`.lines();
  return mapNotNullish(lines, (line) => stripPrefix(line, "worktree "))
    // Ignore the primary worktree
    .slice(1);
};

/**
 * Delete a worktree.
 */
export const deleteWorktree = async ($: $Type, path: string): Promise<void> => {
  await $`git worktree remove ${path} --force`.printCommand();
};

/**
 * Mark a worktree as ignored.
 */
export const ignoreWorktree = async ($: $Type, path: string): Promise<void> => {
  await $`git config set extensions.worktreeconfig true && git -C ${path} config set --worktree cleanup.ignore true`;
};

interface RemovableBranch {
  name: string;
  ignored: boolean;
}

/**
 * Return an array of the current directory's branches that can be cleaned up. Removable branches
 * are ones that are merged upstream, are backup branches of branches that are merged upstream, or
 * are orphaned backup branches.
 */
export const getRemovableBranches = async ($: $Type): Promise<RemovableBranch[]> => {
  const [branchLines, ignoredBranches] = await Promise.all([
    $`git branch --format '%(refname:short)%(upstream:track)'`.lines(),
    getIgnoredBranches($).then((branches) => new Set(branches)),
  ]);

  const branches = branchLines
    // Strip [gone] from the end of branch names
    .map((branch) => branch.endsWith("[gone]") ? branch.slice(0, -6) : branch);

  const mergedBranches = branchLines
    .filter((branch) => branch.endsWith("[gone]"))
    .map((branch) => branch.slice(0, -6));

  return branches.filter((branch) => {
    // A branch can be deleted if it was deleted upstream or if it is a backup branch of a branch
    // deleted upstream
    const merged = mergedBranches.some((mergedBranch) =>
      branch === mergedBranch || /^(.+)-backup\d*$/.exec(branch)?.[1] === mergedBranch
    );
    if (merged) {
      return true;
    }

    // A branch can be deleted if it is an orphaned backup branch
    const parentBranch = /^(.+)-backup\d*$/.exec(branch)?.[1];
    return parentBranch && !branches.includes(parentBranch);
  }).map((branch) => ({ name: branch, ignored: ignoredBranches.has(branch) }));
};

/**
 * Return a list of the branches that were ignored in a previous run.
 */
export const getIgnoredBranches = async ($: $Type): Promise<string[]> => {
  const branches = await $`git config get cleanup.ignoredBranches`.noThrow().text();
  return branches.length > 0 ? branches.split(" ") : [];
};

/**
 * Save the list of branches that should be ignored in future runs.
 */
export const setIgnoredBranches = async ($: $Type, branches: string[]): Promise<void> => {
  await $`git config set cleanup.ignoredBranches ${branches.join(" ")}`;
};

/**
 * Delete a list of branches.
 */
export const deleteBranches = async ($: $Type, branches: string[]): Promise<void> => {
  if (branches.length === 0) {
    return;
  }

  // Detach any worktree using a branch being deleted
  const branchWorktrees = await getBranchWorktrees($);
  const detaching = mapNotNullish(branches, (branch) => branchWorktrees.get(branch));
  await Promise.all(
    detaching.map((worktree) => $`git -C ${worktree} switch --detach`.printCommand()),
  );

  // Delete all branches at once
  await $`git branch -D ${branches}`.printCommand();
};

/**
 * Return a map of checked out branches and their worktree path.
 */
export const getBranchWorktrees = async (
  $: $Type,
): Promise<Map<string, string>> => {
  const sections = (await $`git worktree list --porcelain`.text()).split("\n\n");

  return new Map(
    mapNotNullish(sections, (section) => {
      const lines = section.split("\n");
      // Find the worktree path
      const worktree = firstNotNullishOf(lines, (line) => stripPrefix(line, "worktree "));
      // Find the branch name
      const branch = firstNotNullishOf(lines, (line) => stripPrefix(line, "branch refs/heads/"));
      // The worktree line should always be present, but the branch line may be missing if the
      // worktree has a detached HEAD. If this is the case, return null so it will be filtered out.
      return worktree && branch ? [branch, worktree] as const : null;
    }),
  );
};
