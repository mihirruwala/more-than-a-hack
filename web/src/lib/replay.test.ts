import { describe, expect, it } from "vitest";
import builtIn from "../data/fixtures/liveReplay.json";
import { formatClock, frameAt, parseReplay, runs, summarise, trail } from "./replay";

function tiny(overrides: Record<string, unknown> = {}, frames: Record<string, unknown> = {}) {
  return {
    format: "barca-lab-replay", version: 1, provenance: "synthetic", source: "test", fps: 25,
    pitch: [105.3, 68], lag: 25, teams: [0, 1], firstFrame: 100,
    ...overrides,
    frames: {
      players: [[10, 10, 20, 20], [11, 10, null, null], [12, 10, 22, 20]],
      ball: [[10.5, 10], null, [12.5, 10]],
      est: [[10.5, 10, 0.3], [11.4, 10, 1.2], [12.5, 10, 0.3]],
      label: "HHA", pHome: [90, 80, 20], pAway: [5, 10, 75], truth: "HHH",
      ...frames,
    },
  };
}

describe("parseReplay", () => {
  it("accepts the built-in replay written by live_estimator.py", () => {
    const result = parseReplay(builtIn);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replay.length).toBe(2250);
      expect(result.replay.provenance).toBe("synthetic");
      expect(result.replay.truth?.length).toBe(2250);
    }
  });

  it("accepts JSON text as well as an object", () => {
    expect(parseReplay(JSON.stringify(tiny())).ok).toBe(true);
  });

  it.each([
    ["not JSON", "{", /valid JSON/],
    ["wrong format", tiny({ format: "x" }), /Not a replay file/],
    ["wrong version", tiny({ version: 2 }), /version/],
    ["bad team", tiny({ teams: [0, 2] }), /teams/],
    ["length mismatch", tiny({}, { ball: [null] }), /frames\.ball must have 3/],
    ["bad label", tiny({}, { label: "HQA" }), /only contain H, A, D and X/],
    ["no answered frame", tiny({}, { label: "XXX" }), /no answered frame/],
    ["wrong slot count", tiny({}, { players: [[1, 2], [1, 2], [1, 2]] }), /4 numbers/],
    ["bad probability", tiny({}, { pHome: [90, 80, 99], pAway: [5, 10, 75] }), /percentages/],
    ["truth on a local run", tiny({ provenance: "local-run" }), /Only synthetic/],
  ])("rejects %s", (_, input, message) => {
    const result = parseReplay(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});

describe("replay helpers", () => {
  const parsed = parseReplay(tiny());
  if (!parsed.ok) throw new Error(parsed.error);
  const replay = parsed.replay;

  it("frameAt skips missing tracks, clamps the index and derives pDead", () => {
    const view = frameAt(replay, 1);
    expect(view.frame).toBe(101);
    expect(view.players).toEqual([{ slot: 0, team: 0, x: 11, y: 10 }]);
    expect(view.ball).toBeNull();
    expect(view.est).toEqual({ x: 11.4, y: 10, sigma: 1.2 });
    expect(view.pDead).toBe(10);
    expect(frameAt(replay, 99).index).toBe(2);
    expect(frameAt(replay, -5).index).toBe(0);
  });

  it("frames outside play are X, with no dead-ball probability", () => {
    const outside = parseReplay(tiny({}, { label: "XHA", pHome: [0, 80, 20], pAway: [0, 10, 75], est: [null, [11.4, 10, 1.2], [12.5, 10, 0.3]] }));
    if (!outside.ok) throw new Error(outside.error);
    const view = frameAt(outside.replay, 0);
    expect(view.label).toBe("X");
    expect(view.pDead).toBe(0);
    expect(view.est).toBeNull();
  });

  it("runs encodes constant stretches", () => {
    expect(runs("HHADD")).toEqual([
      { start: 0, stop: 2, label: "H" },
      { start: 2, stop: 3, label: "A" },
      { start: 3, stop: 5, label: "D" },
    ]);
  });

  it("summarise counts possessions and agreement", () => {
    const summary = summarise(replay);
    expect(summary.estimatedPossessions).toBe(2);
    expect(summary.truePossessions).toBe(1);
    expect(summary.agreement).toBeCloseTo(2 / 3);
    expect(summary.hiddenShare).toBeCloseTo(1 / 3);
  });

  it("trail and clock", () => {
    expect(trail(replay, 2, 2)).toEqual([[11.4, 10], [12.5, 10]]);
    expect(formatClock(83.25)).toBe("1:23.3");
  });
});
