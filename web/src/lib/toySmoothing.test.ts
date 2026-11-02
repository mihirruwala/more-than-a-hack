import { describe, expect, it } from "vitest";
import { TOY_NOISY, TOY_TRUTH, agreement, countSpells, majority } from "./toySmoothing";

const shortKept = (labels: string[]) => labels.slice(230, 256).filter((l) => l === "H").length > 13;

describe("smoothing toy (Methodology illustration)", () => {
  it("has six true possessions, including the short one", () => {
    expect(TOY_TRUTH).toHaveLength(600);
    expect(countSpells(TOY_TRUTH)).toBe(6);
    expect(shortKept(TOY_TRUTH)).toBe(true);
  });

  it("is deterministic", () => {
    expect(TOY_NOISY.join("")).toBe(TOY_NOISY.join(""));
    expect(agreement(TOY_NOISY, TOY_TRUTH)).toBeGreaterThan(0.8);
  });

  it("shows all three regimes the page describes", () => {
    const raw = majority(TOY_NOISY, 0);
    expect(countSpells(raw)).toBeGreaterThan(12); // under-smoothed: invents possessions
    expect(agreement(raw, TOY_TRUTH)).toBeGreaterThan(0.8); // ...while frames mostly agree

    const ok = majority(TOY_NOISY, 12);
    expect(countSpells(ok)).toBe(6);
    expect(shortKept(ok)).toBe(true);

    const heavy = majority(TOY_NOISY, 30);
    expect(shortKept(heavy)).toBe(false); // over-smoothed: the short real possession is gone
    expect(countSpells(heavy)).toBe(4); // ...and the two away possessions either side merge
  });
});
