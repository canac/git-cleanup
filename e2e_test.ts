import { $ } from "@david/dax";
import { expect } from "@std/expect";
import { beforeEach, describe, it } from "@std/testing/bdd";
import { returnsNext, spy } from "@std/testing/mock";
import { cleanup } from "./main.ts";

beforeEach(async () => {
  $.setPrintCommand(true);

  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/remote`);

  $.cd(`${dir}/remote`);
  await $`git init`;
  await $`git commit --allow-empty -m "Root"`;

  await $`git clone . ${dir}/local`;
  $.cd(`${dir}/local`);

  await $`git worktree add ${dir}/cleanup-1 -b cleanup-test-1`;
  await $`git worktree add ${dir}/cleanup-2 -b cleanup-test-2`;
  await $`git worktree add ${dir}/cleanup-3 -b cleanup-test-3`;

  $.cd(`${dir}/cleanup-1`);
  await $`git push`;
  await $`git push origin --delete cleanup-test-1`;
  await $`git branch cleanup-test-1-backup`;
  await $`git branch cleanup-test-1-backup2`;
  await $`git config set cleanup.ignoredBranches cleanup-test-1-backup2`;
  await $`git branch cleanup-test-1-backup3`;

  $.cd(`${dir}/cleanup-2`);
  await $`git push`;
  await $`git push origin --delete cleanup-test-2`;

  $.cd(`${dir}/local`);
});

describe("cleanup E2E", () => {
  it("runs cleanup", async () => {
    const multiSelectSpy = spy(returnsNext([
      Promise.resolve([1]),
      Promise.resolve([0, 1, 2, 3]),
    ]));
    $.multiSelect = multiSelectSpy;
    await cleanup($);

    expect(multiSelectSpy.calls.length).toBe(2);
    expect(multiSelectSpy.calls[0]?.args[0]).toMatchObject({
      message: "Which worktrees do you want to clean up?",
      options: [
        { selected: true, text: expect.stringMatching(/cleanup-1$/) },
        { selected: true, text: expect.stringMatching(/cleanup-2$/) },
      ],
    });
    expect(multiSelectSpy.calls[1]?.args[0]).toEqual({
      message: "Which branches do you want to clean up?",
      options: [
        { selected: true, text: "cleanup-test-1" },
        { selected: true, text: "cleanup-test-1-backup" },
        { selected: false, text: "cleanup-test-1-backup2" },
        { selected: true, text: "cleanup-test-1-backup3" },
        { selected: true, text: "cleanup-test-2" },
      ],
    });

    expect(await $`git worktree list`.text()).toMatch(
      /^[^ ]+local .+ \[main\]\n[^ ]+cleanup-1 .+ \(detached HEAD\)\n[^ ]+cleanup-3 .+ \[cleanup-test-3\]$/gm,
    );
    expect(await $`git -C ../cleanup-1 config get --worktree cleanup.ignore`.text()).toEqual(
      "true",
    );
    expect((await $`git branch`.lines()).toSorted()).toEqual([
      "  cleanup-test-2",
      "* main",
      "+ cleanup-test-3",
    ]);
    expect(await $`git config get cleanup.ignoredBranches`.text()).toEqual(
      "cleanup-test-2",
    );
  });
});
