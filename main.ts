import { red } from "@std/fmt/colors";
import { basename, resolve } from "@std/path";
import $, { type $Type } from "@david/dax";
import {
  deleteBranches,
  deleteWorktrees,
  getRemovableBranches,
  getRemovableWorktrees,
  getWorktrees,
  ignoreWorktrees,
  setIgnoredBranches,
} from "./git.ts";
import { prompt } from "./prompt.ts";
import { distinctBy } from "@std/collections";

type RemovableWorktree = Awaited<ReturnType<typeof getRemovableWorktrees>>[number];
type RemovableBranch = Awaited<ReturnType<typeof getRemovableBranches>>[number];

interface RepoState {
  /** Absolute path of the repo's main worktree */
  main: string;
  /** The main worktree's directory name */
  name: string;
  worktrees: RemovableWorktree[];
  branches: RemovableBranch[];
}

/**
 * Gather the removable worktrees and branches of the repo containing `path`, or null if `path` is
 * not inside a git repo.
 */
const probeRepo = async ($: $Type, path: string): Promise<RepoState | null> => {
  // List the repo's worktrees up front and target the main worktree for all repo-level commands. The
  // main worktree is never a cleanup option, so it always exists even if `path` itself is a worktree
  // being removed.
  const repo = await getWorktrees($, path);
  if (repo === null) {
    return null;
  }
  const { main, worktrees: worktreePaths } = repo;

  // Fetch the latest upstream branches before deciding what is removable
  await $`git -C ${main} fetch --prune`.noThrow();

  const [worktrees, branches] = await Promise.all([
    getRemovableWorktrees($, worktreePaths),
    getRemovableBranches($, main),
  ]);
  return { main, name: basename(main), worktrees, branches };
};

/**
 * Prompt for the removable worktrees across all repos, delete the selected ones, and ignore any
 * worktrees manually deselected so that they will start out unselected next time.
 */
const cleanupWorktrees = async ($: $Type, repos: RepoState[]): Promise<void> => {
  const options = repos.flatMap((repo) =>
    repo.worktrees.map((worktree) => ({
      repo,
      worktree,
      text: worktree.path,
      selected: !worktree.ignored,
      dirty: worktree.dirty,
    }))
  );
  const { selected, deselected } = await prompt(
    $,
    "Which worktrees do you want to clean up?",
    options,
    ({ text, dirty }) => dirty ? `${text} ${red("(dirty)")}` : text,
  );

  // Move to a directory that won't be deleted to avoid errors when running commands in a
  // non-existent deleting working directory
  if (selected[0]) {
    Deno.chdir(selected[0].repo.main);
  }

  await Promise.all(repos.map(async (repo) => {
    const selectedWorktrees = selected
      .filter((option) => option.repo === repo)
      .map(({ worktree }) => worktree.path);
    const deselectedWorktrees = deselected
      .filter((option) => option.repo === repo)
      .map(({ worktree }) => worktree.path);
    await Promise.all([
      deleteWorktrees($, repo.main, selectedWorktrees),
      ignoreWorktrees($, repo.main, deselectedWorktrees),
    ]);
  }));
};

/**
 * Prompt once for the removable branches across all repos, then delete the selected ones and
 * remember the unselected ones so they start out unselected next time.
 */
const cleanupBranches = async ($: $Type, repos: RepoState[]): Promise<void> => {
  const multiRepo = repos.length > 1;
  const options = repos.flatMap((repo) =>
    repo.branches.map((branch) => ({ repo, branch, text: branch.name, selected: !branch.ignored }))
  );
  const { selected, unselected } = await prompt(
    $,
    "Which branches do you want to clean up?",
    options,
    // Disambiguate branches by repo when cleaning up more than one
    ({ repo, branch }) => multiRepo ? `${repo.name}: ${branch.name}` : branch.name,
  );

  await Promise.all(repos.map(async (repo) => {
    const selectedBranches = selected
      .filter((option) => option.repo === repo)
      .map(({ branch }) => branch.name);
    const unselectedBranches = unselected
      .filter((option) => option.repo === repo)
      .map(({ branch }) => branch.name);
    await deleteBranches($, repo.main, selectedBranches);
    // Remember branches that were not selected so that they start out deselected next time
    await setIgnoredBranches($, repo.main, unselectedBranches);
  }));
};

/**
 * Clean up one or more repos. Gather every removable worktree and branch across all repos up front,
 * then present a single combined worktree prompt and a single combined branch prompt.
 */
export const cleanup = async ($: $Type, paths: string[]): Promise<void> => {
  // Resolve to absolute paths because cleanup changes the working directory to avoid errors after
  // removing the current directory
  const repos = distinctBy(
    (await Promise.all(paths.map((path) => probeRepo($, resolve(path)))))
      .filter((repo) => repo !== null),
    (repo) => repo.main,
  );

  await cleanupWorktrees($, repos);
  await cleanupBranches($, repos);
};

if (import.meta.main) {
  // With no arguments, clean up the repo containing the current directory. Otherwise, clean up each
  // repo path.
  await cleanup($, Deno.args.length === 0 ? ["."] : Deno.args);
}
