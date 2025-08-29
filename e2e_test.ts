import { $ } from "@david/dax";
import { expect } from "@std/expect";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { returnsNext, stub } from "@std/testing/mock";
import { cleanup } from "./main.ts";

let cwd: string;

beforeEach(async () => {
  cwd = Deno.cwd();

  $.setPrintCommand(true);

  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/remote`);

  Deno.chdir(`${dir}/remote`);
  await $`git init --initial-branch main`;
  await $`git commit --allow-empty -m "Root"`;

  await $`git clone . ${dir}/local`;
  Deno.chdir(`${dir}/local`);
  await $`git config push.autoSetupRemote true`;

  await $`git worktree add ${dir}/cleanup-1 -b cleanup-test-1`;
  await $`git worktree add ${dir}/cleanup-2 -b cleanup-test-2`;
  await $`git worktree add ${dir}/cleanup-3 -b cleanup-test-3`;
  await $`git worktree add ${dir}/cleanup-4 -b cleanup-test-4`;
  await $`git worktree add ${dir}/cleanup-5 -d`;

  Deno.chdir(`${dir}/cleanup-1`);
  await $`git push`;
  await Deno.writeFile("file.txt", new Uint8Array());
  await $`git push origin --delete cleanup-test-1`;
  await $`git branch cleanup-test-1-backup`;
  await $`git branch cleanup-test-1-backup2`;
  await $`git branch cleanup-test-1-backup3`;
  await $`git branch orphan-backup3`;
  await $`git config set cleanup.ignoredBranches cleanup-test-1-backup2`;

  Deno.chdir(`${dir}/cleanup-2`);
  await $`git push`;
  await $`git push origin --delete cleanup-test-2`;

  Deno.chdir(`${dir}/cleanup-3`);
  await $`git push`;
  await $`git push origin --delete cleanup-test-3`;

  Deno.chdir(`${dir}/local`);
});

afterEach(() => {
  // Restore the current working directory
  Deno.chdir(cwd);
});

describe("cleanup E2E", () => {
  it("runs cleanup", async () => {
    using multiSelectStub = stub(
      $,
      "multiSelect",
      returnsNext([
        Promise.resolve([1]),
        Promise.resolve([0, 1, 2, 3, 6]), // skip cleanup-test-2 and cleanup-test-3
        Promise.resolve([]),
        Promise.resolve([]),
      ]),
    );
    await cleanup($);

    expect(multiSelectStub.calls.length).toBe(2);
    expect(multiSelectStub.calls[0]?.args[0]).toMatchObject({
      message: "Which worktrees do you want to clean up?",
      options: [
        { selected: true, text: expect.stringMatching(/cleanup-1 .+\(dirty\).+$/) },
        { selected: true, text: expect.stringMatching(/cleanup-2$/) },
        { selected: true, text: expect.stringMatching(/cleanup-3$/) },
      ],
    });
    expect(multiSelectStub.calls[1]?.args[0]).toEqual({
      message: "Which branches do you want to clean up?",
      options: [
        { selected: true, text: "cleanup-test-1" },
        { selected: true, text: "cleanup-test-1-backup" },
        { selected: false, text: "cleanup-test-1-backup2" },
        { selected: true, text: "cleanup-test-1-backup3" },
        { selected: true, text: "cleanup-test-2" },
        { selected: true, text: "cleanup-test-3" },
        { selected: true, text: "orphan-backup3" },
      ],
    });

    expect(await $`git worktree list`.text()).toMatch(
      /^[^ ]+local .+ \[main\]\n[^ ]+cleanup-1 .+ \(detached HEAD\)\n[^ ]+cleanup-3 .+ \[cleanup-test-3\]\n[^ ]+cleanup-4 .+ \[cleanup-test-4\]$/gm,
    );
    expect(await $`git -C ../cleanup-1 config get --worktree cleanup.ignore`.text()).toEqual(
      "true",
    );
    expect((await $`git branch`.lines()).toSorted()).toEqual([
      "  cleanup-test-2",
      "* main",
      "+ cleanup-test-3",
      "+ cleanup-test-4",
    ]);
    expect(await $`git config get cleanup.ignoredBranches`.text()).toEqual(
      "cleanup-test-2 cleanup-test-3",
    );

    await cleanup($);

    // Test that the deselected worktrees start out as deselected the next time
    expect(multiSelectStub.calls.length).toBe(4);
    expect(multiSelectStub.calls[2]?.args[0]).toMatchObject({
      message: "Which worktrees do you want to clean up?",
      options: [
        { selected: false, text: expect.stringMatching(/cleanup-3$/) },
      ],
    });
    expect(multiSelectStub.calls[3]?.args[0]).toEqual({
      message: "Which branches do you want to clean up?",
      options: [
        { selected: false, text: "cleanup-test-2" },
        { selected: false, text: "cleanup-test-3" },
      ],
    });
  });
});
