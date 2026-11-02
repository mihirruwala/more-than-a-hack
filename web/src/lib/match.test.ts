import { describe, expect, it } from "vitest";
import { demoMatch } from "../data/fixtures/demoMatch";
import type { MatchFixture, MatchSegment } from "../types";
import { clip, defaultFilter, duration, firstVisible, isVisible, lastVisible, matchStats, scorerView, step, viewRange, windowAround } from "./match";

const seg = (index: number, start: number, end: number, state: MatchSegment["state"], period: 1 | 2 = 1): MatchSegment => ({
  index,
  start,
  end,
  state,
  period,
  note: "",
});

/** A hand-built match whose statistics can be checked by eye. fps 10 for easy arithmetic. */
const tiny: MatchFixture = {
  ...demoMatch,
  fps: 10,
  periods: [
    { id: 1, label: "1st half", start: 0, end: 600 },
    { id: 2, label: "2nd half", start: 600, end: 1000 },
  ],
  segments: [
    seg(0, 0, 100, "H"), //   10 s home
    seg(1, 100, 120, "X"), //  2 s abstain inside the home spell
    seg(2, 120, 200, "H"), //   8 s home: the same possession under the scorer's fill
    seg(3, 200, 450, "A"), //  25 s away: open-play turnover
    seg(4, 450, 500, "D"), //   5 s dead
    seg(5, 500, 600, "H"), //  10 s home: change after a stoppage
    seg(6, 600, 700, "A", 2), // 10 s away, new half
    seg(7, 700, 1000, "A", 2), // stays away (unmerged on purpose)
  ],
};

describe("the authoritative demo fixture", () => {
  it("is contiguous, ordered, indexed and inside its periods", () => {
    const { segments, periods } = demoMatch;
    expect(segments.length).toBeGreaterThan(100);
    segments.forEach((s, i) => {
      expect(s.index).toBe(i);
      expect(s.end).toBeGreaterThan(s.start);
      const period = periods.find((p) => p.id === s.period)!;
      expect(s.start).toBeGreaterThanOrEqual(period.start);
      expect(s.end).toBeLessThanOrEqual(period.end);
      if (i > 0) expect(s.start).toBe(segments[i - 1]!.end);
      expect(s.note.length).toBeGreaterThan(0);
    });
    expect(segments[segments.length - 1]!.end).toBe(periods[1]!.end);
  });

  it("is deterministic", async () => {
    const again = await import("../data/fixtures/demoMatch");
    expect(again.demoMatch.segments.length).toBe(demoMatch.segments.length);
  });

  it("contains every state", () => {
    const states = new Set(demoMatch.segments.map((s) => s.state));
    expect([...states].sort()).toEqual(["A", "D", "H", "X"]);
  });

  it("has statistics that add up to the timeline", () => {
    const stats = matchStats(demoMatch.segments, demoMatch.fps);
    const total = stats.frames.H + stats.frames.A + stats.frames.D + stats.frames.X;
    expect(total).toBe(demoMatch.periods[1]!.end - demoMatch.periods[0]!.start);
    const counted = stats.segmentCount.H + stats.segmentCount.A + stats.segmentCount.D + stats.segmentCount.X;
    expect(counted).toBe(demoMatch.segments.length);
    const binned = stats.histogram.reduce((n, b) => n + b.H + b.A, 0);
    expect(binned).toBe(stats.possessions.H + stats.possessions.A);
  });
});

describe("derived match statistics", () => {
  const stats = matchStats(tiny.segments, tiny.fps);

  it("sums frames per state", () => {
    expect(stats.frames).toEqual({ H: 280, A: 650, D: 50, X: 20 });
  });

  it("computes home share of possession time, excluding D and X", () => {
    expect(stats.homeShare).toBeCloseTo(280 / 930);
  });

  it("counts possessions the way the scorer does: X bridged, halves kept apart", () => {
    // H(0–200, X filled) · A · H after D · [half] · A (two segments merge into one spell)
    expect(stats.possessions).toEqual({ H: 2, A: 2 });
  });

  it("separates open-play turnovers from changes across a stoppage", () => {
    expect(stats.openPlayTurnovers).toBe(1); // H → A at frame 200
    expect(stats.changesAfterStoppage).toBe(1); // A, D, H
  });

  it("does not count a change across halftime as a turnover", () => {
    // H ends the first half and A starts the second; that is not a turnover.
    expect(stats.openPlayTurnovers).toBe(1);
  });

  it("bins possession durations", () => {
    const bins = Object.fromEntries(stats.histogram.map((b) => [b.label, b.H + b.A]));
    // H 0–200 (20 s, X filled) · A 25 s · H 10 s · A 40 s
    expect(bins).toEqual({ "< 5 s": 0, "5–10 s": 0, "10–20 s": 1, "20–30 s": 2, "30 s +": 1 });
  });

  it("returns a null share when nothing is alive", () => {
    expect(matchStats([seg(0, 0, 10, "D")], 10).homeShare).toBeNull();
  });

  it("back-fills X at the head of a period", () => {
    const filled = scorerView([seg(0, 0, 10, "X"), seg(1, 10, 20, "A")]);
    expect(filled).toEqual([{ start: 0, end: 20, state: "A", period: 1 }]);
  });
});

describe("segment filtering and navigation", () => {
  it("hides states that are switched off and segments outside the period", () => {
    const filter = { ...defaultFilter(), states: { H: true, A: false, D: true, X: true } };
    expect(isVisible(tiny.segments[3]!, filter)).toBe(false);
    expect(isVisible(tiny.segments[0]!, { ...defaultFilter(), period: 2 })).toBe(false);
  });

  it("steps to the next and previous visible segment, skipping hidden ones", () => {
    const onlyHome = { ...defaultFilter(), states: { H: true, A: false, D: false, X: false } };
    expect(step(tiny, onlyHome, 0, 1)?.index).toBe(2);
    expect(step(tiny, onlyHome, 2, 1)?.index).toBe(5);
    expect(step(tiny, onlyHome, 5, 1)).toBeNull();
    expect(step(tiny, onlyHome, 5, -1)?.index).toBe(2);
  });

  it("starts from either end when nothing is selected", () => {
    const filter = defaultFilter();
    expect(firstVisible(tiny, filter)?.index).toBe(0);
    expect(lastVisible(tiny, filter)?.index).toBe(7);
    expect(firstVisible(tiny, { ...filter, period: 2 })?.index).toBe(6);
  });

  it("returns null when the filter hides everything", () => {
    const none = { ...defaultFilter(), states: { H: false, A: false, D: false, X: false } };
    expect(firstVisible(tiny, none)).toBeNull();
  });

  it("keeps the zoom window inside the view range", () => {
    const range = viewRange(tiny, defaultFilter());
    expect(range).toEqual({ start: 0, end: 1000 });
    expect(windowAround(10, 200, range)).toEqual({ start: 0, end: 200 });
    expect(windowAround(990, 200, range)).toEqual({ start: 800, end: 1000 });
    expect(windowAround(500, 5000, range)).toEqual({ start: 0, end: 1000 });
    expect(viewRange(tiny, { ...defaultFilter(), period: 2 })).toEqual({ start: 600, end: 1000 });
  });

  it("clips segments to a window", () => {
    expect(clip(tiny.segments, 150, 250).map((s) => [s.start, s.end])).toEqual([
      [150, 200],
      [200, 250],
    ]);
  });
});

describe("formatting", () => {
  it("formats durations for people", () => {
    expect(duration(35, 25)).toBe("1.4 s");
    expect(duration(25 * 42, 25)).toBe("42 s");
    expect(duration(25 * 64, 25)).toBe("1 min 04 s");
  });
});

describe("turnover markers and lookup", () => {
  it("marks open-play changes only, matching the statistics", async () => {
    const { turnoverFrames, segmentAt } = await import("./match");
    expect(turnoverFrames(tiny.segments)).toEqual([200]);
    expect(segmentAt(tiny.segments, 199)?.index).toBe(2);
    expect(segmentAt(tiny.segments, 200)?.index).toBe(3);
    expect(segmentAt(tiny.segments, 5000)).toBeNull();
    expect(turnoverFrames(demoMatch.segments).length).toBe(matchStats(demoMatch.segments, demoMatch.fps).openPlayTurnovers);
  });
});
