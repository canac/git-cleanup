import { $Type } from "@david/dax";

const isNotNull = <T>(item: T | null): item is T => item !== null;

/**
 * Return an array of the paths of the current directory's worktrees.
 */
export const getWorktrees = async ($: $Type): Promise<string[]> => {
  // List the worktrees in the current directory
  return (await $`git worktree list --porcelain`
    .lines()).filter((line) => line.startsWith("worktree"))
    // Strip out the "worktree " part of the line
    .map((line) => line.slice(9))
    // Ignore the primary worktree
    .slice(1);
};

interface MergedWorktree {
  path: string;
  ignored: boolean;
}

/**
 * Given an array of worktree paths, filter the list of worktrees to ones whose checked out branch
 * has been deleted upstream and indicate whether the worktree was manually ignored from cleanup
 * during a past run.
 */
export const getMergedWorktrees = async (
  $: $Type,
  worktrees: string[],
): Promise<MergedWorktree[]> => {
  // Enable storing cleanup.ignore worktree-specific config
  await $`git config set extensions.worktreeconfig true`;

  const mergedWorktrees = await Promise.all(worktrees.map(async (path) => {
    // If the worktree's current branch is deleted upstream, its entry will be [gone] *
    const deletedPromise =
      $`git -C ${path} branch --format '%(upstream:track) %(HEAD)'`.lines()
        .then((lines) => lines.some((line) => line === "[gone] *"));
    const ignoredPromise =
      $`git -C ${path} config get --worktree cleanup.ignore`
        .noThrow()
        .text().then((ignore) => ignore === "true");

    const [deleted, ignored] = await Promise.all([
      deletedPromise,
      ignoredPromise,
    ]);
    // If the worktree's current branch wasn't deleted upstream, return null so it can be filtered out
    return deleted ? { path, ignored } : null;
  }));

  return mergedWorktrees.filter(isNotNull);
};

/**
 * Return an array of the current directory's branches that can be cleaned up. Deletable branches
 * are ones that are merged upstream, are backup branches of branches that are merged upstream, or
 * are orphaned backup branches.
 */
export const getDeletableBranches = async ($: $Type): Promise<string[]> => {
  const branchLines =
    await $`git branch --format '%(refname:short)%(upstream:track)'`.lines();

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
      branch === mergedBranch ||
      /^(.+)-backup\d*$/.exec(branch)?.[1] === mergedBranch
    );
    if (merged) {
      return true;
    }

    // A branch can be deleted if it is an orphaned backup branch
    const parentBranch = /^(.+)-backup\d*$/.exec(branch)?.[1];
    return parentBranch && !branches.includes(parentBranch);
  });
};
