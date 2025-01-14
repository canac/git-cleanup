import { build$, type MultiSelectOption } from "@david/dax";
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { returnsNext, stub } from "@std/testing/mock";
import { prompt } from "./prompt.ts";

describe("prompt", () => {
  it("returns selected, unselected, and deselected options", async () => {
    const options: MultiSelectOption[] = [
      { text: "Option 1", selected: true },
      { text: "Option 2", selected: true },
      { text: "Option 3", selected: false },
      { text: "Option 4", selected: false },
    ];

    const $ = build$();
    $.multiSelect = () => Promise.resolve([0, 3]);

    expect(await prompt($, "Select options", options)).toEqual({
      selected: ["Option 1", "Option 4"],
      unselected: ["Option 2", "Option 3"],
      deselected: ["Option 2"],
    });
  });

  it("returns empty arrays when no options are provided", async () => {
    const $ = build$();
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

    const $ = build$();
    const multiSelectStub = stub(
      $,
      "multiSelect",
      returnsNext([Promise.resolve([0, 2])]),
    );

    expect(await prompt($, "Select options", options, (option) => option.text.toUpperCase()))
      .toEqual({
        selected: ["Option 1", "Option 3"],
        unselected: ["Option 2"],
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
