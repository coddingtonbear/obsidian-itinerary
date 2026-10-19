import { describe, test, expect } from "vitest";
import { getArrayForArrayOrObject } from "./util";

describe("getArrayForArrayOrObject", () => {
  test("returns an empty array for null and undefined", () => {
    expect(getArrayForArrayOrObject(null)).toEqual([]);
    expect(getArrayForArrayOrObject(undefined)).toEqual([]);
  });

  test("wraps a single value", () => {
    expect(getArrayForArrayOrObject("a")).toEqual(["a"]);
  });

  test("returns an array unchanged", () => {
    expect(getArrayForArrayOrObject(["a", "b"])).toEqual(["a", "b"]);
  });
});
