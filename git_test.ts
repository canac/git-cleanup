import { $Type, build$, CommandBuilder } from "@david/dax";
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
  deleteBranches,
  deleteWorktree,
  getBranchWorktrees,
  getIgnoredBranches,
  getRemovableBranches,
  getRemovableWorktrees,
  getWorktrees,
  ignoreWorktree,
  setIgnoredBranches,
} from "./git.ts";

/**
 * Determine whether two arrays of strings contain exactly the same set of items.
 */
const arrayCompare = (
  arr1: string[],
  arr2: string[],
): boolean => {
  return arr1.length === arr2.length &&
    arr1.every((item1, index) => item1 === arr2[index]);
};

interface ExpectedCall {
  args: string[];
  output?: string;
  error?: true;
}

interface Mock$Response {
  /** The mocked $ object */
  $: $Type;

  /**
   * An array of the args for each time that git was called. If `expectedCalls` is not provided, it
   * should be used to assert that the calls to git were exactly as expected.
   */
  calls: string[][];

  /**
   * Assert that git was called with all of the expected calls. If `expectedCalls` is provided, it
   * should be called at the end of the test.
   */
  assertNoRemainingCalls: () => void;
}

/*
 * Create a $ object that intercepts and optionally mocks responses to `git` commands.
 */
const mock$ = (expectedCalls?: ExpectedCall[]): Mock$Response => {
  const calls: string[][] = [];
  const remainingExpectedCalls = expectedCalls?.slice();
  const commandBuilder = new CommandBuilder()
    .registerCommand(
      "git",
      ({ args, stdout }) => {
        calls.push(args);

        if (remainingExpectedCalls) {
          const expectedCall = remainingExpectedCalls[0];

          if (!expectedCall || !arrayCompare(expectedCall.args, args)) {
            throw new Error(
              `Unexpected git call

Expected call: ${expectedCall ? Deno.inspect(expectedCall.args) : "none"}
Actual call:   ${Deno.inspect(args)}
All calls:
${calls.map((call) => Deno.inspect(call)).join("\n")}`,
            );
          }
          remainingExpectedCalls.shift();

          if (expectedCall.output) {
            stdout.writeText(expectedCall.output);
          }

          if (expectedCall.error) {
            return { code: 1 };
          }
        }

        return { code: 0 };
      },
    );

  const $ = build$({ commandBuilder });
  return {
    $,
    calls,
    assertNoRemainingCalls: () => {
      // Do nothing if expectedCalls was not provided
      if (remainingExpectedCalls) {
        expect(remainingExpectedCalls).toEqual([]);
      }
    },
  };
};

const worktreeListOutput = `worktree /dev/project
HEAD 0000000000000000000000000000000000000000
branch refs/heads/main

worktree /dev/worktree-1
HEAD 1111111111111111111111111111111111111111
branch refs/heads/worktree-1

worktree /dev/worktree-2
HEAD 2222222222222222222222222222222222222222
branch refs/heads/worktree-2

worktree /dev/worktree-3
HEAD 3333333333333333333333333333333333333333
detached
`;

describe("arrayCompare", () => {
  it("returns true when the arrays are equal", () => {
    expect(arrayCompare(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("returns true when the arrays are different", () => {
    expect(arrayCompare(["a", "b", "d"], ["a", "b", "c"])).toBe(false);
  });

  it("returns false when the first array is shorter", () => {
    expect(arrayCompare(["a", "b"], ["a", "b", "c"])).toBe(false);
  });

  it("returns false when the first array is longer", () => {
    expect(arrayCompare(["a", "b", "c", "d"], ["a", "b", "c"])).toBe(false);
  });
});

describe("getWorktrees", () => {
  it("returns an array of worktree paths", async () => {
    const { $, assertNoRemainingCalls } = mock$([
      { args: ["worktree", "list", "--porcelain"], output: worktreeListOutput },
    ]);
    expect(await getWorktrees($)).toEqual([
      "/dev/worktree-1",
      "/dev/worktree-2",
      "/dev/worktree-3",
    ]);
    assertNoRemainingCalls();
  });
});

describe("deleteWorktree", () => {
  it("deletes the worktree", async () => {
    const { $, calls } = mock$();
    await deleteWorktree($, "/dev/worktree-1");
    expect(calls).toEqual([
      ["worktree", "remove", "/dev/worktree-1", "--force"],
    ]);
  });
});

describe("ignoreWorktree", () => {
  it("marks the worktree as ignored", async () => {
    const { $, calls } = mock$();
    await ignoreWorktree($, "/dev/worktree-1");
    expect(calls).toEqual([
      ["config", "set", "extensions.worktreeconfig", "true"],
      ["-C", "/dev/worktree-1", "config", "set", "--worktree", "cleanup.ignore", "true"],
    ]);
  });
});

describe("getRemovableWorktrees", () => {
  it("returns an array of merged worktrees with their ignored state", async () => {
    const { $, assertNoRemainingCalls } = mock$(
      [
        { args: ["worktree", "list", "--porcelain"], output: worktreeListOutput },
        {
          args: ["-C", "/dev/worktree-1", "branch", "--format", "%(upstream:track) %(HEAD)"],
          output: "[gone] *", // current branch is deleted upstream
        },
        {
          args: ["-C", "/dev/worktree-1", "config", "get", "--worktree", "cleanup.ignore"],
          output: "true",
        },
        {
          args: ["-C", "/dev/worktree-2", "branch", "--format", "%(upstream:track) %(HEAD)"],
          output: "[gone] *", // current branch is deleted upstream
        },
        {
          args: ["-C", "/dev/worktree-2", "config", "get", "--worktree", "cleanup.ignore"],
          output: "false", // a different branch is deleted upstream
        },
        {
          args: ["-C", "/dev/worktree-3", "branch", "--format", "%(upstream:track) %(HEAD)"],
          output: " *\n[gone]",
        },
        {
          args: ["-C", "/dev/worktree-3", "config", "get", "--worktree", "cleanup.ignore"],
          error: true, // config key does not exist
        },
      ],
    );

    expect(await getRemovableWorktrees($))
      .toEqual([
        { ignored: true, path: "/dev/worktree-1" },
        { ignored: false, path: "/dev/worktree-2" },
      ]);
    assertNoRemainingCalls();
  });

  it("returns an array of merged branches, backup branches of merged branches, and orphaned backup branches with their ignored state", async () => {
    const { $, assertNoRemainingCalls } = mock$([{
      args: ["config", "get", "cleanup.ignoredBranches"],
      output: "deleted-upstream-backup orphaned-backup2",
    }, {
      args: ["branch", "--format", "%(refname:short)%(upstream:track)"],
      output: `main
deleted-upstream[gone]
deleted-upstream-backup
deleted-upstream-backup-branch
deleted-upstream-backup2
deleted-upstream-2[gone]
main-backup
main-backup2
orphaned-backup
orphaned-backup-branch
orphaned-backup2
`,
    }]);

    expect(await getRemovableBranches($)).toEqual([
      { name: "deleted-upstream", ignored: false },
      { name: "deleted-upstream-backup", ignored: true },
      { name: "deleted-upstream-backup2", ignored: false },
      { name: "deleted-upstream-2", ignored: false },
      { name: "orphaned-backup", ignored: false },
      { name: "orphaned-backup2", ignored: true },
    ]);
    assertNoRemainingCalls();
  });
});

describe("getIgnoredBranches", () => {
  it("parses the git config", async () => {
    const { $, assertNoRemainingCalls } = mock$([
      { args: ["config", "get", "cleanup.ignoredBranches"], output: "branch-1 branch-3" },
    ]);

    expect(await getIgnoredBranches($)).toEqual(["branch-1", "branch-3"]);
    assertNoRemainingCalls();
  });

  it("handles missing config", async () => {
    const { $, assertNoRemainingCalls } = mock$([
      { args: ["config", "get", "cleanup.ignoredBranches"], error: true },
    ]);

    expect(await getIgnoredBranches($)).toEqual([]);
    assertNoRemainingCalls();
  });

  it("handles blank", async () => {
    const { $, assertNoRemainingCalls } = mock$([
      { args: ["config", "get", "cleanup.ignoredBranches"] },
    ]);

    expect(await getIgnoredBranches($)).toEqual([]);
    assertNoRemainingCalls();
  });
});

describe("setIgnoredBranches", () => {
  it("parses the git config", async () => {
    const { $, calls } = mock$();

    await setIgnoredBranches($, ["branch-1", "branch-2"]);
    expect(calls).toEqual([
      ["config", "set", "cleanup.ignoredBranches", "branch-1 branch-2"],
    ]);
  });
});

describe("deleteBranches", () => {
  it("detaches worktrees and deletes the branches", async () => {
    const { $, assertNoRemainingCalls } = mock$([
      { args: ["worktree", "list", "--porcelain"], output: worktreeListOutput },
      { args: ["-C", "/dev/worktree-1", "switch", "--detach"] },
      { args: ["branch", "-D", "worktree-1", "worktree-3"] },
    ]);

    await deleteBranches($, ["worktree-1", "worktree-3"]);
    assertNoRemainingCalls();
  });

  it("does nothing when there are no branches to delete", async () => {
    const { $, calls } = mock$();

    await deleteBranches($, []);
    expect(calls).toEqual([]);
  });
});

describe("getBranchWorktrees", () => {
  it("returns a map of worktree paths and their branches, filtering out detached worktrees", async () => {
    const { $, assertNoRemainingCalls } = mock$([
      { args: ["worktree", "list", "--porcelain"], output: worktreeListOutput },
    ]);

    expect(await getBranchWorktrees($)).toEqual(
      new Map([
        ["main", "/dev/project"],
        ["worktree-1", "/dev/worktree-1"],
        ["worktree-2", "/dev/worktree-2"],
      ]),
    );
    assertNoRemainingCalls();
  });
});
