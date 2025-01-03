import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { stripPrefix } from "./lib.ts";

describe("stripPrefix", () => {
  it("removes the prefix when the input starts with the prefix", () => {
    expect(stripPrefix("string", "str")).toBe("ing");
  });

  it("returns null when the input does not start with the prefix", () => {
    expect(stripPrefix("string", "foo")).toBeNull();
  });

  it("returns the input when the prefix is blank", () => {
    expect(stripPrefix("string", "")).toBe("string");
  });
});
