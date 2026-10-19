import { describe, test, expect } from "vitest";
import { compareByOrder } from "./order";

function sorted(orders: unknown[]): unknown[] {
  return orders
    .map((order) => ({ order }))
    .sort(compareByOrder)
    .map((item) => item.order);
}

describe("compareByOrder", () => {
  test("puts lower orders first", () => {
    expect(sorted([3, 1, 2])).toEqual([1, 2, 3]);
  });

  test("puts events without an order after ordered ones", () => {
    expect(sorted([undefined, 2, undefined, 1])).toEqual([
      1,
      2,
      undefined,
      undefined,
    ]);
  });

  test("tells an order of 0 apart from no order", () => {
    expect(sorted([undefined, 0])).toEqual([0, undefined]);
  });

  test("puts negative orders before everything else", () => {
    expect(sorted([undefined, 1, -1])).toEqual([-1, 1, undefined]);
  });

  test("treats anything but a number as no order", () => {
    expect(sorted(["first", 1])).toEqual([1, "first"]);
  });
});
