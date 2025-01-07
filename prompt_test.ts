import { build$, type MultiSelectOption } from "@david/dax";
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
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
});
