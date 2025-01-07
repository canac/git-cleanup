import { build$, type MultiSelectOption } from "@david/dax";
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { prompt } from "./prompt.ts";

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
