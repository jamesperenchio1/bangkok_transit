import { describe, expect, it } from "vitest";
import { shouldDismiss } from "@/lib/use-sheet-drag";

describe("shouldDismiss", () => {
  it("dismisses after a long drag, however slow", () => {
    expect(shouldDismiss(120, 2000)).toBe(true);
  });
  it("dismisses a short fast flick but not a short slow drag", () => {
    expect(shouldDismiss(50, 60)).toBe(true);
    expect(shouldDismiss(50, 1000)).toBe(false);
  });
  it("ignores a tap or an upward drag", () => {
    expect(shouldDismiss(0, 50)).toBe(false);
    expect(shouldDismiss(-80, 50)).toBe(false);
  });
});
