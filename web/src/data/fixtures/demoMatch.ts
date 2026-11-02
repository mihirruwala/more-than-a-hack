// DEMO DATA: the one authoritative synthetic match. The Match Centre timeline, the segment detail,
// every aggregate statistic and the landing-page preview are all derived from `demoMatch`.
//
// It is generated, not observed. No competition data, tracking, tagging or ground truth went into
// it; the teams are fictional and it describes no real match. A seeded generator makes it
// identical on every render and every machine.

import type { MatchFixture, MatchPeriod, MatchSegment, PitchChannel, PitchThird, PossessionState } from "../../types";

export const DEMO_FPS = 25;
const SEED = 2027;

/** mulberry32: tiny, fast and fully deterministic. Good enough for illustrations. */
export function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const seconds = (s: number) => Math.round(s * DEMO_FPS);

const PERIODS: MatchPeriod[] = [
  { id: 1, label: "1st half", start: 0, end: seconds(46 * 60) },
  { id: 2, label: "2nd half", start: seconds(46 * 60), end: seconds(46 * 60 + 48 * 60) },
];

type RawSegment = Omit<MatchSegment, "index" | "note">;

function generatePeriod(period: MatchPeriod, kickoff: "H" | "A", random: () => number): RawSegment[] {
  const out: RawSegment[] = [];
  let frame = period.start;
  let team: "H" | "A" = kickoff;
  const thirds: PitchThird[] = ["defensive", "middle", "final"];
  const channels: PitchChannel[] = ["left", "centre", "right"];

  const push = (state: PossessionState, length: number, zone?: RawSegment["zone"]) => {
    const end = Math.min(period.end, frame + length);
    if (end > frame) out.push({ start: frame, end, state, period: period.id, ...(zone ? { zone } : {}) });
    frame = end;
  };

  while (frame < period.end) {
    // Spell length skews short, as real possessions do: 3 s to ~45 s.
    const spell = seconds(3 + 42 * random() ** 2.2);
    const zone = {
      third: thirds[Math.min(2, Math.floor(random() * 3.2))]!,
      channel: channels[Math.floor(random() * 3)]!,
    };

    // Now and then the tracking loses the ball mid-possession: split the spell around an X.
    if (random() < 0.09 && spell > seconds(8)) {
      const first = Math.round(spell * (0.3 + random() * 0.4));
      push(team, first, zone);
      push("X", seconds(1 + random() * 3));
      push(team, spell - first, zone);
    } else {
      push(team, spell, zone);
    }

    if (frame >= period.end) break;
    if (random() < 0.3) {
      push("D", seconds(5 + random() * 35));
      // After a stoppage either side may restart.
      team = random() < 0.5 ? "H" : "A";
    } else {
      team = team === "H" ? "A" : "H";
    }
  }
  return out;
}

/** Merge accidental same-state neighbours (e.g. a restart to the side that had the ball). */
function merge(segments: RawSegment[]): RawSegment[] {
  const out: RawSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last && last.state === segment.state && last.period === segment.period && last.end === segment.start) {
      last.end = segment.end;
    } else out.push({ ...segment });
  }
  return out;
}

const fmt = (frames: number) => {
  const s = Math.round(frames / DEMO_FPS);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};

/** The explanatory note is written from the fixture's own structure, never by hand per segment. */
function annotate(segment: RawSegment, prev: RawSegment | undefined, next: RawSegment | undefined, names: Record<"H" | "A", string>): string {
  const duration = segment.end - segment.start;
  if (segment.state === "X") {
    return "Tracking lost the ball, so the system abstains. The scorer fills X with the previous label, so a gap inside a possession costs nothing on spellF1.";
  }
  if (segment.state === "D") {
    const restart = next && (next.state === "H" || next.state === "A") ? `${names[next.state]} restart.` : "Play resumes.";
    return `Ball out of play for ${fmt(duration)}. Dead ball is a stoppage, never a possession. ${restart}`;
  }
  const team = names[segment.state];
  const parts: string[] = [];
  if (!prev) parts.push(`Kick-off: ${team} start the half in possession.`);
  else if (prev.state === "D") parts.push(`${team} take the restart.`);
  else if (prev.state === "X") parts.push(`${team} keep the ball through a tracking gap.`);
  else parts.push(`${team} win the ball in open play: a turnover.`);
  if (duration < seconds(5)) parts.push("A short spell. It could be a loose ball the metric still counts as a possession.");
  if (segment.zone) parts.push(`Mostly in the ${segment.zone.third} third, ${segment.zone.channel} channel (synthetic).`);
  return parts.join(" ");
}

function build(): MatchFixture {
  const random = rng(SEED);
  const home = { name: "Northbridge Athletic", short: "NBA", side: "H" as const };
  const away = { name: "Harbour Rovers", short: "HRV", side: "A" as const };
  const names = { H: home.name, A: away.name };

  const raw = merge([...generatePeriod(PERIODS[0]!, "H", random), ...generatePeriod(PERIODS[1]!, "A", random)]);
  const segments: MatchSegment[] = raw.map((segment, index) => {
    const prev = raw[index - 1]?.period === segment.period ? raw[index - 1] : undefined;
    const next = raw[index + 1]?.period === segment.period ? raw[index + 1] : undefined;
    return { ...segment, index, note: annotate(segment, prev, next, names) };
  });

  return {
    id: "demo-nba-hrv",
    title: `${home.name} v ${away.name}`,
    competition: "Demo fixture · fictional teams",
    provenance: "demo",
    source: "web/src/data/fixtures/demoMatch.ts: seeded generator, seed 2027",
    fps: DEMO_FPS,
    home,
    away,
    periods: PERIODS,
    segments,
  };
}

export const demoMatch: MatchFixture = build();
