import type { $Type } from "@david/dax";
import { firstNotNullishOf, mapNotNullish } from "@std/collections";
import { isNotNull, stripPrefix } from "./lib.ts";

interface RemovableWorktree {
  path: string;
  ignored: boolean;
  dirty: boolean;
}

/**
 * Given an array of worktree paths, filter the list of worktrees to ones whose checked out branch
 * has been deleted upstream and indicate whether the worktree was manually ignored from cleanup
 * during a past run.
 */
export const getRemovableWorktrees = async (
  $: $Type,
  worktrees: string[],
): Promise<RemovableWorktree[]> => {
  const removableWorktrees = await Promise.all(worktrees.map(async (path) => {
    // If the worktree's current branch is deleted upstream, its entry will be [gone] *
    const deletedPromise = $`git -C ${path} branch --format '%(upstream:track) %(HEAD)'`.lines()
      .then((lines) => lines.some((line) => line === "[gone] *"));
    const ignoredPromise = $`git -C ${path} config get --worktree cleanup.ignore`
      // Suppress errors if worktreeConfig is not enabled
      .quiet("stderr")
      .noThrow()
      .text().then((ignore) => ignore === "true");
    const dirtyPromise = $`git -C ${path} status --porcelain`.text()
      .then((changedFiles) => changedFiles.length > 0);

    if (!await deletedPromise) {
      // If the worktree's current branch wasn't deleted upstream, return null so it will be filtered out
      return null;
    }

    const [ignored, dirty] = await Promise.all([ignoredPromise, dirtyPromise]);
    return { path, ignored, dirty };
  }));

  return removableWorktrees.filter(isNotNull);
};

/**
 * List a repo's worktrees: its main worktree and any linked worktrees, or null if `dir` isn't a git
 * repo.
 */
export const getWorktrees = async (
  $: $Type,
  dir: string,
): Promise<{ main: string; worktrees: string[] } | null> => {
  const lines = await $`git -C ${dir} worktree list --porcelain`.quiet("stderr").noThrow().lines();
  // The first entry is always the main worktree
  const [main, ...worktrees] = mapNotNullish(lines, (line) => stripPrefix(line, "worktree "));
  return main === undefined ? null : { main, worktrees };
};

/**
 * Delete worktrees.
 */
export const deleteWorktrees = async ($: $Type, dir: string, paths: string[]): Promise<void> => {
  if (paths.length === 0) {
    return;
  }

  await Promise.all(
    paths.map((path) => $`git -C ${dir} worktree remove ${path} --force`.printCommand()),
  );
};

/**
 * Mark worktrees as ignored.
 */
export const ignoreWorktrees = async ($: $Type, dir: string, paths: string[]): Promise<void> => {
  if (paths.length === 0) {
    return;
  }

  await $`git -C ${dir} config set extensions.worktreeconfig true`;
  await Promise.all(
    paths.map((path) => $`git -C ${path} config set --worktree cleanup.ignore true`),
  );
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
export const getRemovableBranches = async ($: $Type, dir: string): Promise<RemovableBranch[]> => {
  const [branchLines, ignoredBranches] = await Promise.all([
    $`git -C ${dir} branch --format '%(refname:short)%(upstream:track)'`.lines(),
    getIgnoredBranches($, dir).then((branches) => new Set(branches)),
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
export const getIgnoredBranches = async ($: $Type, dir: string): Promise<string[]> => {
  const branches = await $`git -C ${dir} config get cleanup.ignoredBranches`.noThrow().text();
  return branches.length > 0 ? branches.split(" ") : [];
};

/**
 * Save the list of branches that should be ignored in future runs.
 */
export const setIgnoredBranches = async (
  $: $Type,
  dir: string,
  branches: string[],
): Promise<void> => {
  await $`git -C ${dir} config set cleanup.ignoredBranches ${branches.join(" ")}`;
};

/**
 * Delete a list of branches.
 */
export const deleteBranches = async ($: $Type, dir: string, branches: string[]): Promise<void> => {
  if (branches.length === 0) {
    return;
  }

  // Detach any worktree using a branch being deleted
  const branchWorktrees = await getBranchWorktrees($, dir);
  const detaching = mapNotNullish(branches, (branch) => branchWorktrees.get(branch));
  await Promise.all(
    detaching.map((worktree) => $`git -C ${worktree} switch --detach`.printCommand()),
  );

  // Delete all branches at once
  await $`git -C ${dir} branch -D ${branches}`.printCommand();
};

/**
 * Return a map of checked out branches and their worktree path.
 */
export const getBranchWorktrees = async (
  $: $Type,
  dir: string,
): Promise<Map<string, string>> => {
  const sections = (await $`git -C ${dir} worktree list --porcelain`.text()).split("\n\n");

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
