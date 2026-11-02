import { describe, expect, it } from "vitest";
import { demoMatch } from "../data/fixtures/demoMatch";
import { focusWindow, initialTimeline, timelineReducer, type TimelineState } from "./timelineState";

const reduce = timelineReducer(demoMatch);
const run = (...actions: Parameters<typeof reduce>[1][]) => actions.reduce<TimelineState>(reduce, initialTimeline(demoMatch));

describe("timeline selection and navigation", () => {
  it("starts with nothing selected and a window at kick-off", () => {
    const state = initialTimeline(demoMatch);
    expect(state.selected).toBeNull();
    expect(focusWindow(demoMatch, state).start).toBe(0);
  });

  it("steps forward from nothing to the first segment, then onwards", () => {
    expect(run({ type: "step", dir: 1 }).selected).toBe(0);
    expect(run({ type: "step", dir: 1 }, { type: "step", dir: 1 }).selected).toBe(1);
  });

  it("does not move past the ends", () => {
    const last = demoMatch.segments.length - 1;
    const atEnd = run({ type: "edge", edge: "last" });
    expect(atEnd.selected).toBe(last);
    expect(reduce(atEnd, { type: "step", dir: 1 }).selected).toBe(last);
    expect(reduce(run({ type: "select", index: 0 }), { type: "step", dir: -1 }).selected).toBe(0);
  });

  it("skips states that are filtered out", () => {
    const state = run({ type: "toggleState", state: "D" }, { type: "toggleState", state: "X" }, { type: "toggleState", state: "A" }, { type: "step", dir: 1 }, { type: "step", dir: 1 });
    const chosen = demoMatch.segments[state.selected!]!;
    expect(chosen.state).toBe("H");
    expect(chosen.index).toBeGreaterThan(0);
  });

  it("keeps a selection that a filter hides, so the UI can explain it", () => {
    const first = demoMatch.segments[0]!;
    const state = run({ type: "select", index: 0 }, { type: "toggleState", state: first.state });
    expect(state.selected).toBe(0);
    expect(state.filter.states[first.state]).toBe(false);
    expect(reduce(state, { type: "showState", state: first.state }).filter.states[first.state]).toBe(true);
  });

  it("scrolls the window to a selection outside it", () => {
    const far = demoMatch.segments[demoMatch.segments.length - 1]!;
    const state = run({ type: "select", index: far.index });
    const w = focusWindow(demoMatch, state);
    expect(far.start).toBeLessThan(w.end);
    expect(far.end).toBeGreaterThan(w.start);
  });

  it("restricts navigation to the chosen period", () => {
    const state = run({ type: "period", period: 2 }, { type: "step", dir: 1 });
    expect(demoMatch.segments[state.selected!]!.period).toBe(2);
    const w = focusWindow(demoMatch, state);
    expect(w.start).toBeGreaterThanOrEqual(demoMatch.periods[1]!.start);
  });

  it("pans by half a window and clamps at the ends", () => {
    const panned = run({ type: "pan", dir: 1 });
    expect(focusWindow(demoMatch, panned).start).toBe(4 * 60 * demoMatch.fps);
    const back = reduce(reduce(panned, { type: "pan", dir: -1 }), { type: "pan", dir: -1 });
    expect(focusWindow(demoMatch, back).start).toBe(0);
  });

  it("clears the selection and resets everything", () => {
    const busy = run({ type: "select", index: 5 }, { type: "toggleState", state: "H" }, { type: "zoom", zoom: 16 });
    expect(reduce(busy, { type: "clearSelection" }).selected).toBeNull();
    expect(reduce(busy, { type: "reset" })).toEqual(initialTimeline(demoMatch));
  });
});
