import { $Type } from "@david/dax";

export const isNotNull = <T>(item: T | null): item is T => item !== null;

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
  worktrees: string[],
): Promise<RemovableWorktree[]> => {
  // Enable storing cleanup.ignore worktree-specific config
  await $`git config set extensions.worktreeconfig true`;

  const removableWorktrees = await Promise.all(worktrees.map(async (path) => {
    // If the worktree's current branch is deleted upstream, its entry will be [gone] *
    const deletedPromise = $`git -C ${path} branch --format '%(upstream:track) %(HEAD)'`.lines()
      .then((lines) => lines.some((line) => line === "[gone] *"));
    const ignoredPromise = $`git -C ${path} config get --worktree cleanup.ignore`
      .noThrow()
      .text().then((ignore) => ignore === "true");

    const [deleted, ignored] = await Promise.all([deletedPromise, ignoredPromise]);
    // If the worktree's current branch wasn't deleted upstream, return null so it will be filtered out
    return deleted ? { path, ignored } : null;
  }));

  return removableWorktrees.filter(isNotNull);
};

/**
 * Return an array of the current directory's branches that can be cleaned up. Removable branches
 * are ones that are merged upstream, are backup branches of branches that are merged upstream, or
 * are orphaned backup branches.
 */
export const getRemovableBranches = async ($: $Type): Promise<string[]> => {
  const branchLines = await $`git branch --format '%(refname:short)%(upstream:track)'`.lines();

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
  });
};

/**
 * Return a map of checked out branches and their worktree path.
 */
export const getBranchWorktrees = async (
  $: $Type,
): Promise<Map<string, string>> => {
  const sections = (await $`git worktree list --porcelain`.text()).split("\n\n");

  return new Map(
    sections.map((section) => {
      const lines = section.split("\n");
      // Find the worktree path
      const worktree = lines.find((line) => line.startsWith("worktree "))?.slice(9);
      // Find the branch name
      const branch = lines.find((line) => line.startsWith("branch refs/heads/"))?.slice(18);
      // If the worktree could not be found, return null so it will be filtered out
      return worktree && branch ? [branch, worktree] as const : null;
    }).filter(isNotNull),
  );
};
