import { build$, CommandBuilder, type MultiSelectOption } from "@david/dax";
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
  getBranchWorktrees,
  getIgnoredBranches,
  getRemovableBranches,
  getRemovableWorktrees,
  getWorktrees,
  prompt,
} from "./git.ts";

const wildcard = Symbol("anyString");

/**
 * Determine whether two arrays of strings contain exactly the same set of items. If an item in the
 * second array is the `wildcard` symbol, it will match any string.
 */
const arrayCompare = (
  arr1: string[],
  arr2: (string | symbol)[],
): boolean => {
  return arr1.length === arr2.length &&
    arr1.every((item1, index) => item1 === arr2[index] || arr2[index] === wildcard);
};

describe("arrayCompare", () => {
  it("returns true when the arrays are equal", () => {
    expect(arrayCompare(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("returns true when the array contains wildcards", () => {
    expect(arrayCompare(["a", "b", "c"], ["a", "b", wildcard])).toBe(true);
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

describe("prompt", () => {
  it("returns selected and unselected options", async () => {
    const options: MultiSelectOption[] = [
      { text: "Option 1", selected: true },
      { text: "Option 2", selected: true },
      { text: "Option 3", selected: false },
    ];

    const $ = build$();
    $.multiSelect = () => Promise.resolve([0, 2]);

    const [selected, unselected] = await prompt($, "Select options", options);
    expect(selected).toEqual([options[0], options[2]]);
    expect(unselected).toEqual([options[1]]);
  });

  it("returns empty arrays when no options are provided", async () => {
    const $ = build$();
    $.multiSelect = () => {
      throw new Error("Unexpected call to multiSelect");
    };

    const [selected, unselected] = await prompt($, "Select options", []);
    expect(selected).toEqual([]);
    expect(unselected).toEqual([]);
  });
});

describe("getWorktrees", () => {
  it("returns an array of worktree paths", async () => {
    const commandBuilder = new CommandBuilder()
      .registerCommand(
        "git",
        async ({ args, stdout }) => {
          if (!arrayCompare(args, ["worktree", "list", "--porcelain"])) {
            throw new Error(`git called with unexpected arguments: ${args.join(" ")}`);
          }

          stdout.writeText(await Deno.readTextFile("./fixtures/worktree-list.output"));
          return { code: 0 };
        },
      );

    const $ = build$({ commandBuilder });
    expect(await getWorktrees($)).toEqual([
      "/dev/worktree-1",
      "/dev/worktree-2",
      "/dev/worktree-3",
    ]);
  });
});

describe("getRemovableWorktrees", () => {
  it("returns an array of merged worktrees with their ignored state", async () => {
    const commandBuilder = new CommandBuilder()
      .registerCommand(
        "git",
        async ({ args, stdout }) => {
          if (arrayCompare(args, ["worktree", "list", "--porcelain"])) {
            stdout.writeText(await Deno.readTextFile("./fixtures/worktree-list.output"));
            return { code: 0 };
          } else if (arrayCompare(args, ["config", "set", "extensions.worktreeconfig", "true"])) {
            return { code: 0 };
          } else if (
            arrayCompare(args, ["-C", wildcard, "branch", "--format", "%(upstream:track) %(HEAD)"])
          ) {
            if (args[1] === "/dev/worktree-1" || args[1] === "/dev/worktree-2") {
              // Current branch is deleted upstream
              stdout.writeText("[gone] *");
            } else {
              // A different branch is deleted upstream
              stdout.writeText(" *\n[gone]");
            }
            return { code: 0 };
          } else if (
            arrayCompare(args, ["-C", wildcard, "config", "get", "--worktree", "cleanup.ignore"])
          ) {
            if (args[1] === "/dev/worktree-1") {
              stdout.writeText("true");
            } else if (args[1] === "/dev/worktree-2") {
              stdout.writeText("false");
            } else {
              // Config key does not exist
              return { code: 1 };
            }
            return { code: 0 };
          }

          throw new Error(`git called with unexpected arguments: ${args.join(" ")}`);
        },
      );

    const $ = build$({ commandBuilder });
    expect(await getRemovableWorktrees($))
      .toEqual([
        { ignored: true, path: "/dev/worktree-1" },
        { ignored: false, path: "/dev/worktree-2" },
      ]);
  });
});

describe("getRemovableBranches", () => {
  it("returns an array of merged branches, backup branches of merged branches, and orphaned backup branches with their ignored state", async () => {
    const commandBuilder = new CommandBuilder()
      .registerCommand(
        "git",
        ({ args, stdout }) => {
          if (
            arrayCompare(args, ["branch", "--format", "%(refname:short)%(upstream:track)"])
          ) {
            stdout.writeText(`main
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
`);
          } else if (arrayCompare(args, ["config", "get", "cleanup.ignoredBranches"])) {
            stdout.writeText("deleted-upstream-backup orphaned-backup2");
          } else {
            throw new Error(`git called with unexpected arguments: ${args.join(" ")}`);
          }

          return { code: 0 };
        },
      );

    const $ = build$({ commandBuilder });
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
    const commandBuilder = new CommandBuilder()
      .registerCommand(
        "git",
        ({ args, stdout }) => {
          if (!arrayCompare(args, ["config", "get", "cleanup.ignoredBranches"])) {
            throw new Error(`git called with unexpected arguments: ${args.join(" ")}`);
          }

          stdout.writeText("branch-1 branch-3");
          return { code: 0 };
        },
      );

    const $ = build$({ commandBuilder });
    expect(await getIgnoredBranches($)).toEqual(["branch-1", "branch-3"]);
  });

  it("handles missing config", async () => {
    const commandBuilder = new CommandBuilder()
      .registerCommand(
        "git",
        ({ args }) => {
          if (!arrayCompare(args, ["config", "get", "cleanup.ignoredBranches"])) {
            throw new Error(`git called with unexpected arguments: ${args.join(" ")}`);
          }

          return { code: 1 };
        },
      );

    const $ = build$({ commandBuilder });
    expect(await getIgnoredBranches($)).toEqual([]);
  });

  it("handles blank", async () => {
    const commandBuilder = new CommandBuilder()
      .registerCommand(
        "git",
        ({ args }) => {
          if (!arrayCompare(args, ["config", "get", "cleanup.ignoredBranches"])) {
            throw new Error(`git called with unexpected arguments: ${args.join(" ")}`);
          }

          return { code: 0 };
        },
      );

    const $ = build$({ commandBuilder });
    expect(await getIgnoredBranches($)).toEqual([]);
  });
});

describe("getBranchWorktrees", () => {
  it("returns a map of worktree paths and their branches, filtering out detached worktrees", async () => {
    const commandBuilder = new CommandBuilder()
      .registerCommand(
        "git",
        ({ args, stdout }) => {
          if (!arrayCompare(args, ["worktree", "list", "--porcelain"])) {
            throw new Error(`git called with unexpected arguments: ${args.join(" ")}`);
          }

          stdout.writeText(`worktree /dev/project
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
`);
          return { code: 0 };
        },
      );

    const $ = build$({ commandBuilder });
    expect(await getBranchWorktrees($)).toEqual(
      new Map([
        ["main", "/dev/project"],
        ["worktree-1", "/dev/worktree-1"],
        ["worktree-2", "/dev/worktree-2"],
      ]),
    );
  });
});
