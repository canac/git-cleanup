import { build$, CommandBuilder, type MultiSelectOption } from "@david/dax";
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { returnsNext, stub } from "@std/testing/mock";
import { prompt } from "./prompt.ts";

const make$ = () => build$({ commandBuilder: new CommandBuilder().clearEnv() });

describe("prompt", () => {
  it("returns selected, unselected, and deselected options", async () => {
    const options: MultiSelectOption[] = [
      { text: "Option 1", selected: true },
      { text: "Option 2", selected: true },
      { text: "Option 3", selected: false },
      { text: "Option 4", selected: false },
    ];

    const $ = make$();
    $.multiSelect = () => Promise.resolve([0, 3]);

    expect(await prompt($, "Select options", options)).toEqual({
      selected: [options[0], options[3]],
      unselected: [options[1], options[2]],
      deselected: [options[1]],
    });
  });

  it("returns empty arrays when no options are provided", async () => {
    const $ = make$();
    $.multiSelect = () => {
      throw new Error("Unexpected call to multiSelect");
    };

    expect(await prompt($, "Select options", [])).toEqual({
      selected: [],
      unselected: [],
      deselected: [],
    });
  });

  it("transforms option text", async () => {
    const options: MultiSelectOption[] = [
      { text: "Option 1", selected: false },
      { text: "Option 2", selected: false },
      { text: "Option 3", selected: false },
    ];

    const $ = make$();
    const multiSelectStub = stub(
      $,
      "multiSelect",
      returnsNext([Promise.resolve([0, 2])]),
    );

    expect(await prompt($, "Select options", options, (option) => option.text.toUpperCase()))
      .toEqual({
        selected: [options[0], options[2]],
        unselected: [options[1]],
        deselected: [],
      });

    expect(multiSelectStub.calls.length).toBe(1);
    expect(multiSelectStub.calls[0]?.args[0]).toMatchObject({
      options: [
        { text: "OPTION 1" },
        { text: "OPTION 2" },
        { text: "OPTION 3" },
      ],
    });
  });
});
