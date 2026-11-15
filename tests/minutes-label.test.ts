import { describe, expect, it } from "vitest";
import { strings } from "@/lib/i18n";

describe("aboutMinutes", () => {
  it("shows whole minutes, never a long decimal", () => {
    expect(strings.en.aboutMinutes(25.658551669318783)).toBe("~26 min");
    expect(strings.th.aboutMinutes(9.658551669318783)).toBe("~10 นาที");
  });
});
