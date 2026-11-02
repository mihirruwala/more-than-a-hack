// Everything the Match Centre shows is computed here from one MatchFixture: visibility under a
// filter, keyboard navigation, the zoom window and every aggregate. Pure functions, no React.

import type {
  MatchFixture,
  MatchPeriod,
  MatchSegment,
  PossessionSegment,
  PossessionState,
  TimelineFilter,
} from "../types";

export const allStates = (): TimelineFilter["states"] => ({ H: true, A: true, D: true, X: true });
export const defaultFilter = (): TimelineFilter => ({ states: allStates(), period: "all" });

// -- time -----------------------------------------------------------------------------------

/** "34:07": a period-relative clock, the way a broadcast shows it. */
export function clock(frame: number, period: MatchPeriod, fps: number): string {
  const s = Math.max(0, Math.floor((frame - period.start) / fps));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** "1 min 04 s" / "12 s" / "1.4 s". */
export function duration(frames: number, fps: number): string {
  const s = frames / fps;
  if (s < 10) return `${s.toFixed(1)} s`;
  const whole = Math.round(s);
  return whole >= 60 ? `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, "0")} s` : `${whole} s`;
}

export const periodOf = (fixture: MatchFixture, segment: Pick<MatchSegment, "period">) =>
  fixture.periods.find((p) => p.id === segment.period)!;

// -- filtering & navigation -----------------------------------------------------------------

export function inPeriod(segment: MatchSegment, filter: TimelineFilter) {
  return filter.period === "all" || segment.period === filter.period;
}

/** Shown at full strength: in the selected period and of a selected state. */
export function isVisible(segment: MatchSegment, filter: TimelineFilter) {
  return inPeriod(segment, filter) && filter.states[segment.state];
}

export function segmentsInView(fixture: MatchFixture, filter: TimelineFilter): MatchSegment[] {
  return fixture.segments.filter((s) => inPeriod(s, filter));
}

/**
 * The next visible segment after (dir 1) or before (dir -1) `fromIndex`. When nothing is selected,
 * dir 1 gives the first visible segment and dir -1 the last. null when there is none.
 */
export function step(fixture: MatchFixture, filter: TimelineFilter, fromIndex: number | null, dir: 1 | -1): MatchSegment | null {
  const list = fixture.segments;
  let i = fromIndex === null ? (dir === 1 ? -1 : list.length) : fromIndex;
  for (i += dir; i >= 0 && i < list.length; i += dir) {
    if (isVisible(list[i]!, filter)) return list[i]!;
  }
  return null;
}

export const firstVisible = (fixture: MatchFixture, filter: TimelineFilter) => step(fixture, filter, null, 1);
export const lastVisible = (fixture: MatchFixture, filter: TimelineFilter) => step(fixture, filter, null, -1);

/** The frame range the timeline spans under a period filter. */
export function viewRange(fixture: MatchFixture, filter: TimelineFilter): { start: number; end: number } {
  const periods = filter.period === "all" ? fixture.periods : fixture.periods.filter((p) => p.id === filter.period);
  return { start: periods[0]!.start, end: periods[periods.length - 1]!.end };
}

/** A zoom window of `width` frames centred on `frame`, clamped inside `range`. */
export function windowAround(frame: number, width: number, range: { start: number; end: number }) {
  const span = Math.min(width, range.end - range.start);
  const start = Math.min(Math.max(range.start, Math.round(frame - span / 2)), range.end - span);
  return { start, end: start + span };
}

export function overlaps(segment: PossessionSegment, window: { start: number; end: number }) {
  return segment.end > window.start && segment.start < window.end;
}

/** Segments cut to a frame window, for previews. */
export function clip<T extends PossessionSegment>(segments: T[], start: number, end: number): T[] {
  return segments
    .filter((s) => overlaps(s, { start, end }))
    .map((s) => ({ ...s, start: Math.max(s.start, start), end: Math.min(s.end, end) }));
}

// -- statistics -----------------------------------------------------------------------------

/**
 * Labels with X forward-filled within each period (back-filled at a period's head), the way the
 * official scorer prepares a submission before counting possessions. Statistics about
 * possessions use this so they count what spellF1 would count.
 */
export function scorerView(segments: MatchSegment[]): { start: number; end: number; state: PossessionState; period: 1 | 2 }[] {
  const out: { start: number; end: number; state: PossessionState; period: 1 | 2 }[] = [];
  const byPeriod = new Map<number, MatchSegment[]>();
  for (const s of segments) byPeriod.set(s.period, [...(byPeriod.get(s.period) ?? []), s]);

  for (const list of byPeriod.values()) {
    const firstKnown = list.find((s) => s.state !== "X")?.state ?? "X";
    let carry: PossessionState = firstKnown;
    for (const s of list) {
      const state = s.state === "X" ? carry : s.state;
      carry = state;
      const last = out[out.length - 1];
      if (last && last.state === state && last.period === s.period && last.end === s.start) last.end = s.end;
      else out.push({ start: s.start, end: s.end, state, period: s.period });
    }
  }
  return out;
}

export interface MatchStats {
  frames: Record<PossessionState, number>;
  segmentCount: Record<PossessionState, number>;
  /** Home share of possession *time* (H / (H + A)). Not an accuracy of any kind. */
  homeShare: number | null;
  possessions: { H: number; A: number };
  /** Team changes with no stoppage in between: H directly to A (X bridged), or vice versa. */
  openPlayTurnovers: number;
  /** Team changes across a dead ball: H, D, A. A restart for the other side, not a turnover. */
  changesAfterStoppage: number;
  longestPossession: { frames: number; state: "H" | "A" } | null;
  histogram: { label: string; min: number; max: number; H: number; A: number }[];
}

export const HISTOGRAM_BINS = [
  { label: "< 5 s", min: 0, max: 5 },
  { label: "5–10 s", min: 5, max: 10 },
  { label: "10–20 s", min: 10, max: 20 },
  { label: "20–30 s", min: 20, max: 30 },
  { label: "30 s +", min: 30, max: Infinity },
];

export function matchStats(segments: MatchSegment[], fps: number): MatchStats {
  const frames = { H: 0, A: 0, D: 0, X: 0 };
  const segmentCount = { H: 0, A: 0, D: 0, X: 0 };
  for (const s of segments) {
    frames[s.state] += s.end - s.start;
    segmentCount[s.state] += 1;
  }

  const filled = scorerView(segments);
  const spells = filled.filter((s) => s.state === "H" || s.state === "A");
  const possessions = { H: 0, A: 0 };
  const histogram = HISTOGRAM_BINS.map((bin) => ({ ...bin, H: 0, A: 0 }));
  let longest: MatchStats["longestPossession"] = null;
  for (const spell of spells) {
    const team = spell.state as "H" | "A";
    const length = spell.end - spell.start;
    possessions[team] += 1;
    const secs = length / fps;
    const bin = histogram.find((b) => secs >= b.min && secs < b.max)!;
    bin[team] += 1;
    if (!longest || length > longest.frames) longest = { frames: length, state: team };
  }

  let openPlayTurnovers = 0;
  let changesAfterStoppage = 0;
  for (let i = 1; i < filled.length; i += 1) {
    const prev = filled[i - 1]!;
    const cur = filled[i]!;
    if (prev.period !== cur.period) continue;
    if ((prev.state === "H" && cur.state === "A") || (prev.state === "A" && cur.state === "H")) openPlayTurnovers += 1;
    if (cur.state === "D") {
      const before = prev.state;
      const after = filled[i + 1];
      if (after && after.period === cur.period && (before === "H" || before === "A") && (after.state === "H" || after.state === "A") && after.state !== before)
        changesAfterStoppage += 1;
    }
  }

  const alive = frames.H + frames.A;
  return {
    frames,
    segmentCount,
    homeShare: alive ? frames.H / alive : null,
    possessions,
    openPlayTurnovers,
    changesAfterStoppage,
    longestPossession: longest,
    histogram,
  };
}

/** Frames where possession passes in open play (H→A or A→H, X bridged). Drawn as markers. */
export function turnoverFrames(segments: MatchSegment[]): number[] {
  const filled = scorerView(segments);
  const out: number[] = [];
  for (let i = 1; i < filled.length; i += 1) {
    const prev = filled[i - 1]!;
    const cur = filled[i]!;
    if (prev.period !== cur.period) continue;
    if ((prev.state === "H" && cur.state === "A") || (prev.state === "A" && cur.state === "H")) out.push(cur.start);
  }
  return out;
}

/** The segment containing a frame, if any. Segments are sorted and contiguous, so bisect. */
export function segmentAt(segments: MatchSegment[], frame: number): MatchSegment | null {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid]!;
    if (frame < s.start) hi = mid - 1;
    else if (frame >= s.end) lo = mid + 1;
    else return s;
  }
  return null;
}
