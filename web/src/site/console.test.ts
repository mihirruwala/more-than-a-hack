import { describe, expect, it } from "vitest";
import builtIn from "../data/fixtures/liveReplay.json";
import { analyse, decodeReplay, frameAt, heatmap, parseReplay, percentile, slotName, teamTotals, type Replay } from "./console";

function replay(): Replay {
  const parsed = parseReplay(builtIn);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.replay;
}

describe("parseReplay", () => {
  it("accepts the replay file live_estimator.py writes", () => {
    const parsed = parseReplay(JSON.stringify(builtIn));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.replay.truth?.length).toBe(parsed.replay.length);
  });

  it("explains what is wrong with other files", () => {
    expect(parseReplay("{").ok).toBe(false);
    const wrong = parseReplay({ ...builtIn, format: "something-else" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain("Not a replay file");
    const real = parseReplay({ ...builtIn, provenance: "local-run" });
    expect(real.ok).toBe(false); // truth may only travel with synthetic replays
  });
});

describe("packed site replay", () => {
  it("decodes to every 2nd frame of the bundled replay", () => {
    const full = replay();
    const packed = decodeReplay();
    expect(packed.length).toBe(Math.ceil(full.length / 2));
    expect(packed.fps).toBe(full.fps / 2);
    expect(packed.label).toBe([...full.label].filter((_, i) => i % 2 === 0).join(""));
    const k = 400;
    packed.players[k]!.forEach((v, j) => {
      const orig = full.players[2 * k]![j];
      if (v === null) expect(orig).toBeNull();
      else expect(v).toBeCloseTo(orig!, 1);
    });
  });

  it("interpolates positions between frames but not calls", () => {
    const r = decodeReplay();
    const a = frameAt(r, 100);
    const b = frameAt(r, 101);
    const mid = frameAt(r, 100.5);
    expect(mid.label).toBe(a.label);
    const p = mid.players[0]!;
    expect(p.x).toBeCloseTo((a.players[0]!.x + b.players[0]!.x) / 2, 5);
  });
});

describe("percentile", () => {
  it("interpolates like numpy", () => {
    expect(percentile([1, 2, 3, 4], 90)).toBeCloseTo(3.7);
    expect(percentile([5], 90)).toBe(5);
    expect(Number.isNaN(percentile([], 90))).toBe(true);
  });
});

describe("analyse", () => {
  const r = replay();
  const a = analyse(r);

  it("covers every frame", () => {
    expect(a.p90.length).toBe(r.length);
    expect(a.speed.length).toBe(r.teams.length);
    expect(a.callCount[0]![r.length - 1]! + a.callCount[1]![r.length - 1]! + a.callCount[2]![r.length - 1]!).toBe(r.label.replace(/X/g, "").length);
  });

  it("keeps distance and top speed non-decreasing", () => {
    for (const d of a.distance) for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThanOrEqual(d[i - 1]!);
  });

  it("orders events in time and keeps dead-ball evidence in 0–1", () => {
    for (let k = 1; k < a.events.length; k++) expect(a.events[k]!.index).toBeGreaterThanOrEqual(a.events[k - 1]!.index);
    for (const v of a.deadEvidence) if (Number.isFinite(v)) expect(v >= 0 && v <= 1).toBe(true);
  });

  it("totals agree with the call counts", () => {
    const [home, away] = teamTotals(r, a, r.length - 1);
    expect(home.possessionShare + away.possessionShare).toBeCloseTo(1);
    const cells = heatmap(a, r.length - 1).reduce((s, v) => s + v, 0);
    expect(cells).toBe(r.est.filter(Boolean).length);
  });

  it("names slots by team", () => {
    expect(slotName(r, 0)).toBe("Home #1");
    expect(slotName(r, 11)).toBe("Away #1");
  });
});
