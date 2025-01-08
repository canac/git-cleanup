import { type $Type, build$, CommandBuilder } from "@david/dax";
import { equal } from "@std/assert";
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

interface ExpectedCall {
  args: string[];
  output?: string;
  error?: true;
}

interface Mock$Type extends $Type, Disposable {}

/**
 * Create a $ instance that intercepts and optionally mocks responses to `git` commands. The
 * returned $ instance is extended to be disposable. When used with the `using` keyword, it will
 * automatically verify that no expected calls remain at the end of the test when it is disposed.
 *
 * @param expectedCalls An array of expected calls to `git`. Each entry can be an array of the
 * expected arguments for the call or an `ExpectedCall` object to mock the output and/or status
 * code of the call.
 */
const mock$ = (expectedCalls: (string[] | ExpectedCall)[]): Mock$Type => {
  const calls: string[][] = [];
  // Clone the array and convert args arrays to ExpectedCall objects
  const remainingCalls = expectedCalls.map((call) => Array.isArray(call) ? { args: call } : call);
  const commandBuilder = new CommandBuilder()
    .registerCommand(
      "git",
      ({ args, stdout }) => {
        calls.push(args);

        const expectedCall = remainingCalls[0];
        if (!expectedCall || !equal(expectedCall.args, args)) {
          throw new Error(
            `Unexpected git call

Expected call: ${expectedCall ? Deno.inspect(expectedCall.args) : "none"}
Actual call:   ${Deno.inspect(args)}
All calls:
${calls.map((call) => Deno.inspect(call)).join("\n")}`,
          );
        }
        remainingCalls.shift();

        if (expectedCall.output) {
          stdout.writeText(expectedCall.output);
        }

        return { code: expectedCall.error ? 1 : 0 };
      },
    );

  return build$({
    commandBuilder,
    extras: {
      [Symbol.dispose]() {
        expect(remainingCalls).toEqual([]);
      },
    },
  });
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

describe("getWorktrees", () => {
  it("returns an array of worktree paths", async () => {
    using $ = mock$([
      { args: ["worktree", "list", "--porcelain"], output: worktreeListOutput },
    ]);
    expect(await getWorktrees($)).toEqual([
      "/dev/worktree-1",
      "/dev/worktree-2",
      "/dev/worktree-3",
    ]);
  });
});

describe("deleteWorktree", () => {
  it("deletes the worktree", async () => {
    using $ = mock$([
      ["worktree", "remove", "/dev/worktree-1", "--force"],
    ]);
    await deleteWorktree($, "/dev/worktree-1");
  });
});

describe("ignoreWorktree", () => {
  it("marks the worktree as ignored", async () => {
    using $ = mock$([
      ["config", "set", "extensions.worktreeconfig", "true"],
      ["-C", "/dev/worktree-1", "config", "set", "--worktree", "cleanup.ignore", "true"],
    ]);
    await ignoreWorktree($, "/dev/worktree-1");
  });
});

describe("getRemovableWorktrees", () => {
  it("returns an array of merged worktrees with their ignored state", async () => {
    using $ = mock$(
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

    expect(await getRemovableWorktrees($)).toEqual([
      { ignored: true, path: "/dev/worktree-1" },
      { ignored: false, path: "/dev/worktree-2" },
    ]);
  });

  it("returns an array of merged branches, backup branches of merged branches, and orphaned backup branches with their ignored state", async () => {
    using $ = mock$([{
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
  });
});

describe("getIgnoredBranches", () => {
  it("parses the git config", async () => {
    using $ = mock$([
      { args: ["config", "get", "cleanup.ignoredBranches"], output: "branch-1 branch-3" },
    ]);

    expect(await getIgnoredBranches($)).toEqual(["branch-1", "branch-3"]);
  });

  it("handles missing config", async () => {
    using $ = mock$([
      { args: ["config", "get", "cleanup.ignoredBranches"], error: true },
    ]);

    expect(await getIgnoredBranches($)).toEqual([]);
  });

  it("handles blank", async () => {
    using $ = mock$([
      ["config", "get", "cleanup.ignoredBranches"],
    ]);

    expect(await getIgnoredBranches($)).toEqual([]);
  });
});

describe("setIgnoredBranches", () => {
  it("parses the git config", async () => {
    using $ = mock$([
      ["config", "set", "cleanup.ignoredBranches", "branch-1 branch-2"],
    ]);

    await setIgnoredBranches($, ["branch-1", "branch-2"]);
  });
});

describe("deleteBranches", () => {
  it("detaches worktrees and deletes the branches", async () => {
    using $ = mock$([
      { args: ["worktree", "list", "--porcelain"], output: worktreeListOutput },
      ["-C", "/dev/worktree-1", "switch", "--detach"],
      ["branch", "-D", "worktree-1", "worktree-3"],
    ]);

    await deleteBranches($, ["worktree-1", "worktree-3"]);
  });

  it("does nothing when there are no branches to delete", async () => {
    using $ = mock$([]);

    await deleteBranches($, []);
  });
});

describe("getBranchWorktrees", () => {
  it("returns a map of worktree paths and their branches, filtering out detached worktrees", async () => {
    using $ = mock$([
      { args: ["worktree", "list", "--porcelain"], output: worktreeListOutput },
    ]);

    expect(await getBranchWorktrees($)).toEqual(
      new Map([
        ["main", "/dev/project"],
        ["worktree-1", "/dev/worktree-1"],
        ["worktree-2", "/dev/worktree-2"],
      ]),
    );
  });
});
