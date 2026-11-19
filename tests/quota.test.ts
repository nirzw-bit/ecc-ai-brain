import { describe, expect, it } from "vitest";
import { shouldDefer } from "../src/quota";

describe("free-tier soft quota guard", () => {
  it("defers work at or above the configured soft threshold", () => {
    expect(shouldDefer({ metric:"d1_reads", value:100, softLimit:100, unit:"rows" })).toBe(true);
    expect(shouldDefer({ metric:"d1_reads", value:101, softLimit:100, unit:"rows" })).toBe(true);
  });
  it("allows work below the soft threshold", () => {
    expect(shouldDefer({ metric:"d1_reads", value:99, softLimit:100, unit:"rows" })).toBe(false);
  });
  it("fails closed for non-finite observations", () => {
    expect(shouldDefer({ metric:"d1_reads", value:Number.NaN, softLimit:100, unit:"rows" })).toBe(true);
  });
});
