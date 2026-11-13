import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { CONSOLE_REPLAY } from "./consoleReplay";

// Match console: the live estimator played back on a simulated match, broadcast style.
// Source of truth: web/src/site/console.tsx in github.com/mihirruwala/more-than-a-hack.
// The project site (Figma Make) runs this file as src/console.tsx, with src/consoleReplay.ts.
// Every number is computed from the replay; tracking has positions only, so no pose, shot or xG.

type ReplayLabel = "H" | "A" | "D";
type ReplayCall = ReplayLabel | "X";
export interface Replay {
  provenance: "synthetic" | "local-run";
  source: string;
  fps: number;
  pitch: [number, number];
  lag: number;
  teams: (0 | 1)[];
  firstFrame: number;
  length: number;
  players: (number | null)[][];
  ball: ([number, number] | null)[];
  est: ([number, number, number | null] | null)[];
  label: string;
  pHome: number[];
  pAway: number[];
  truth?: string;
}
interface FrameView {
  index: number;
  /** Fraction of the way to the next frame, for smooth playback. */
  frac: number;
  frame: number;
  seconds: number;
  players: { slot: number; team: 0 | 1; x: number; y: number }[];
  ball: [number, number] | null;
  est: { x: number; y: number; sigma: number | null } | null;
  label: ReplayCall;
  pHome: number;
  pAway: number;
  pDead: number;
  truth: ReplayLabel | null;
}
interface Run {
  start: number;
  stop: number;
  label: string;
}

export function decodeReplay(): Replay {
  const r = CONSOLE_REPLAY;
  const bin = atob(r.packed);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  const v = new DataView(bytes.buffer);
  const NA = -32768;
  const slots = r.teams.length;
  const per = slots * 2 + 7;
  const at = (k: number) => v.getInt16(k * 2, true);
  const m = (k: number) => (at(k) === NA ? null : at(k) / 10);
  const players: (number | null)[][] = [];
  const ball: ([number, number] | null)[] = [];
  const est: ([number, number, number | null] | null)[] = [];
  const pHome: number[] = [];
  const pAway: number[] = [];
  for (let i = 0; i < r.length; i++) {
    const o = i * per;
    const row: (number | null)[] = [];
    for (let k = 0; k < slots * 2; k++) row.push(m(o + k));
    players.push(row);
    const b = o + slots * 2;
    ball.push(at(b) === NA ? null : [at(b) / 10, at(b + 1) / 10]);
    est.push(at(b + 2) === NA ? null : [at(b + 2) / 10, at(b + 3) / 10, m(b + 4)]);
    pHome.push(at(b + 5));
    pAway.push(at(b + 6));
  }
  return { provenance: "synthetic", source: r.source, fps: r.fps, pitch: r.pitch, lag: r.lag, teams: r.teams, firstFrame: r.firstFrame, length: r.length, players, ball, est, label: r.label, pHome, pAway, truth: r.truth };
}

const REPLAY_FORMAT = "barca-lab-replay";
/** The Python writer caps a replay at 600 s. */
const MAX_FRAMES = 600 * 25;
type ParseResult = { ok: true; replay: Replay } | { ok: false; error: string };
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length >= 2 && isNum(v[0]) && isNum(v[1]);

/** Validates a replay file written by live_estimator.py --replay. Every per-frame array must cover the same frames. */
export function parseReplay(input: unknown): ParseResult {
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, error: "Not valid JSON." };
    }
  }
  if (!data || typeof data !== "object") return { ok: false, error: "Not a replay record." };
  const r = data as Record<string, unknown>;
  if (r.format !== REPLAY_FORMAT) return { ok: false, error: `Not a replay file (format should be "${REPLAY_FORMAT}").` };
  if (r.version !== 1) return { ok: false, error: `Unsupported replay version ${String(r.version)}; this page reads version 1.` };
  if (r.provenance !== "synthetic" && r.provenance !== "local-run") return { ok: false, error: "Unknown provenance." };
  if (!isNum(r.fps) || r.fps <= 0 || r.fps > 120) return { ok: false, error: "fps must be a positive number." };
  if (!isPoint(r.pitch) || r.pitch[0] <= 0 || r.pitch[1] <= 0) return { ok: false, error: "pitch must be [length, width] in metres." };
  if (!isNum(r.lag) || r.lag < 0) return { ok: false, error: "lag must be a frame count." };
  if (!isNum(r.firstFrame)) return { ok: false, error: "firstFrame is missing." };
  if (!Array.isArray(r.teams) || r.teams.length === 0 || !r.teams.every((t) => t === 0 || t === 1)) return { ok: false, error: "teams must list 0 (home) or 1 (away) per track." };
  const f = r.frames as Record<string, unknown> | undefined;
  if (!f || typeof f !== "object") return { ok: false, error: "frames is missing." };
  const label = f.label;
  if (typeof label !== "string" || label.length === 0) return { ok: false, error: "frames.label is missing." };
  const n = label.length;
  if (n > MAX_FRAMES) return { ok: false, error: "Replay is longer than 600 s." };
  if (!/^[HADX]+$/.test(label)) return { ok: false, error: "frames.label may only contain H, A, D and X." };
  if (!/[HAD]/.test(label)) return { ok: false, error: "frames.label has no answered frame (all X)." };
  for (const key of ["players", "ball", "est", "pHome", "pAway"] as const) {
    if (!Array.isArray(f[key]) || (f[key] as unknown[]).length !== n) return { ok: false, error: `frames.${key} must have ${n} entries, one per frame.` };
  }
  const slots = r.teams.length * 2;
  const players = f.players as unknown[];
  for (let i = 0; i < n; i++) {
    const row = players[i];
    if (!Array.isArray(row) || row.length !== slots || !row.every((v) => v === null || isNum(v))) return { ok: false, error: `frames.players[${i}] must hold ${slots} numbers or nulls.` };
  }
  const ball = f.ball as unknown[];
  const est = f.est as unknown[];
  const pHome = f.pHome as unknown[];
  const pAway = f.pAway as unknown[];
  for (let i = 0; i < n; i++) {
    if (ball[i] !== null && !isPoint(ball[i])) return { ok: false, error: `frames.ball[${i}] must be [x, y] or null.` };
    const e = est[i];
    if (e !== null && !(isPoint(e) && ((e as unknown[])[2] === null || isNum((e as unknown[])[2])))) return { ok: false, error: `frames.est[${i}] must be [x, y, sigma] or null.` };
    const h = pHome[i];
    const a = pAway[i];
    if (!isNum(h) || !isNum(a) || h < 0 || a < 0 || h + a > 101) return { ok: false, error: `frames.pHome/pAway[${i}] must be percentages.` };
  }
  let truth: string | undefined;
  if (f.truth !== undefined) {
    if (typeof f.truth !== "string" || f.truth.length !== n || !/^[HADX]+$/.test(f.truth)) return { ok: false, error: "frames.truth must be one H/A/D/X per frame." };
    if (r.provenance !== "synthetic") return { ok: false, error: "Only synthetic replays may carry ground truth." };
    truth = f.truth;
  }
  return {
    ok: true,
    replay: {
      provenance: r.provenance,
      source: typeof r.source === "string" ? r.source : "unknown",
      fps: r.fps,
      pitch: [r.pitch[0], r.pitch[1]],
      lag: r.lag,
      teams: r.teams as (0 | 1)[],
      firstFrame: r.firstFrame,
      length: n,
      players: players as (number | null)[][],
      ball: ball as ([number, number] | null)[],
      est: est as ([number, number, number | null] | null)[],
      label,
      pHome: pHome as number[],
      pAway: pAway as number[],
      truth,
    },
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** One frame of the replay. Positions are interpolated toward the next frame; calls are not. */
export function frameAt(replay: Replay, index: number): FrameView {
  const clamped = Math.max(0, Math.min(replay.length - 1, index));
  const i = Math.floor(clamped);
  const t = clamped - i;
  const j = Math.min(replay.length - 1, i + 1);
  const row = replay.players[i]!;
  const next = replay.players[j]!;
  const players: FrameView["players"] = [];
  for (let slot = 0; slot < replay.teams.length; slot++) {
    const x = row[slot * 2];
    const y = row[slot * 2 + 1];
    if (x == null || y == null) continue;
    const nx = next[slot * 2];
    const ny = next[slot * 2 + 1];
    players.push({ slot, team: replay.teams[slot]!, x: nx != null ? lerp(x, nx, t) : x, y: ny != null ? lerp(y, ny, t) : y });
  }
  const e = replay.est[i];
  const en = replay.est[j];
  const b = replay.ball[i];
  const bn = replay.ball[j];
  const pHome = replay.pHome[i]!;
  const pAway = replay.pAway[i]!;
  const truth = replay.truth?.[i];
  return {
    index: i,
    frac: t,
    frame: Math.round((replay.firstFrame + clamped) * (25 / replay.fps)),
    seconds: clamped / replay.fps,
    players,
    ball: b ? (bn ? [lerp(b[0], bn[0], t), lerp(b[1], bn[1], t)] : b) : null,
    est: e ? { x: en ? lerp(e[0], en[0], t) : e[0], y: en ? lerp(e[1], en[1], t) : e[1], sigma: e[2] } : null,
    label: replay.label[i] as ReplayCall,
    pHome,
    pAway,
    pDead: replay.label[i] === "X" ? 0 : Math.max(0, 100 - pHome - pAway),
    truth: truth && truth !== "X" ? (truth as ReplayLabel) : null,
  };
}

function runs(labels: string): Run[] {
  const out: Run[] = [];
  let start = 0;
  for (let i = 1; i <= labels.length; i++) {
    if (i === labels.length || labels[i] !== labels[start]) {
      out.push({ start, stop: i, label: labels[start]! });
      start = i;
    }
  }
  return out;
}

const formatClock = (seconds: number) => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

/** CSS classes are global here, so every console class carries an mc- prefix. */
const s: Record<string, string> = new Proxy({}, { get: (_t, k) => `mc-${String(k)}` });

/* ---- analytics ---- */
// Derived analytics for the Match console. Everything here is computed from a replay file (the
// output of `starter/live_estimator.py --replay`): positions, the ball estimate and the possession
// posterior. Nothing is invented, so the console shows no pose, xG or shot numbers: the tracking
// data cannot support them.


/** live_estimator.DEAD_SPEED_MID / DEAD_SPEED_WIDTH, m/s. Kept in step with the Python side by hand. */
const DEAD_SPEED_MID = 2.0;
const DEAD_SPEED_WIDTH = 0.4;
/** live_estimator.CONTROL_RADIUS, m: a player this close to the ball is plausibly playing it. */
const CONTROL_RADIUS = 1.6;
/** A high-speed run: at least 19.8 km/h (5.5 m/s) held for a second. The usual broadcast threshold. */
const HIGH_SPEED = 5.5;
/**
 * Faster than any footballer runs (the fastest sprint ever timed peaks near 12.4 m/s). A track
 * that moves faster has jumped: usually a tracking slot handed from one player to another. Such
 * moves are left out of speeds, distances and runs instead of being reported as 2,000 km/h.
 */
const MAX_PLAYER_SPEED = 12.5;
/** A struck ball tops out around 35 m/s; anything faster is the ball estimate jumping. */
const MAX_BALL_SPEED = 45;

const kmh = (ms: number) => ms * 3.6;

type EventKind = "home" | "away" | "dead" | "restart" | "hidden" | "found" | "run";

interface ConsoleEvent {
  index: number;
  kind: EventKind;
  text: string;
  /** Tracking slot involved, if any. */
  slot?: number;
}

interface Analytics {
  /** speed[slot][frame], m/s over the last second (DISPLAY_SPAN); NaN where unknown. */
  speed: Float32Array[];
  /** Fastest-tenth player speed per frame (90th percentile), m/s; NaN with fewer than 6 tracks. */
  p90: Float32Array;
  /** Dead-ball evidence from the speed term alone, 0–1 (before the estimator's other terms). */
  deadEvidence: Float32Array;
  /** Estimated ball speed per frame, m/s; NaN without an estimate. */
  ballSpeed: Float32Array;
  /** Nearest track to the estimated ball per frame, or -1. */
  nearest: Int16Array;
  nearestDistance: Float32Array;
  /** Cumulative distance per slot, metres. */
  distance: Float32Array[];
  /** Tracking jumps per slot: one-frame moves no player could make, left out of the figures. */
  jumps: number[];
  /** Top speed so far per slot, m/s. */
  topSpeed: Float32Array[];
  /** High-speed runs: start frame per slot. */
  runStarts: number[][];
  /** Cumulative estimated frames by call: [H, A, D] up to and including each frame. */
  callCount: Uint32Array[];
  /** Cumulative frames where the tracking did not see the ball. */
  hiddenCount: Uint32Array;
  /** How long the ball has been hidden at each frame, in frames. */
  hiddenFor: Uint32Array;
  /** Cumulative frames agreeing with the simulator's truth, and graded frames. Synthetic only. */
  agree: Uint32Array | null;
  graded: Uint32Array | null;
  /** Cumulative sum of the top posterior, percent, for a running mean certainty. */
  certainty: Float64Array;
  /** Heatmap bin of the estimated ball per frame, or -1. */
  heatBin: Int16Array;
  heatCols: number;
  heatRows: number;
  /** A smoothed ball position, for the follow camera. */
  camX: Float32Array;
  camY: Float32Array;
  events: ConsoleEvent[];
}

/** numpy.percentile with linear interpolation, which is what the estimator uses. */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (q / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const xy = (replay: Replay, frame: number, slot: number): [number, number] | null => {
  const row = replay.players[frame]!;
  const x = row[slot * 2];
  const y = row[slot * 2 + 1];
  return x != null && y != null ? [x, y] : null;
};

/** Team-relative shirt-style number for a slot: the slot's position within its team, from 1. */
export function slotNumber(replay: Replay, slot: number): number {
  let n = 0;
  for (let s = 0; s <= slot; s++) if (replay.teams[s] === replay.teams[slot]) n++;
  return n;
}

export const slotName = (replay: Replay, slot: number) => `${replay.teams[slot] === 0 ? "Home" : "Away"} #${slotNumber(replay, slot)}`;

export function analyse(replay: Replay, heatCell = 3.5): Analytics {
  const n = replay.length;
  const slots = replay.teams.length;
  const fps = replay.fps;
  // Spans in frames, from seconds, so any frame rate works. The stoppage detector differences
  // over 0.2 s like live_estimator._player_speeds; shown speeds use 1 s to hide tracking jitter.
  const VELOCITY_SPAN = Math.max(1, Math.round(0.2 * fps));
  const DISPLAY_SPAN = Math.max(1, Math.round(fps));
  const HIGH_SPEED_MIN_FRAMES = Math.max(1, Math.round(fps));
  const HIDDEN_EVENT_FRAMES = Math.max(1, Math.round(fps));
  const DISTANCE_STEP = Math.max(1, Math.round(0.2 * fps));
  const camAlpha = 1 - Math.pow(0.97, 25 / fps);
  const [L, W] = replay.pitch;

  const speed = Array.from({ length: slots }, () => new Float32Array(n).fill(Number.NaN));
  const distance = Array.from({ length: slots }, () => new Float32Array(n));
  const topSpeed = Array.from({ length: slots }, () => new Float32Array(n));
  const runStarts: number[][] = Array.from({ length: slots }, () => []);
  const jumps: number[] = new Array(slots).fill(0);
  const p90 = new Float32Array(n).fill(Number.NaN);
  const deadEvidence = new Float32Array(n).fill(Number.NaN);
  const ballSpeed = new Float32Array(n).fill(Number.NaN);
  const nearest = new Int16Array(n).fill(-1);
  const nearestDistance = new Float32Array(n).fill(Number.NaN);
  const callCount = [new Uint32Array(n), new Uint32Array(n), new Uint32Array(n)];
  const hiddenCount = new Uint32Array(n);
  const hiddenFor = new Uint32Array(n);
  const agree = replay.truth ? new Uint32Array(n) : null;
  const graded = replay.truth ? new Uint32Array(n) : null;
  const certainty = new Float64Array(n);
  const heatCols = Math.ceil(L / heatCell);
  const heatRows = Math.ceil(W / heatCell);
  const heatBin = new Int16Array(n).fill(-1);
  const camX = new Float32Array(n);
  const camY = new Float32Array(n);
  const events: ConsoleEvent[] = [];

  const fastRun = new Uint16Array(slots);
  const first = replay.est.find((e) => e);
  let camera = Math.min(L - 18, Math.max(18, first?.[0] ?? L / 2));
  let cameraY = Math.min(W - 10, Math.max(10, first?.[1] ?? W / 2));

  for (let i = 0; i < n; i++) {
    const span = Math.min(i, VELOCITY_SPAN);
    const longSpan = DISPLAY_SPAN; // full span only: a 1-frame difference early on is pure jitter
    const finite: number[] = [];
    for (let s = 0; s < slots; s++) {
      const now = xy(replay, i, s);
      const then = span > 0 ? xy(replay, i - span, s) : null;
      if (now && then) {
        const v5 = Math.hypot(now[0] - then[0], now[1] - then[1]) * (fps / span);
        if (v5 <= MAX_PLAYER_SPEED) finite.push(v5);
      }
      const longThen = i >= longSpan ? xy(replay, i - longSpan, s) : null;
      if (now && longThen) {
        const v1 = Math.hypot(now[0] - longThen[0], now[1] - longThen[1]) * (fps / longSpan);
        if (v1 <= MAX_PLAYER_SPEED) speed[s]![i] = v1;
      }
      // A one-frame move faster than any player can run is a tracking jump; count it once.
      const prev = i > 0 ? xy(replay, i - 1, s) : null;
      if (now && prev && Math.hypot(now[0] - prev[0], now[1] - prev[1]) * fps > MAX_PLAYER_SPEED * 1.5) jumps[s]!++;
      // Distance and top speed, carried forward.
      const prevDist = i > 0 ? distance[s]![i - 1]! : 0;
      let d = prevDist;
      if (i >= DISTANCE_STEP && i % DISTANCE_STEP === 0) {
        const back = xy(replay, i - DISTANCE_STEP, s);
        if (now && back) {
          const step = Math.hypot(now[0] - back[0], now[1] - back[1]);
          if ((step * fps) / DISTANCE_STEP <= MAX_PLAYER_SPEED) d += step;
        }
      }
      distance[s]![i] = d;
      const v = speed[s]![i]!;
      topSpeed[s]![i] = Math.max(i > 0 ? topSpeed[s]![i - 1]! : 0, Number.isFinite(v) ? v : 0);
      // High-speed runs: count one when the run reaches a second.
      if (Number.isFinite(v) && v >= HIGH_SPEED) {
        fastRun[s]!++;
        if (fastRun[s] === HIGH_SPEED_MIN_FRAMES) {
          const start = i - HIGH_SPEED_MIN_FRAMES + 1;
          runStarts[s]!.push(start);
          events.push({ index: start, kind: "run", text: "High-speed run", slot: s });
        }
      } else {
        fastRun[s] = 0;
      }
    }
    if (finite.length >= 6) {
      const q = percentile(finite, 90);
      p90[i] = q;
      deadEvidence[i] = 1 / (1 + Math.exp(-(DEAD_SPEED_MID - q) / DEAD_SPEED_WIDTH));
    }

    const est = replay.est[i];
    if (est) {
      const back = span > 0 ? replay.est[i - span] : null;
      if (back) {
        const vb = Math.hypot(est[0] - back[0], est[1] - back[1]) * (fps / span);
        if (vb <= MAX_BALL_SPEED) ballSpeed[i] = vb;
      }
      let best = -1;
      let bestD = Infinity;
      for (let s = 0; s < slots; s++) {
        const p = xy(replay, i, s);
        if (!p) continue;
        const dd = Math.hypot(p[0] - est[0], p[1] - est[1]);
        if (dd < bestD) {
          bestD = dd;
          best = s;
        }
      }
      nearest[i] = best;
      nearestDistance[i] = best >= 0 ? bestD : Number.NaN;
      const cx = Math.min(heatCols - 1, Math.max(0, Math.floor(est[0] / heatCell)));
      const cy = Math.min(heatRows - 1, Math.max(0, Math.floor(est[1] / heatCell)));
      heatBin[i] = cy * heatCols + cx;
      camera += (Math.min(L - 18, Math.max(18, est[0])) - camera) * camAlpha;
      cameraY += (Math.min(W - 10, Math.max(10, est[1])) - cameraY) * camAlpha;
    }
    camX[i] = camera;
    camY[i] = cameraY;

    const label = replay.label[i]!;
    for (let k = 0; k < 3; k++) callCount[k]![i] = (i > 0 ? callCount[k]![i - 1]! : 0) + (label === "HAD"[k] ? 1 : 0);
    const hidden = replay.ball[i] === null;
    hiddenCount[i] = (i > 0 ? hiddenCount[i - 1]! : 0) + (hidden ? 1 : 0);
    hiddenFor[i] = hidden ? (i > 0 ? hiddenFor[i - 1]! : 0) + 1 : 0;
    if (hidden && hiddenFor[i] === HIDDEN_EVENT_FRAMES) {
      events.push({ index: i - HIDDEN_EVENT_FRAMES + 1, kind: "hidden", text: "Ball lost by tracking" });
    }
    if (!hidden && i > 0 && hiddenFor[i - 1]! >= HIDDEN_EVENT_FRAMES) {
      events.push({ index: i, kind: "found", text: `Ball found again after ${(hiddenFor[i - 1]! / fps).toFixed(1)} s` });
    }
    const top = label === "X" ? 0 : Math.max(replay.pHome[i]!, replay.pAway[i]!, 100 - replay.pHome[i]! - replay.pAway[i]!);
    certainty[i] = (i > 0 ? certainty[i - 1]! : 0) + top;
    if (agree && graded && replay.truth) {
      const t = replay.truth[i];
      const g = t !== "X" ? 1 : 0;
      graded[i] = (i > 0 ? graded[i - 1]! : 0) + g;
      agree[i] = (i > 0 ? agree[i - 1]! : 0) + (g && t === label ? 1 : 0);
    }
  }

  // Changes of call, from the label runs.
  const pieces = runs(replay.label);
  for (let k = 1; k < pieces.length; k++) {
    const prev = pieces[k - 1]!.label;
    const p = pieces[k]!;
    const slot = nearest[p.start]! >= 0 ? nearest[p.start]! : undefined;
    if (p.label === "H") events.push({ index: p.start, kind: prev === "D" ? "restart" : "home", text: prev === "D" ? "Restart · Home ball" : "Home win the ball", slot });
    else if (p.label === "A") events.push({ index: p.start, kind: prev === "D" ? "restart" : "away", text: prev === "D" ? "Restart · Away ball" : "Away win the ball", slot });
    else if (p.label === "D") events.push({ index: p.start, kind: "dead", text: "Ball dead · play stopped" });
  }
  events.sort((a, b) => a.index - b.index);

  return { speed, p90, deadEvidence, ballSpeed, nearest, nearestDistance, distance, jumps, topSpeed, runStarts, callCount, hiddenCount, hiddenFor, agree, graded, certainty, heatBin, heatCols, heatRows, camX, camY, events };
}

interface TeamTotals {
  possessionShare: number;
  possessions: number;
  distanceKm: number;
  highSpeedRuns: number;
  topSpeed: number;
}

/** Team totals up to and including frame `index`. Team 0 is home. */
export function teamTotals(replay: Replay, a: Analytics, index: number): [TeamTotals, TeamTotals] {
  const i = Math.max(0, Math.min(replay.length - 1, Math.floor(index)));
  const h = a.callCount[0]![i]!;
  const aw = a.callCount[1]![i]!;
  const live = h + aw;
  const poss = [0, 0];
  for (const r of runs(replay.label.slice(0, i + 1))) {
    if (r.label === "H") poss[0]!++;
    else if (r.label === "A") poss[1]!++;
  }
  return [0, 1].map((team) => {
    let dist = 0;
    let runsCount = 0;
    let top = 0;
    replay.teams.forEach((t, s) => {
      if (t !== team) return;
      dist += a.distance[s]![i]!;
      runsCount += a.runStarts[s]!.filter((start) => start <= i).length;
      top = Math.max(top, a.topSpeed[s]![i]!);
    });
    return {
      possessionShare: live ? (team === 0 ? h : aw) / live : 0.5,
      possessions: poss[team]!,
      distanceKm: dist / 1000,
      highSpeedRuns: runsCount,
      topSpeed: top,
    };
  }) as [TeamTotals, TeamTotals];
}

/** Ball-position counts per heatmap cell, over frames 0..index. */
export function heatmap(a: Analytics, index: number): Uint16Array {
  const out = new Uint16Array(a.heatCols * a.heatRows);
  const end = Math.floor(index);
  for (let i = 0; i <= end && i < a.heatBin.length; i++) {
    const b = a.heatBin[i]!;
    if (b >= 0) out[b]!++;
  }
  return out;
}


/* ---- pitch ---- */
type CameraMode = "follow" | "wide" | "top";

/** The stage the drawing is fitted to, in SVG units. */
const STAGE_W = 1200;
const STAGE_H = 600;
const ZOOM = 2.1;

interface Camera {
  /** Pitch metres (x along the length, y across, z up) to stage units; third value is depth. */
  project: (x: number, y: number, z?: number) => [number, number, number];
  /** Stage units per metre at a ground point, for sizing things that stand on it. */
  scaleAt: (x: number, y: number) => number;
  flat: boolean;
}

/**
 * A pinhole camera on a gantry behind the near touchline with a vertical image plane: true
 * perspective (lines converge, far players are smaller) without modelling tilt. Follow cam is the
 * same camera magnified around the ball, like a broadcast zoom.
 */
function makeCamera(mode: CameraMode, pitch: [number, number]): Camera {
  const [L, W] = pitch;
  if (mode === "top") {
    const m = 30;
    const k = Math.min((STAGE_W - 2 * m) / L, (STAGE_H - 2 * m) / W);
    const ox = (STAGE_W - L * k) / 2;
    const oy = (STAGE_H - W * k) / 2;
    return { project: (x, y) => [ox + x * k, oy + y * k, 0], scaleAt: () => k, flat: true };
  }
  const d = 46; // ground distance from the camera to the near touchline, m
  const view = 112; // metres of near touchline across the stage
  const f = (STAGE_W * d) / view;
  const nearY = 585;
  const farY = 175;
  const h = (nearY - farY) / (f * (1 / d - 1 / (d + W)));
  const y0 = nearY - (h * f) / d;
  const cx = L / 2;
  const depth = (y: number) => d + (W - y);
  return {
    project: (x, y, z = 0) => {
      const zz = depth(y);
      return [STAGE_W / 2 + ((x - cx) * f) / zz, y0 + ((h - z) * f) / zz, zz];
    },
    scaleAt: (_x, y) => f / depth(y),
    flat: false,
  };
}

const pts = (list: [number, number, number][]) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

function BroadcastPitch({
  replay,
  analytics,
  view,
  mode,
  selected,
  onSelect,
}: {
  replay: Replay;
  analytics: Analytics;
  view: FrameView;
  mode: CameraMode;
  selected: number;
  onSelect: (slot: number) => void;
}) {
  const [L, W] = replay.pitch;
  const cam = makeCamera(mode, replay.pitch);
  const P = cam.project;
  let zoom = "";
  // Labels keep roughly the same on-screen size whatever the zoom.
  const uiScale = mode === "follow" ? 0.62 : 1;
  if (mode === "follow") {
    const n1 = Math.min(analytics.camX.length - 1, view.index + 1);
    const [tx, ty] = P(lerp(analytics.camX[view.index]!, analytics.camX[n1]!, view.frac), lerp(analytics.camY[view.index]!, analytics.camY[n1]!, view.frac));
    const ox = STAGE_W / 2 - ZOOM * tx;
    const floor = STAGE_H - ZOOM * P(L / 2, W + 5)[1]; // keep the near apron at the bottom edge
    const ceiling = -ZOOM * (P(L / 2, -4, 0.9)[1] - 36); // and no more than a strip of stand above the far boards
    const oy = Math.max(floor, Math.min(ceiling, STAGE_H * 0.56 - ZOOM * ty));
    zoom = `translate(${ox.toFixed(1)} ${oy.toFixed(1)}) scale(${ZOOM})`;
  }

  // Static drawing: grass, lines, goals. Depends only on the camera.
  const statics = useMemo(() => {
    const line = (a: [number, number], b: [number, number], steps = 1) => {
      const out: [number, number, number][] = [];
      for (let k = 0; k <= steps; k++) out.push(P(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps));
      return out;
    };
    const rect = (x: number, y: number, w: number, hh: number) => [...line([x, y], [x + w, y]), ...line([x + w, y + hh], [x, y + hh])];
    const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 48) =>
      Array.from({ length: n + 1 }, (_, k) => {
        const t = a0 + ((a1 - a0) * k) / n;
        return P(cx + r * Math.cos(t), cy + r * Math.sin(t));
      });
    const stripes: string[] = [];
    const bands = 18;
    for (let k = 0; k < bands; k += 2) {
      const x0 = (L / bands) * k;
      const x1 = (L / bands) * (k + 1);
      stripes.push(pts([P(x0, -3), P(x1, -3), P(x1, W + 3), P(x0, W + 3)]));
    }
    const lines: string[] = [pts(rect(0, 0, L, W)), pts(line([L / 2, 0], [L / 2, W])), pts(arc(L / 2, W / 2, 9.15, 0, Math.PI * 2, 64))];
    for (const side of [0, 1]) {
      const x = (depth: number) => (side ? L - depth : 0);
      lines.push(pts(rect(x(16.5), (W - 40.3) / 2, 16.5, 40.3)));
      lines.push(pts(rect(x(5.5), (W - 18.32) / 2, 5.5, 18.32)));
      const spot = side ? L - 11 : 11;
      const a = Math.acos(5.5 / 9.15);
      lines.push(pts(side ? arc(spot, W / 2, 9.15, Math.PI - a, Math.PI + a, 20) : arc(spot, W / 2, 9.15, -a, a, 20)));
    }
    const goals = [0, 1].map((side) => {
      const gx = side ? L : 0;
      const back = side ? L + 2 : -2;
      const y1 = W / 2 - 3.66;
      const y2 = W / 2 + 3.66;
      return {
        frame: pts([P(gx, y1), P(gx, y1, 2.44), P(gx, y2, 2.44), P(gx, y2)]),
        net: pts([P(gx, y1, 2.44), P(back, y1, 1.6), P(back, y2, 1.6), P(gx, y2, 2.44), P(gx, y2), P(back, y2), P(back, y1), P(gx, y1)]),
      };
    });
    const apron = pts([P(-6, -4), P(L + 6, -4), P(L + 6, W + 6), P(-6, W + 6)]);
    // Far boards stand on y = -4 and face the camera, so they are an upright band.
    const [bx0, by0] = P(-6, -4, 0.9);
    const [bx1, by1] = P(L + 6, -4, 0);
    return { stripes, lines, goals, apron, boards: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 } };
    // P depends only on the camera, which mode determines.
  }, [mode, L, W]);

  const i = view.index;
  const trailFrames = Math.round(2 * replay.fps);
  const trailStep = Math.max(1, Math.round(replay.fps / 5));
  const playerTrails = view.players.map((p) => {
    const path: [number, number, number][] = [];
    for (let k = Math.max(0, i - trailFrames); k <= i; k += trailStep) {
      const row = replay.players[k]!;
      const x = row[p.slot * 2];
      const y = row[p.slot * 2 + 1];
      if (x != null && y != null) path.push(P(x, y));
    }
    path.push(P(p.x, p.y));
    return { slot: p.slot, team: p.team, d: pts(path) };
  });
  const ballPath: [number, number, number][] = [];
  for (let k = Math.max(0, i - Math.round(1.5 * replay.fps)); k <= i; k++) {
    const e = replay.est[k];
    if (e) ballPath.push(P(e[0], e[1]));
  }
  if (view.est) ballPath.push(P(view.est.x, view.est.y));
  const near = analytics.nearest[i]!;
  const onBall = near >= 0 && analytics.nearestDistance[i]! < CONTROL_RADIUS ? near : -1;

  const sigma = view.est?.sigma ?? null;
  const ring =
    view.est && sigma !== null && sigma < 30
      ? pts(Array.from({ length: 33 }, (_, k) => P(view.est!.x + Math.max(sigma, 0.5) * Math.cos((k / 32) * Math.PI * 2), view.est!.y + Math.max(sigma, 0.5) * Math.sin((k / 32) * Math.PI * 2))))
      : null;
  const players = [...view.players].sort((a, b) => P(b.x, b.y)[2] - P(a.x, a.y)[2]);

  return (
    <svg
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      className={s.stageSvg}
      role="img"
      aria-label={`Pitch, ${mode === "top" ? "seen from above" : "broadcast camera"}. ${view.players.length} players tracked. ${view.ball ? "Ball seen." : view.est ? "Ball hidden, estimated." : "No ball estimate."}`}
      data-mode={mode}
    >
      <rect width={STAGE_W} height={STAGE_H} className={cam.flat ? s.fieldFlat : s.sky} />
      <g transform={zoom}>
        <polygon points={statics.apron} className={s.field} />
        {statics.stripes.map((p, k) => (
          <polygon key={k} points={p} className={s.stripe} />
        ))}
        {!cam.flat && (
          <g className={s.boards}>
            <rect x={statics.boards.x} y={statics.boards.y} width={statics.boards.w} height={statics.boards.h} />
            <text x={STAGE_W / 2} y={statics.boards.y + statics.boards.h * 0.7} fontSize={Math.max(6, statics.boards.h * 0.55)} textAnchor="middle">
              {"BARÇA LAB  ·  MORE THAN A HACK 2027  ·  WHO HAS THE BALL, FRAME BY FRAME  ·  BARÇA LAB  ·  MORE THAN A HACK 2027  ·  WHO HAS THE BALL, FRAME BY FRAME"}
            </text>
          </g>
        )}
        <g className={s.lines}>
          {statics.lines.map((p, k) => (
            <polyline key={k} points={p} />
          ))}
        </g>
        {!cam.flat &&
          statics.goals.map((g, k) => (
            <g key={k} className={s.goal}>
              <polyline points={g.net} className={s.net} />
              <polyline points={g.frame} />
            </g>
          ))}

        <g className={s.trails}>
          {playerTrails.map((t) => (
            <polyline key={t.slot} points={t.d} data-team={t.team} data-selected={t.slot === selected} />
          ))}
        </g>

        {ring && <polygon points={ring} className={s.ring} data-hidden={!view.ball} />}
        {ballPath.length > 1 && <polyline points={pts(ballPath)} className={s.ballTrail} />}

        {players.map((p) => {
          const [fx, fy] = P(p.x, p.y);
          const k = cam.scaleAt(p.x, p.y);
          const isSel = p.slot === selected;
          const isOn = p.slot === onBall;
          const common = { className: s.player, "data-team": p.team, "data-selected": isSel, "data-onball": isOn, onClick: () => onSelect(p.slot) };
          if (cam.flat) {
            const r = Math.max(12, k * 1.5);
            return (
              <g key={p.slot} {...common}>
                {(isSel || isOn) && <circle cx={fx} cy={fy} r={r + 5} className={s.halo} />}
                <circle cx={fx} cy={fy} r={r} className={s.dot} />
                <text x={fx} y={fy + 4} textAnchor="middle" className={s.dotNum}>
                  {slotNumber(replay, p.slot)}
                </text>
                <title>{slotName(replay, p.slot)}</title>
              </g>
            );
          }
          const h = Math.max(12, 1.9 * k);
          const w = h * 0.46;
          const top = fy - h;
          return (
            <g key={p.slot} {...common}>
              <ellipse cx={fx} cy={fy} rx={w * 0.55} ry={w * 0.17} className={s.shadow} />
              {/* A drawn figure, not a captured one: tracking has positions only. */}
              <path d={`M${fx - w * 0.16},${fy} L${fx - w * 0.05},${fy - h * 0.45} L${fx + w * 0.05},${fy - h * 0.45} L${fx + w * 0.18},${fy}`} className={s.legs} />
              <rect x={fx - w * 0.24} y={fy - h * 0.82} width={w * 0.48} height={h * 0.4} rx={w * 0.12} className={s.body} />
              <circle cx={fx} cy={top + h * 0.09} r={h * 0.085} className={s.head} />
              <rect x={fx - w / 2 - 2} y={top - 3} width={w + 4} height={h + 5} rx={2} className={s.bbox} />
              <g className={s.tag} transform={`translate(${fx}, ${top - 3}) scale(${uiScale})`}>
                <rect x={-14} y={-15} width={28} height={13} rx={2} />
                <text y={-5.5} textAnchor="middle">
                  #{slotNumber(replay, p.slot)}
                </text>
              </g>
              <title>{slotName(replay, p.slot)}</title>
            </g>
          );
        })}

        {view.est &&
          (() => {
            const [x, y] = P(view.est.x, view.est.y);
            return <circle cx={x} cy={y} r={Math.max(3, cam.scaleAt(view.est.x, view.est.y) * 0.45)} className={s.estBall} />;
          })()}
        {view.ball &&
          (() => {
            const [x, y] = P(view.ball[0], view.ball[1]);
            const r = Math.max(3.2, cam.scaleAt(view.ball[0], view.ball[1]) * 0.42);
            return (
              <g className={s.seenBall}>
                <rect x={x - r - 4} y={y - r - 4} width={2 * r + 8} height={2 * r + 8} rx={2} />
                <circle cx={x} cy={y} r={r} />
              </g>
            );
          })()}
      </g>
    </svg>
  );
}

/* ---- page ---- */
const SPEEDS = [0.5, 1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];
const CALL_TEXT: Record<ReplayCall, string> = { H: "Home ball", A: "Away ball", D: "Dead ball", X: "Not in play" };
const CAMERAS: { value: CameraMode; label: string }[] = [
  { value: "follow", label: "Follow cam" },
  { value: "wide", label: "Wide" },
  { value: "top", label: "Tactical" },
];

/** The Match console page: the live estimator played back on a simulated match. */
export function ConsolePage() {
  const builtIn = useMemo(decodeReplay, []);
  const [custom, setCustom] = useState<{ replay: Replay; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    // Read in this tab only: the file is never stored or uploaded.
    const parsed = parseReplay(await file.text());
    if (!parsed.ok) {
      setError(`${file.name}: ${parsed.error}`);
      return;
    }
    setError(null);
    setCustom({ replay: parsed.replay, name: file.name });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const picker = (
    <section className={`card ${s.card} ${s.picker}`} aria-labelledby="mc-own">
      <div className="chart-heading">
        <h3 id="mc-own">Watch your own replay</h3>
        <span className={s.tag}>stays in your browser</span>
      </div>
      <p className={s.pickerText}>
        Run our estimator and load the file it writes. It is read in this tab and never uploaded, so a replay of real tracking stays on your machine.
      </p>
      <pre className={s.command}>python3 starter/live_estimator.py --synthetic --replay my_replay.json</pre>
      <div className={s.pickerActions}>
        <label className="button button-secondary">
          <input type="file" accept=".json,application/json" onChange={onPick} className={s.sr} />
          <Glyph name="Upload" size={16} /> Choose a replay file
        </label>
        {custom && (
          <button type="button" className="text-link" onClick={() => setCustom(null)}>
            Back to the built-in match
          </button>
        )}
      </div>
      {custom && <p className={s.note}>Showing {custom.name}.</p>}
      {error && (
        <p className={s.pickError} role="alert">
          {error}
        </p>
      )}
    </section>
  );

  return (
    <main id="main-content" className="page">
      <style>{CONSOLE_CSS}</style>
      <Console key={custom?.name ?? "built-in"} replay={custom?.replay ?? builtIn} extra={picker} />
    </main>
  );
}

function Console({ replay, extra }: { replay: Replay; extra?: ReactNode }) {
  const analytics = useMemo(() => analyse(replay), [replay]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [camera, setCamera] = useState<CameraMode>("follow");
  const [picked, setPicked] = useState<number | null>(null);
  const changes = useMemo(() => changesOf(replay.label), [replay]);
  const last = replay.length - 1;
  const view = frameAt(replay, index);
  const i = view.index;
  // With nobody picked, follow whoever is nearest the ball.
  const selected = picked ?? (analytics.nearest[i]! >= 0 ? analytics.nearest[i]! : 0);

  const indexRef = useRef(index);
  indexRef.current = index;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const next = Math.min(last, indexRef.current + ((now - previous) / 1000) * replay.fps * speed);
      previous = now;
      setIndex(next);
      if (next >= last) return setPlaying(false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, last, replay.fps]);

  const seek = useCallback((to: number) => setIndex(Math.max(0, Math.min(last, Math.round(to)))), [last]);
  const jump = (to: number) => {
    setPlaying(false);
    seek(to);
  };
  // The Transitions page opens on the latest change at or before the playhead.
  let nearChange = 0;
  for (let k = 0; k < changes.length && changes[k]!.at <= Math.floor(index); k++) nearChange = k;
  const toggle = () => {
    if (!playing && index >= last) setIndex(0);
    setPlaying((p) => !p);
  };
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "SELECT" || (target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range")) return;
    const step = event.shiftKey ? replay.fps : 1;
    if (event.key === " " && target.tagName !== "BUTTON") {
      event.preventDefault();
      toggle();
    } else if (event.key === "ArrowRight" && target.tagName !== "INPUT") {
      event.preventDefault();
      jump(index + step);
    } else if (event.key === "ArrowLeft" && target.tagName !== "INPUT") {
      event.preventDefault();
      jump(index - step);
    }
  };

  const totals = teamTotals(replay, analytics, i);
  const matchSeconds = (replay.firstFrame + i) / replay.fps;
  const homeShare = Math.round(totals[0].possessionShare * 100);
  const synthetic = replay.provenance === "synthetic";

  return (
    <div className={`container ${s.root}`} onKeyDown={onKey} tabIndex={-1}>
      <header className="page-header">
        <div>
          <div className="title-badge">
            <p className="kicker">Console</p>
            {synthetic ? (
              <span className="badge badge-demo" data-tooltip="Invented by starter/synthetic_match.py, so the true answer is known. Not real match data.">
                Synthetic
              </span>
            ) : (
              <span className="badge badge-published" data-tooltip="Written on this machine by live_estimator.py --replay. No ground truth travels with it.">
                Local run
              </span>
            )}
          </div>
          <h1>
            Home <span className="muted">vs</span> Away
          </h1>
          {synthetic ? (
            <p>
              A simulated match played through our possession estimator: where it thinks the ball is, how sure it is, and who it calls in possession, frame by frame.
              This page shows it in fixed-lag mode, answering one second after each frame the way a live system with a short delay would. The submission works
              offline, with a whole half of hindsight. The simulator knows the true answer, so you can see when the estimator is wrong.
            </p>
          ) : (
            <p>
              A replay from a local run of our live possession estimator: where it thinks the ball is, how sure it is, and who it calls in possession, frame by frame. It is
              unscored: score whole matches with the official evaluator.
            </p>
          )}
        </div>
      </header>

      <div className={`toolbar ${s.toolbar}`}>
        <div className="segmented" role="group" aria-label="Camera">
          {CAMERAS.map((c) => (
            <button key={c.value} type="button" aria-pressed={camera === c.value} onClick={() => setCamera(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="toolbar-selects">
          <span className={`live-state live-state-${view.label === "X" ? "D" : view.label}`} aria-live="off">
            {CALL_TEXT[view.label]}
          </span>
          <span className={s.matchClock}>
            <small>{playing ? "Playing" : "Match clock"}</small>
            {formatClock(matchSeconds)}
          </span>
          <label className="select-label">
            Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value) as Speed)}>
              {SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="match-layout">
        <div className="match-main">
          <section className="card timeline-card" aria-label="Possession over the replay">
            <div className="strip-legend">
              <span><i className="legend-home" />Home</span>
              <span><i className="legend-away" />Away</span>
              <span><i className="legend-dead" />Dead ball</span>
            </div>
            <Strip title="Estimate" labels={replay.label} index={index} onSeek={jump} />
            {replay.truth && <Strip title="Simulator truth" labels={replay.truth} index={index} onSeek={jump} compact />}
            <div className={s.axis} aria-hidden="true">
              {[0, 0.25, 0.5, 0.75, 1].map((t) => (
                <span key={t}>{formatClock((replay.firstFrame + t * replay.length) / replay.fps)}</span>
              ))}
            </div>
          </section>

          <section className="card replay-card" aria-label="Pitch replay">
            <div className={s.stage}>
              <BroadcastPitch replay={replay} analytics={analytics} view={view} mode={camera} selected={selected} onSelect={(slot) => setPicked((p) => (p === slot ? null : slot))} />
              <span className={`${s.overlay} ${s.overlayTL}`}>
                <i className={s.onDot} /> Fixed-lag estimate · answers {(replay.lag / replay.fps).toFixed(1)} s late
              </span>
              <span className={`${s.overlay} ${s.overlayBL}`}>
                Pitch {replay.pitch[0].toFixed(1)} × {replay.pitch[1].toFixed(1)} m
              </span>
              <span className={`${s.overlay} ${s.overlayBR}`}>
                frame {view.frame} · {view.players.length}/{replay.teams.length} tracks
              </span>
            </div>
            <div className={`chart-legend ${s.pitchLegend}`}>
              <span><i className="legend-home" />Home</span>
              <span><i className="legend-away" />Away</span>
              <span><i className={s.kBall} />Ball, seen</span>
              <span><i className={s.kEst} />Ball, estimated ± σ</span>
              <span><i className={s.kTrail} />Player trail · 2 s</span>
              <span><i className={s.kPath} />Ball path · 1.5 s</span>
              <span><i className={s.kOnBall} />On the ball (&lt; {CONTROL_RADIUS} m)</span>
              <span><i className={s.kSel} />Followed player</span>
            </div>
            <div className={s.controls}>
              <button type="button" className="play-button" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
                <Glyph name={playing ? "Pause" : "Play"} size={18} />
              </button>
              <div className={s.stepButtons}>
                <IconButton label="Back to start" onClick={() => jump(0)}><Glyph name="Rewind" /></IconButton>
                <IconButton label="Back one second" onClick={() => jump(index - replay.fps)}><Glyph name="SkipBack" /></IconButton>
                <IconButton label="Forward one second" onClick={() => jump(index + replay.fps)}><Glyph name="SkipForward" /></IconButton>
              </div>
              <p className="timecode">
                {formatClock(view.seconds)} <span className="muted">/ {formatClock(replay.length / replay.fps)}</span>
              </p>
              <input
                type="range"
                min={0}
                max={last}
                value={Math.floor(index)}
                onChange={(e) => jump(Number(e.target.value))}
                aria-label="Position in replay"
                aria-valuetext={`${formatClock(view.seconds)} of ${formatClock(replay.length / replay.fps)}`}
              />
            </div>
            <p className="keys-hint">
              <span>Space</span>play or pause <span>← →</span>one frame <span>Shift</span>one second <span>Click a player</span>follow them
            </p>
          </section>
        </div>

        <aside className={s.sideLayers} aria-label="What the estimator sees">
          <BallLayer replay={replay} a={analytics} view={view} />
          <PlayerLayer replay={replay} a={analytics} slot={selected} index={i} pinned={picked !== null} onClear={() => setPicked(null)} />
        </aside>
      </div>

      <section className={s.section} aria-labelledby="mc-sofar">
        <div className="section-header">
          <p className="kicker">Match</p>
          <h2 id="mc-sofar">The match so far</h2>
        </div>
        <div className={s.soFar}>
          <section className={`stat-tile ${s.tile}`}>
            <p className="kicker">Possession share</p>
            <div className="share-values">
              <span>
                {homeShare}%<small>Home</small>
              </span>
              <span>
                {100 - homeShare}%<small>Away</small>
              </span>
            </div>
            <div className="split-bar" aria-hidden="true">
              <span style={{ width: `${homeShare}%` }} />
            </div>
            <p className="stat-note">Share of live-ball time so far, from the estimator's calls.</p>
          </section>
          <TeamPanel totals={totals} />
          <EventsPanel replay={replay} events={analytics.events} index={i} onSeek={jump} />
        </div>
      </section>

      <section className={s.section} aria-labelledby="mc-inspector">
        <div className={`card ${s.teaser}`}>
          <div>
            <p className="kicker">Transitions</p>
            <h2 id="mc-inspector">Inspect every change of possession</h2>
            <p>
              The estimate changes its call {changes.length} times in this match. The Transitions page replays each one in slow motion, with who had the ball before and
              after, an inferred cause, the model's probabilities and the simulator's verdict.
            </p>
          </div>
          {changes.length > 0 && (
            <a
              className="button button-primary"
              href={`/transitions?at=${changes[nearChange]!.at}`}
              onClick={(e) => {
                e.preventDefault();
                go(`/transitions?at=${changes[nearChange]!.at}`);
              }}
            >
              Open Transitions <Glyph name="Arrow" size={16} />
            </a>
          )}
        </div>
      </section>

      <section className={s.section} aria-labelledby="mc-layers">
        <div className="section-header">
          <p className="kicker">Pipeline</p>
          <h2 id="mc-layers">How it decides who has the ball</h2>
        </div>
        <div className={`${s.layers} ${s.layersTwo}`}>
          <DeadBallLayer a={analytics} view={view} />
          <PossessionLayer replay={replay} view={view} />
        </div>
      </section>

      <section className={s.section} aria-labelledby="mc-charts">
        <div className="section-header">
          <p className="kicker">Signals</p>
          <h2 id="mc-charts">How the evidence moves</h2>
        </div>
        <div className={s.charts}>
          <SpeedPanel replay={replay} a={analytics} slot={selected} index={i} />
          <HeatPanel replay={replay} a={analytics} index={i} />
          <ConfidencePanel replay={replay} a={analytics} view={view} />
          <MomentumPanel replay={replay} index={i} onSeek={jump} />
        </div>
      </section>

      <section className={s.section} aria-labelledby="mc-data">
        <div className="section-header">
          <p className="kicker">Data</p>
          <h2 id="mc-data">One frame, as the estimator writes it</h2>
        </div>
        <div className={s.dataGrid}>
          <FeedPanel replay={replay} a={analytics} view={view} />
          <div className={s.side}>
          <div className="callout">
            <h3>Reading this page</h3>
            <ul>
              {synthetic ? (
                <li>The match is invented by our simulator, with goalkeepers in slots 0 and 11, so the true possession is known and shown as a second strip.</li>
              ) : (
                <li>This replay comes from a local run, so there is no truth strip and nothing here is a score.</li>
              )}
              <li>Tracking has positions only. There are no pose, shot or xG numbers here, and the figures on the pitch are drawn, not captured.</li>
              <li>Tracking slots are tracklets, so the numbers on players are slot numbers, not shirt numbers.</li>
              <li>The stoppage detector uses 0.2 s speeds, like the estimator. Speeds shown for players are over 1 s, which hides tracking jitter.</li>
              <li>
                The same model can answer in three ways. <b>Offline</b>, with the whole half of hindsight, is the submission: spellF1 0.46 on two open Metrica
                matches and 0.71 on simulated ones. <b>Fixed lag</b>, {(replay.lag / replay.fps).toFixed(1)} s late, is this page: 0.25 and 0.59, because a second of
                hindsight still lets a short burst of evidence flip the call. <b>Zero latency</b>, with no hindsight, scores 0.30 and 0.39. Our validation report has
                the details.
              </li>
            </ul>
          </div>
          {extra}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

const GLYPHS: Record<string, string> = {
  Play: "M7 4.5v15l12-7.5z",
  Pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z",
  Rewind: "M11 6 4 12l7 6zM20 6l-7 6 7 6z",
  SkipBack: "M18 6 9 12l9 6zM6 6h2v12H6z",
  SkipForward: "M6 6l9 6-9 6zM16 6h2v12h-2z",
  Upload: "M11 16V7.8L8.4 10.4 7 9l5-5 5 5-1.4 1.4L13 7.8V16zM5 20v-5h2v3h10v-3h2v5z",
  Arrow: "M4 11h12.2l-4.6-4.6L13 5l7 7-7 7-1.4-1.4 4.6-4.6H4z",
};

function Glyph({ name, size = 15 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d={GLYPHS[name]} />
    </svg>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={s.iconBtn} onClick={onClick} aria-label={label} data-tooltip={label}>
      {children}
    </button>
  );
}

function Strip({ title, labels, index, onSeek, compact = false }: { title: string; labels: string; index: number; onSeek: (to: number) => void; compact?: boolean }) {
  const pieces = useMemo(() => runs(labels), [labels]);
  const n = labels.length;
  return (
    <div className={s.stripRow}>
      <span className={s.stripTitle}>{title}</span>
      <div
        className={`${s.strip} ${compact ? s.stripCompact : ""}`}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - box.left) / box.width) * n);
        }}
        role="img"
        aria-label={`${title}: ${pieces.filter((p) => p.label === "H" || p.label === "A").length} possessions. Click to jump.`}
      >
        {pieces.map((p) =>
          p.label === "X" ? null : <span key={p.start} className={`state-${p.label}`} style={{ left: `${(p.start / n) * 100}%`, width: `${((p.stop - p.start) / n) * 100}%` }} />,
        )}
        <i className="strip-playhead" style={{ left: `${(index / n) * 100}%` }} />
      </div>
    </div>
  );
}

function Card({ title, tag, children, className }: { title: string; tag?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card chart-card ${s.card} ${className ?? ""}`}>
      <div className="chart-heading">
        <h3>{title}</h3>
        {tag && <span className={s.tag}>{tag}</span>}
      </div>
      {children}
    </section>
  );
}

function Layer({ n, title, sub, children, aside }: { n: number; title: string; sub: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`card ${s.layer}`}>
      <div className={s.layerHead}>
        <span className="step-number">0{n}</span>
        {aside}
      </div>
      <h3>{title}</h3>
      <p className={s.layerSub}>{sub}</p>
      {children}
    </section>
  );
}

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className={s.rows}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A polyline of the last `window` frames of a series, with an optional threshold line. */
function Spark({ values, index, window, max, color, threshold, caption }: { values: ArrayLike<number>; index: number; window: number; max: number; color: string; threshold?: number; caption: ReactNode }) {
  const w = 240;
  const height = 44;
  const start = Math.max(0, index - window);
  const out: string[] = [];
  for (let k = start; k <= index; k += 2) {
    const v = values[k]!;
    if (Number.isFinite(v)) out.push(`${(((k - start) / window) * w).toFixed(1)},${(height - (Math.min(v, max) / max) * (height - 2) - 1).toFixed(1)}`);
  }
  const ty = threshold !== undefined ? height - (threshold / max) * (height - 2) - 1 : 0;
  return (
    <figure className={s.sparkWrap}>
      <svg viewBox={`0 0 ${w} ${height}`} className={s.spark} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2={w} y1={height - 0.5} y2={height - 0.5} className={s.baseline} />
        {threshold !== undefined && <line x1="0" x2={w} y1={ty} y2={ty} className={s.threshold} />}
        <polyline points={out.join(" ")} style={{ stroke: color }} />
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function BallLayer({ replay, a, view }: { replay: Replay; a: Analytics; view: FrameView }) {
  const i = view.index;
  const sigmas = useMemo(() => Float32Array.from(replay.est, (e) => (e && e[2] !== null ? e[2] : Number.NaN)), [replay]);
  return (
    <Layer n={1} title="Ball tracking" sub="Kalman filter on the ball" aside={<span className={`badge ${view.ball ? "badge-measured" : "badge-demo"}`}>{view.ball ? "Seen" : "Hidden"}</span>}>
      <Rows
        rows={[
          ["Uncertainty σ", view.est?.sigma != null ? `${view.est.sigma.toFixed(2)} m` : "—"],
          ["Hidden for", view.ball ? "—" : `${(a.hiddenFor[i]! / replay.fps).toFixed(1)} s`],
          ["Ball speed", Number.isFinite(a.ballSpeed[i]!) ? `${kmh(a.ballSpeed[i]!).toFixed(1)} km/h` : "—"],
          ["Hidden so far", `${Math.round((a.hiddenCount[i]! / (i + 1)) * 100)}% of frames`],
        ]}
      />
      <Spark values={sigmas} index={i} window={replay.fps * 20} max={6} color="var(--amber)" caption="σ over the last 20 s, 0–6 m" />
    </Layer>
  );
}

function PlayerLayer({ replay, a, slot, index, pinned, onClear }: { replay: Replay; a: Analytics; slot: number; index: number; pinned: boolean; onClear: () => void }) {
  const v = a.speed[slot]![index]!;
  const runsSoFar = a.runStarts[slot]!.filter((st) => st <= index).length;
  const team = replay.teams[slot]!;
  return (
    <Layer n={2} title="Player kinematics" sub={pinned ? "The player you picked" : "Whoever is nearest the ball"}>
      <div className={s.playerCard}>
        <span className={`${s.badgeNum} ${team === 0 ? "home-bg" : "away-bg"}`}>#{slotNumber(replay, slot)}</span>
        <span>
          <strong>{slotName(replay, slot)}</strong>
          <small>tracking slot {slot}</small>
        </span>
        <span className={s.bigStat}>
          {Number.isFinite(v) ? kmh(v).toFixed(1) : "—"}
          <small>km/h</small>
        </span>
      </div>
      <Rows
        rows={[
          ["Top speed so far", `${kmh(a.topSpeed[slot]![index]!).toFixed(1)} km/h`],
          ["Distance so far", `${Math.round(a.distance[slot]![index]!)} m`],
          [`Runs ≥ ${kmh(HIGH_SPEED).toFixed(1)} km/h`, runsSoFar],
          ["Distance to ball", Number.isFinite(a.nearestDistance[index]!) && a.nearest[index] === slot ? `${a.nearestDistance[index]!.toFixed(1)} m` : "—"],
          ...(a.jumps[slot]! > 0 ? ([["Tracking jumps ignored", a.jumps[slot]!]] as [string, ReactNode][]) : []),
        ]}
      />
      <Spark
        values={a.speed[slot]!}
        index={index}
        window={replay.fps * 20}
        max={9}
        color={team === 0 ? "var(--home)" : "var(--away)"}
        threshold={HIGH_SPEED}
        caption={
          <>
            Speed, last 20 s · dashed: high-speed line
            {pinned && (
              <button type="button" className={s.linkBtn} onClick={onClear}>
                Follow the ball again
              </button>
            )}
          </>
        }
      />
    </Layer>
  );
}

function DeadBallLayer({ a, view }: { a: Analytics; view: FrameView }) {
  const i = view.index;
  const p90 = a.p90[i]!;
  const ev = a.deadEvidence[i]!;
  const max = 9;
  return (
    <Layer n={3} title="Stoppage detector" sub="Speed of the fastest tenth of players">
      <div className={s.gauge}>
        <div className={s.gaugeTrack}>
          <span className={`state-D ${s.gaugeZone}`} style={{ width: `${(DEAD_SPEED_MID / max) * 100}%` }} />
          {Number.isFinite(p90) && <span className={s.gaugeFill} style={{ width: `${(Math.min(p90, max) / max) * 100}%` }} />}
        </div>
        <div className={s.gaugeScale}>
          <span>0</span>
          <span style={{ left: `${(DEAD_SPEED_MID / max) * 100}%` }}>{kmh(DEAD_SPEED_MID).toFixed(1)}</span>
          <span>{kmh(max).toFixed(0)} km/h</span>
        </div>
      </div>
      <Rows
        rows={[
          ["Fastest tenth", Number.isFinite(p90) ? `${kmh(p90).toFixed(1)} km/h` : "—"],
          ["Stoppage evidence", Number.isFinite(ev) ? `${(ev * 100).toFixed(0)}%` : "—"],
          ["p(dead) from the model", `${view.pDead}%`],
        ]}
      />
      <p className={s.note}>When even the quickest players slow below {kmh(DEAD_SPEED_MID).toFixed(1)} km/h, play has usually stopped.</p>
    </Layer>
  );
}

function PossessionLayer({ replay, view }: { replay: Replay; view: FrameView }) {
  const bars = [
    { k: "H", label: "Home", v: view.pHome },
    { k: "A", label: "Away", v: view.pAway },
    { k: "D", label: "Dead", v: view.pDead },
  ];
  return (
    <Layer n={4} title="Possession model" sub="Sticky hidden Markov model over H / A / D">
      <div className={s.posterior}>
        {bars.map((b) => (
          <div key={b.k}>
            <span>{b.label}</span>
            <span className={s.barTrack}>
              <span className={`state-${b.k} no-hatch`} style={{ width: `${b.v}%` }} />
            </span>
            <b>{b.v}%</b>
          </div>
        ))}
      </div>
      <Rows
        rows={[
          ["Call", <span className={`live-state live-state-${view.label === "X" ? "D" : view.label}`}>{CALL_TEXT[view.label]}</span>],
          ["Answered after", `${(replay.lag / replay.fps).toFixed(1)} s`],
          ...(view.truth
            ? ([["Simulator truth", <span className={s.truth} data-agree={view.truth === view.label}>{CALL_TEXT[view.truth]} {view.truth === view.label ? "✓" : "✗"}</span>]] as [string, ReactNode][])
            : []),
        ]}
      />
    </Layer>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function SpeedPanel({ replay, a, slot, index }: { replay: Replay; a: Analytics; slot: number; index: number }) {
  const w = 520;
  const h = 300;
  const window = replay.fps * 20;
  const start = Math.max(0, index - window);
  const max = 10; // m/s
  const series = [
    { key: "p90", label: "Fastest tenth", values: a.p90, color: "var(--green)" },
    { key: "sel", label: `#${slotNumber(replay, slot)} ${replay.teams[slot] === 0 ? "home" : "away"}`, values: a.speed[slot]!, color: replay.teams[slot] === 0 ? "var(--home)" : "var(--away)" },
  ];
  const y = (v: number) => h - 18 - (Math.min(v, max) / max) * (h - 26);
  const x = (k: number) => 28 + ((k - start) / window) * (w - 32);
  return (
    <Card title="Speed tracking" tag="km/h · last 20 s">
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {[0, 10, 20, 30].map((t) => (
          <g key={t}>
            <line x1={28} x2={w - 4} y1={y(t / 3.6)} y2={y(t / 3.6)} />
            <text x={22} y={y(t / 3.6) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        <line x1={28} x2={w - 4} y1={y(DEAD_SPEED_MID)} y2={y(DEAD_SPEED_MID)} className="threshold" />
        {series.map((se) => {
          const out: string[] = [];
          for (let k = start; k <= index; k += 2) {
            const v = se.values[k]!;
            if (Number.isFinite(v)) out.push(`${x(k).toFixed(1)},${y(v).toFixed(1)}`);
          }
          return <polyline key={se.key} points={out.join(" ")} className={s.series} style={{ stroke: se.color }} />;
        })}
        <text x={28} y={h - 2}>−20 s</text>
        <text x={w - 4} y={h - 2} textAnchor="end">now</text>
      </svg>
      <div className="chart-legend">
        {series.map((se) => (
          <span key={se.key}><i style={{ background: se.color }} />{se.label}</span>
        ))}
        <span><i className={s.kDash} />Stoppage line, {kmh(DEAD_SPEED_MID).toFixed(1)} km/h</span>
      </div>
    </Card>
  );
}

function HeatPanel({ replay, a, index }: { replay: Replay; a: Analytics; index: number }) {
  const counts = heatmap(a, index);
  const max = Math.max(1, ...counts);
  const [L, W] = replay.pitch;
  const cw = L / a.heatCols;
  const ch = W / a.heatRows;
  let thirds = [0, 0, 0];
  counts.forEach((c, b) => {
    const col = b % a.heatCols;
    const t = Math.min(2, Math.floor(((col + 0.5) * cw) / (L / 3)));
    thirds[t]! += c;
  });
  const total = thirds.reduce((p, c) => p + c, 0) || 1;
  thirds = thirds.map((t) => t / total);
  return (
    <Card title="Ball heatmap" tag="estimated ball, so far">
      <svg viewBox={`-1 -1 ${L + 2} ${W + 2}`} className={s.heat} aria-hidden="true">
        <rect x={0} y={0} width={L} height={W} className="pitch-field" />
        {Array.from(counts, (c, b) => {
          if (!c) return null;
          const t = Math.sqrt(c / max);
          return <rect key={b} x={(b % a.heatCols) * cw} y={Math.floor(b / a.heatCols) * ch} width={cw + 0.05} height={ch + 0.05} className={s.heatCell} style={{ opacity: 0.12 + t * 0.88 }} />;
        })}
        <g className={s.heatLines}>
          <rect x={0} y={0} width={L} height={W} />
          <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
          <circle cx={L / 2} cy={W / 2} r={9.15} />
          <rect x={0} y={(W - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={L - 16.5} y={(W - 40.3) / 2} width={16.5} height={40.3} />
        </g>
      </svg>
      <div className={s.thirds}>
        {["Left third", "Middle", "Right third"].map((t, k) => (
          <span key={t}>
            {t} <b>{Math.round(thirds[k]! * 100)}%</b>
          </span>
        ))}
      </div>
    </Card>
  );
}

function ConfidencePanel({ replay, a, view }: { replay: Replay; a: Analytics; view: FrameView }) {
  const i = view.index;
  const top = view.label === "X" ? 0 : Math.max(view.pHome, view.pAway, view.pDead);
  const mean = a.certainty[i]! / (i + 1);
  const agreement = a.agree && a.graded && a.graded[i]! > 0 ? a.agree[i]! / a.graded[i]! : null;
  const nd = a.nearestDistance[i]!;
  const checks: [string, boolean, string][] = [
    ["Ball seen by tracking", !!view.ball, view.ball ? "yes" : "no"],
    ["Ball estimate tight (σ < 2 m)", view.est?.sigma != null && view.est.sigma < 2, view.est?.sigma != null ? `${view.est.sigma.toFixed(1)} m` : "—"],
    ["Someone on the ball", Number.isFinite(nd) && nd < CONTROL_RADIUS, Number.isFinite(nd) ? `${nd.toFixed(1)} m` : "—"],
    ["Model decisive (> 80%)", top > 80, `${top}%`],
  ];
  return (
    <Card title="Estimate confidence" tag="this frame">
      <ul className={s.checks}>
        {checks.map(([label, ok, value]) => (
          <li key={label} data-ok={ok}>
            <span className={s.check} aria-hidden="true">{ok ? "✓" : "–"}</span>
            <span>
              {label}
              <span className={s.sr}>{ok ? ": yes" : ": no"}</span>
            </span>
            <b>{value}</b>
          </li>
        ))}
      </ul>
      <div className="mini-stats">
        <div>
          <p className={s.miniLabel}>Mean model confidence</p>
          <p className={s.miniValue}>{mean.toFixed(0)}%</p>
        </div>
        {agreement !== null && (
          <div>
            <p className={s.miniLabel}>Matches truth so far</p>
            <p className={`${s.miniValue} ${s.good}`}>{(agreement * 100).toFixed(1)}%</p>
          </div>
        )}
      </div>
      <div className="prediction-confidence">
        <span>{agreement !== null ? "Agreement" : "Confidence"}</span>
        <i>
          <b style={{ width: `${agreement !== null ? agreement * 100 : mean}%` }} />
        </i>
        <strong>{Math.round(agreement !== null ? agreement * 100 : mean)}%</strong>
      </div>
      <p className={s.note}>
        Confidence is the model's own posterior, not a calibrated probability. In this fixed-lag mode, calls made at 99% or more were right 85% of the time on Metrica's
        matches and 96% on simulated ones.
      </p>
      {replay.truth && <p className={s.note}>Truth is the simulator's record of an invented match. It checks the design, not the leaderboard.</p>}
    </Card>
  );
}

function MomentumPanel({ replay, index, onSeek }: { replay: Replay; index: number; onSeek: (to: number) => void }) {
  const w = 520;
  const h = 230;
  const mid = 100;
  const n = replay.length;
  const path = useMemo(() => {
    const step = Math.max(1, Math.floor(n / 520));
    const top: string[] = [];
    for (let k = 0; k < n; k += step) {
      const v = (replay.pHome[k]! - replay.pAway[k]!) / 100;
      top.push(`${((k / n) * w).toFixed(1)},${(mid - v * 84).toFixed(1)}`);
    }
    return `M0,${mid} L${top.join(" L")} L${w},${mid} Z`;
  }, [replay, n]);
  const truthPieces = useMemo(() => (replay.truth ? runs(replay.truth) : []), [replay]);
  return (
    <Card title="Possession swing" tag="p(home) − p(away), whole replay">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className={s.clickable}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          onSeek(((e.clientX - box.left) / box.width) * n);
        }}
        aria-hidden="true"
      >
        <defs>
          <clipPath id="mc-up"><rect x={0} y={0} width={w} height={mid} /></clipPath>
          <clipPath id="mc-down"><rect x={0} y={mid} width={w} height={h} /></clipPath>
          <pattern id="mc-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" style={{ fill: "var(--dead)" }} />
            <rect width="1.4" height="5" style={{ fill: "color-mix(in srgb, var(--text) 45%, transparent)" }} />
          </pattern>
        </defs>
        <path d={path} style={{ fill: "var(--home)" }} clipPath="url(#mc-up)" />
        <path d={path} style={{ fill: "var(--away)" }} clipPath="url(#mc-down)" />
        <line x1={0} x2={w} y1={mid} y2={mid} />
        <text x={4} y={14}>HOME</text>
        <text x={4} y={mid + 80}>AWAY</text>
        {truthPieces.map((p) =>
          p.label === "X" ? null : (
            <rect key={p.start} x={(p.start / n) * w} y={h - 16} width={((p.stop - p.start) / n) * w} height={8} style={{ fill: p.label === "H" ? "var(--home)" : p.label === "A" ? "var(--away)" : "url(#mc-hatch)" }} />
          ),
        )}
        <line x1={(index / n) * w} x2={(index / n) * w} y1={0} y2={h - 4} className={s.playhead} />
      </svg>
      <p className={s.note}>{replay.truth ? "Thin strip underneath: simulator truth. Click anywhere to jump." : "Click anywhere to jump."}</p>
    </Card>
  );
}

function FeedPanel({ replay, a, view }: { replay: Replay; a: Analytics; view: FrameView }) {
  const i = view.index;
  const near = a.nearest[i]!;
  const num = (v: number, d = 2) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);
  const record = {
    frame: view.frame,
    t: Number(((replay.firstFrame + i) / replay.fps).toFixed(2)),
    call: view.label,
    p: { home: view.pHome, away: view.pAway, dead: view.pDead },
    ball: {
      seen: !!view.ball,
      xy: view.est ? [num(view.est.x), num(view.est.y)] : null,
      sigma_m: view.est?.sigma != null ? num(view.est.sigma) : null,
      speed_kmh: num(kmh(a.ballSpeed[i]!), 1),
    },
    nearest: near >= 0 ? { slot: near, team: replay.teams[near] === 0 ? "home" : "away", dist_m: num(a.nearestDistance[i]!) } : null,
    fastest_tenth_kmh: num(kmh(a.p90[i]!), 1),
    tracks: view.players.length,
    ...(view.truth ? { truth: view.truth } : {}),
  };
  return (
    <Card title="Live data feed" tag="one frame, as JSON">
      <pre className={s.feed}>
        <Json value={record} />
      </pre>
    </Card>
  );
}

function Json({ value, indent = 0 }: { value: unknown; indent?: number }): ReactNode {
  const pad = "  ".repeat(indent);
  if (value === null) return <span className={s.jNull}>null</span>;
  if (typeof value === "number") return <span className={s.jNum}>{value}</span>;
  if (typeof value === "boolean") return <span className={s.jBool}>{String(value)}</span>;
  if (typeof value === "string") return <span className={s.jStr}>"{value}"</span>;
  if (Array.isArray(value))
    return (
      <>
        [
        {value.map((v, k) => (
          <span key={k}>
            {k > 0 && ", "}
            <Json value={v} indent={indent + 1} />
          </span>
        ))}
        ]
      </>
    );
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <>
      {"{\n"}
      {entries.map(([k, v], j) => (
        <span key={k}>
          {pad}  <span className={s.jKey}>"{k}"</span>: <Json value={v} indent={indent + 1} />
          {j < entries.length - 1 ? ",\n" : "\n"}
        </span>
      ))}
      {pad}
      {"}"}
    </>
  );
}

function EventsPanel({ replay, events, index, onSeek }: { replay: Replay; events: ConsoleEvent[]; index: number; onSeek: (to: number) => void }) {
  const soFar = useMemo(() => events.filter((e) => e.index <= index), [events, index]);
  const recent = soFar.slice(-7).reverse();
  return (
    <section className={`stat-tile ${s.tile}`}>
      <div className={s.tileHead}>
        <p className="kicker">Events &amp; alerts</p>
        <span className={s.tag}>{soFar.length} so far</span>
      </div>
      {recent.length === 0 ? (
        <p className="stat-note">Nothing yet. Press play.</p>
      ) : (
        <ul className={s.events}>
          {recent.map((e) => (
            <li key={`${e.index}-${e.kind}-${e.slot ?? ""}`}>
              <button type="button" onClick={() => onSeek(e.index)}>
                <i data-kind={e.kind} className={e.kind === "dead" ? "state-D" : ""} />
                <span className={s.eventTime}>{formatClock((replay.firstFrame + e.index) / replay.fps)}</span>
                <span className={s.eventText}>{e.text}</span>
                <span className={s.eventWho}>{e.slot !== undefined ? `#${slotNumber(replay, e.slot)}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TeamPanel({ totals }: { totals: ReturnType<typeof teamTotals> }) {
  const [home, away] = totals;
  const r = 30;
  const c = 2 * Math.PI * r;
  const rows: [string, string, string][] = [
    ["Possessions", String(home.possessions), String(away.possessions)],
    ["Distance (km)", home.distanceKm.toFixed(2), away.distanceKm.toFixed(2)],
    ["High-speed runs", String(home.highSpeedRuns), String(away.highSpeedRuns)],
    ["Top speed (km/h)", kmh(home.topSpeed).toFixed(1), kmh(away.topSpeed).toFixed(1)],
  ];
  return (
    <section className={`stat-tile ${s.tile}`}>
      <div className={s.tileHead}>
        <p className="kicker">Team metrics</p>
        <svg viewBox="0 0 80 80" className={s.donut} aria-hidden="true">
          <circle cx="40" cy="40" r={r} className={s.donutAway} />
          <circle cx="40" cy="40" r={r} className={s.donutHome} strokeDasharray={`${home.possessionShare * c} ${c}`} transform="rotate(-90 40 40)" />
        </svg>
      </div>
      <div className={s.teamGrid} role="table" aria-label="Team metrics so far">
        <div role="row" className={s.teamHead}>
          <span role="columnheader" />
          <span role="columnheader" className={s.homeText}>Home</span>
          <span role="columnheader" className={s.awayText}>Away</span>
        </div>
        {rows.map(([k, h, a]) => (
          <div role="row" key={k}>
            <span role="rowheader">{k}</span>
            <span role="cell">{h}</span>
            <span role="cell">{a}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- transition inspector ---- */

interface Change {
  /** First frame of the new label. */
  at: number;
  from: ReplayLabel;
  to: ReplayLabel;
}

/** Every change of the estimate's call between H, A and D (changes into or out of X are not calls). */
export function changesOf(labels: string): Change[] {
  const out: Change[] = [];
  const pieces = runs(labels);
  for (let k = 1; k < pieces.length; k++) {
    const prev = pieces[k - 1]!;
    const cur = pieces[k]!;
    if (prev.label === "X" || cur.label === "X") continue;
    out.push({ at: cur.start, from: prev.label as ReplayLabel, to: cur.label as ReplayLabel });
  }
  return out;
}

const TEAM_OF: Partial<Record<ReplayLabel, 0 | 1>> = { H: 0, A: 1 };
const LABEL_NAME: Record<ReplayLabel, string> = { H: "Home", A: "Away", D: "Dead ball" };

interface Inspection {
  kind: "Turnover" | "Into dead ball" | "Restart";
  cause: string;
  causeNote: string;
  before: number | null;
  after: number | null;
  ballBefore: [number, number] | null;
  ballAt: [number, number] | null;
  ballAfter: [number, number] | null;
  ballSpeed: number;
  ballSeen: boolean;
  nearest: { slot: number; team: 0 | 1; distance: number; speed: number }[];
  truth: { at: number; offset: number } | null;
  window: [number, number];
}

/** Who had the ball for `team` over [lo, hi): the slot most often nearest to it, within reach. */
function possessor(a: Analytics, replay: Replay, team: 0 | 1, lo: number, hi: number): number | null {
  const counts = new Map<number, number>();
  for (let k = Math.max(0, lo); k < Math.min(replay.length, hi); k++) {
    const s = a.nearest[k]!;
    if (s < 0 || replay.teams[s] !== team || !(a.nearestDistance[k]! < CONTROL_RADIUS * 1.5)) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: number | null = null;
  let most = 0;
  counts.forEach((n, s) => {
    if (n > most) {
      most = n;
      best = s;
    }
  });
  return best;
}

const estAt = (replay: Replay, k: number): [number, number] | null => {
  const e = replay.est[Math.max(0, Math.min(replay.length - 1, k))];
  return e ? [e[0], e[1]] : null;
};

export function inspect(replay: Replay, a: Analytics, c: Change): Inspection {
  const fps = replay.fps;
  const w1 = Math.round(fps);
  const w2 = Math.round(2 * fps);
  const k = c.at;
  const kind = c.to === "D" ? "Into dead ball" : c.from === "D" ? "Restart" : "Turnover";
  const fromTeam = TEAM_OF[c.from];
  const toTeam = TEAM_OF[c.to];
  const before = fromTeam !== undefined ? possessor(a, replay, fromTeam, k - w2, k) : null;
  const after = toTeam !== undefined ? possessor(a, replay, toTeam, k, k + w2) : null;
  const ballBefore = estAt(replay, k - w1);
  const ballAt = estAt(replay, k);
  const ballAfter = estAt(replay, k + w1);
  const ballSeen = replay.ball[k] !== null;

  const nearest: Inspection["nearest"] = [];
  if (ballAt) {
    const row = replay.players[k]!;
    for (let s = 0; s < replay.teams.length; s++) {
      const x = row[s * 2];
      const y = row[s * 2 + 1];
      if (x == null || y == null) continue;
      nearest.push({ slot: s, team: replay.teams[s]!, distance: Math.hypot(x - ballAt[0], y - ballAt[1]), speed: a.speed[s]![k]! });
    }
    nearest.sort((p, q) => p.distance - q.distance);
    nearest.splice(3);
  }

  // Cause, inferred from positions only.
  let cause = "Loose ball";
  let causeNote = "No clear pass or duel: the ball changed hands while nobody had it under control.";
  const [L, W] = replay.pitch;
  const outside = (p: [number, number] | null) => !!p && (p[0] < -0.5 || p[0] > L + 0.5 || p[1] < -0.5 || p[1] > W + 0.5);
  if (kind === "Into dead ball") {
    if (outside(ballAt) || outside(ballAfter)) {
      cause = "Ball out of play";
      causeNote = "The estimated ball left the pitch.";
    } else {
      cause = "Play stopped";
      const p90 = a.p90[Math.min(replay.length - 1, k + w1)]!;
      causeNote = Number.isFinite(p90)
        ? `The ball stayed on the pitch but the fastest players slowed to ${kmh(p90).toFixed(0)} km/h, the look of a foul or an injury stoppage.`
        : "The ball stayed on the pitch but play slowed down.";
    }
  } else if (kind === "Restart") {
    cause = "Restart";
    causeNote = after !== null ? `${slotName(replay, after)} took it.` : "Play resumed.";
  } else if (!ballSeen && a.hiddenFor[k]! > fps) {
    cause = "Uncertain";
    causeNote = `The tracking had not seen the ball for ${(a.hiddenFor[k]! / fps).toFixed(1)} s, so the change rests on the filter's guess.`;
  } else {
    let flight = 0;
    for (let j = Math.max(0, k - w2); j <= k; j++) if (Number.isFinite(a.ballSpeed[j]!)) flight = Math.max(flight, a.ballSpeed[j]!);
    const start = estAt(replay, k - w2);
    const travelled = start && ballAt ? Math.hypot(ballAt[0] - start[0], ballAt[1] - start[1]) : 0;
    const row = replay.players[k]!;
    const gap =
      before !== null && after !== null && row[before * 2] != null && row[after * 2] != null
        ? Math.hypot(row[before * 2]! - row[after * 2]!, row[before * 2 + 1]! - row[after * 2 + 1]!)
        : Infinity;
    if (flight > 8 && travelled > 8) {
      cause = "Interception";
      causeNote = `The ball travelled ${travelled.toFixed(0)} m at up to ${kmh(flight).toFixed(0)} km/h and was taken by the other team.`;
    } else if (gap < 2.5) {
      cause = "Tackle or duel";
      causeNote = `The two players were ${gap.toFixed(1)} m apart when the ball changed hands.`;
    }
  }

  let truth: Inspection["truth"] = null;
  if (replay.truth) {
    let best: number | null = null;
    for (const t of changesOf(replay.truth)) {
      if (t.to !== c.to || Math.abs(t.at - k) > w2) continue;
      if (best === null || Math.abs(t.at - k) < Math.abs(best - k)) best = t.at;
    }
    if (best !== null) truth = { at: best, offset: (k - best) / fps };
  }

  return {
    kind,
    cause,
    causeNote,
    before,
    after,
    ballBefore,
    ballAt,
    ballAfter,
    ballSpeed: a.ballSpeed[k]!,
    ballSeen,
    nearest,
    truth,
    window: [Math.max(0, k - Math.round(5 * fps)), Math.min(replay.length - 1, k + Math.round(5 * fps))],
  };
}


function ProbabilityWindow({ replay, c, info, index }: { replay: Replay; c: Change; info: Inspection; index: number }) {
  const w = 720;
  const h = 150;
  const [lo, hi] = info.window;
  const x = (k: number) => 30 + ((k - lo) / Math.max(1, hi - lo)) * (w - 40);
  const y = (p: number) => h - 22 - (p / 100) * (h - 34);
  const series: { key: string; label: string; values: number[]; color: string }[] = [
    { key: "H", label: "p(home)", values: replay.pHome, color: "var(--home)" },
    { key: "A", label: "p(away)", values: replay.pAway, color: "var(--away)" },
    { key: "D", label: "p(dead)", values: replay.pHome.map((v, j) => Math.max(0, 100 - v - replay.pAway[j]!)), color: "var(--dead)" },
  ];
  const fps = replay.fps;
  return (
    <div className={`chart-card ${s.probWrap}`}>
      <p className={s.miniLabel}>The model's probabilities, 5 s either side</p>
      <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {[0, 50, 100].map((p) => (
          <g key={p}>
            <line x1={30} x2={w - 10} y1={y(p)} y2={y(p)} />
            <text x={24} y={y(p) + 4} textAnchor="end">{p}</text>
          </g>
        ))}
        {series.map((se) => {
          const pts: string[] = [];
          for (let k = lo; k <= hi; k++) {
            if (replay.label[k] === "X") continue;
            pts.push(`${x(k).toFixed(1)},${y(se.values[k]!).toFixed(1)}`);
          }
          return <polyline key={se.key} points={pts.join(" ")} className={s.series} style={{ stroke: se.color }} />;
        })}
        <line x1={x(c.at)} x2={x(c.at)} y1={6} y2={h - 22} className={s.changeLine} />
        {info.truth && <line x1={x(info.truth.at)} x2={x(info.truth.at)} y1={6} y2={h - 22} className={s.truthLine} />}
        {index >= lo && index <= hi && <line x1={x(index)} x2={x(index)} y1={6} y2={h - 22} className={s.probHead} />}
        {[-5, -2.5, 0, 2.5, 5].map((t) => {
          const k = c.at + t * fps;
          if (k < lo || k > hi) return null;
          return (
            <text key={t} x={x(k)} y={h - 6} textAnchor="middle">
              {t === 0 ? "change" : `${t > 0 ? "+" : ""}${t} s`}
            </text>
          );
        })}
      </svg>
      <div className="chart-legend">
        {series.map((se) => (
          <span key={se.key}>
            <i style={{ background: se.color }} />
            {se.label}
          </span>
        ))}
        <span><i className={s.kChange} />the estimate's change</span>
        {info.truth && <span><i className={s.kTruth} />the truth's change</span>}
        <span><i className={s.kHead} />playhead</span>
      </div>
      <p className={s.note}>The estimate answers {(replay.lag / fps).toFixed(1)} s after each frame, so these are its fixed-lag probabilities, not the whole-half ones the submission uses.</p>
    </div>
  );
}

/* ---- the Transitions page ---- */

type Kind = Inspection["kind"];
const KIND_FILTERS: { value: "all" | Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "Turnover", label: "Turnovers" },
  { value: "Into dead ball", label: "Into dead ball" },
  { value: "Restart", label: "Restarts" },
];
const RATES = [0.25, 0.5, 1] as const;
type Rate = (typeof RATES)[number];
/** Seconds replayed either side of a change. */
const AROUND = 3;

/** Move to another page of the site without a reload; the site's router listens to popstate. */
function go(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
}

const kindOf = (c: Change): Kind => (c.to === "D" ? "Into dead ball" : c.from === "D" ? "Restart" : "Turnover");

/** Every change of possession the estimate makes, replayed one at a time in slow motion. */
export function TransitionsPage() {
  const replay = useMemo(decodeReplay, []);
  return (
    <main id="main-content" className="page">
      <style>{CONSOLE_CSS}</style>
      <Transitions replay={replay} />
    </main>
  );
}

function Transitions({ replay }: { replay: Replay }) {
  const a = useMemo(() => analyse(replay), [replay]);
  const changes = useMemo(() => changesOf(replay.label), [replay]);
  const infos = useMemo(() => changes.map((c) => inspect(replay, a, c)), [replay, a, changes]);
  const fps = replay.fps;

  // Open on the change asked for in the address (?at=frame), else the first one.
  const [current, setCurrent] = useState(() => {
    const at = Number(new URLSearchParams(window.location.search).get("at"));
    const k = Number.isFinite(at) ? changes.findIndex((c) => c.at === at) : -1;
    return k >= 0 ? k : 0;
  });
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [rate, setRate] = useState<Rate>(0.25);
  const [playing, setPlaying] = useState(false);
  const [closeUp, setCloseUp] = useState(true);

  const c = changes[current];
  const info = infos[current];
  const lo = c ? Math.max(0, c.at - Math.round(AROUND * fps)) : 0;
  const hi = c ? Math.min(replay.length - 1, c.at + Math.round(AROUND * fps)) : 0;
  const [t, setT] = useState(lo);

  // A new change starts paused at the beginning of its window.
  useEffect(() => {
    setPlaying(false);
    setT(lo);
  }, [current, lo]);

  const tRef = useRef(t);
  tRef.current = t;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const next = Math.min(hi, tRef.current + ((now - previous) / 1000) * fps * rate);
      previous = now;
      setT(next);
      if (next >= hi) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, hi, fps]);

  const visible = changes.map((_, k) => k).filter((k) => filter === "all" || kindOf(changes[k]!) === filter);
  const pos = visible.indexOf(current);
  const step = (dir: number) => {
    const list = visible.length ? visible : changes.map((_, k) => k);
    const at = list.indexOf(current);
    const next = at < 0 ? list[0] : list[Math.max(0, Math.min(list.length - 1, at + dir))];
    if (next !== undefined) setCurrent(next);
  };
  const watch = () => {
    if (t >= hi) setT(lo);
    setPlaying((p) => !p);
  };
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "SELECT" || target.tagName === "INPUT") return;
    if (event.key === " " && target.tagName !== "BUTTON") {
      event.preventDefault();
      watch();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  };

  const matched = infos.filter((i) => i.truth !== null).length;
  const clock = (k: number) => formatClock((replay.firstFrame + k) / fps);

  return (
    <div className={`container ${s.root}`} onKeyDown={onKey} tabIndex={-1}>
      <header className="page-header">
        <div>
          <div className="title-badge">
            <p className="kicker">Transitions</p>
            <span className="badge badge-demo" data-tooltip="Invented by starter/synthetic_match.py, so the true answer is known. Not real match data.">
              Synthetic
            </span>
          </div>
          <h1>How possession changes hands.</h1>
          <p>
            Deciding the moment possession really changes is the hardest part of this challenge. Here is every change the estimate made in the Console's simulated
            match, replayed in slow motion from {AROUND} s before to {AROUND} s after, with who had the ball, what the model believed, and whether the simulator agrees.
            {replay.truth ? ` ${matched} of ${changes.length} match a change in the simulator's truth within 2 s.` : ""}
          </p>
        </div>
      </header>

      {!c || !info ? (
        <p className="stat-note">The estimate never changes its call in this replay.</p>
      ) : (
        <>
          <div className={`toolbar ${s.toolbar}`}>
            <div className="filter-chips" role="group" aria-label="Kind of change">
              {KIND_FILTERS.map((f) => (
                <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className={s.inspNav}>
              <button type="button" className="button button-secondary" onClick={() => step(-1)} disabled={pos === 0}>
                ← Previous
              </button>
              <span className={s.inspCount}>
                {pos >= 0 ? `${pos + 1} of ${visible.length}` : `${current + 1} of ${changes.length}`}
              </span>
              <button type="button" className="button button-secondary" onClick={() => step(1)} disabled={pos === visible.length - 1}>
                Next →
              </button>
            </div>
          </div>

          <section className={`card ${s.inspector}`} aria-label={`Change at ${clock(c.at)}`}>
            <div className={s.inspHead}>
              <div>
                <p className={s.inspCount}>
                  {clock(c.at)} · change {current + 1} of {changes.length}
                </p>
                <h2 className={s.inspTitle}>
                  <span className={`state-chip state-${c.from} no-hatch`} />
                  {LABEL_NAME[c.from]} <span className="muted">→</span> <span className={`state-chip state-${c.to} no-hatch`} />
                  {LABEL_NAME[c.to]}
                </h2>
              </div>
            </div>

            <div className={s.inspGrid}>
              <div>
                <SlowMotionPitch replay={replay} c={c} info={info} t={t} lo={lo} hi={hi} closeUp={closeUp} />
                <div className={s.slowControls}>
                  <button type="button" className="play-button" onClick={watch} aria-label={playing ? "Pause" : "Watch it in slow motion"}>
                    <Glyph name={playing ? "Pause" : "Play"} size={18} />
                  </button>
                  <div className="segmented" role="group" aria-label="View">
                    <button type="button" aria-pressed={closeUp} onClick={() => setCloseUp(true)}>
                      Close-up
                    </button>
                    <button type="button" aria-pressed={!closeUp} onClick={() => setCloseUp(false)}>
                      Whole pitch
                    </button>
                  </div>
                  <div className="segmented" role="group" aria-label="Replay speed">
                    {RATES.map((r) => (
                      <button key={r} type="button" aria-pressed={rate === r} onClick={() => setRate(r)}>
                        {r === 1 ? "1×" : r === 0.5 ? "½×" : "¼×"}
                      </button>
                    ))}
                  </div>
                  <span className={s.relClock}>
                    {t < c.at ? "−" : "+"}
                    {(Math.abs(t - c.at) / fps).toFixed(1)} s
                  </span>
                  <input
                    type="range"
                    min={lo}
                    max={hi}
                    step={0.25}
                    value={t}
                    onChange={(e) => {
                      setPlaying(false);
                      setT(Number(e.target.value));
                    }}
                    aria-label="Position around the change"
                    aria-valuetext={`${((t - c.at) / fps).toFixed(1)} seconds from the change`}
                  />
                </div>
                <p className="keys-hint">
                  <span>Space</span>watch it <span>← →</span>previous or next change
                </p>
              </div>
              <TransitionFacts replay={replay} c={c} info={info} />
            </div>
            <ProbabilityWindow replay={replay} c={c} info={info} index={t} />
          </section>

          <section className={s.section} aria-labelledby="tr-all">
            <div className="section-header">
              <p className="kicker">All changes</p>
              <h2 id="tr-all">Every change in this match</h2>
            </div>
            <div className={`card ${s.changeList}`}>
              <div className={s.changeHead} aria-hidden="true">
                <span>time</span>
                <span>change</span>
                <span>cause, inferred</span>
                <span>against the truth</span>
              </div>
              <ul>
                {visible.map((k) => {
                  const ch = changes[k]!;
                  const inf = infos[k]!;
                  return (
                    <li key={ch.at}>
                      <button type="button" aria-pressed={k === current} onClick={() => setCurrent(k)}>
                        <span className={s.eventTime}>{clock(ch.at)}</span>
                        <span>
                          <span className={`state-chip state-${ch.from} no-hatch`} />
                          {LABEL_NAME[ch.from]} → <span className={`state-chip state-${ch.to} no-hatch`} />
                          {LABEL_NAME[ch.to]}
                        </span>
                        <span>{inf.kind === inf.cause ? inf.kind : inf.cause}</span>
                        <span className={s.truth} data-agree={replay.truth ? inf.truth !== null : undefined}>
                          {!replay.truth
                            ? "—"
                            : inf.truth
                              ? Math.abs(inf.truth.offset) < 0.1
                                ? "✓ on time"
                                : `✓ ${Math.abs(inf.truth.offset).toFixed(1)} s ${inf.truth.offset > 0 ? "late" : "early"}`
                              : "✗ not in the truth"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function TransitionFacts({ replay, c, info }: { replay: Replay; c: Change; info: Inspection }) {
  const fps = replay.fps;
  const who = (slot: number | null) => (slot === null ? "—" : slotName(replay, slot));
  const pt = (p: [number, number] | null) => (p ? `${p[0].toFixed(1)}, ${p[1].toFixed(1)} m` : "—");
  const truthLine = !replay.truth
    ? null
    : info.truth
      ? Math.abs(info.truth.offset) < 0.1
        ? { ok: true, text: "Matches the simulator's truth to within 0.1 s." }
        : { ok: true, text: `Matches the simulator's truth, ${Math.abs(info.truth.offset).toFixed(1)} s ${info.truth.offset > 0 ? "late" : "early"}.` }
      : { ok: false, text: "No change like this in the simulator's truth within 2 s: the estimate invented it." };
  return (
    <div className={s.inspFacts}>
      <div className={s.cause}>
        <p className="kicker">{info.kind === info.cause ? info.kind : `${info.kind} · ${info.cause}`}</p>
        <p>{info.causeNote}</p>
        <p className={s.inferred}>Inferred from positions only: the tracking carries no event data.</p>
      </div>
      {truthLine && (
        <p className={s.verdict} data-ok={truthLine.ok}>
          {truthLine.ok ? "✓" : "✗"} {truthLine.text}
        </p>
      )}
      <Rows
        rows={[
          ["Previous possessor", who(info.before)],
          ["New possessor", who(info.after)],
          ["Ball 1 s before", pt(info.ballBefore)],
          ["Ball at the change", `${pt(info.ballAt)}${info.ballSeen ? "" : " (hidden)"}`],
          ["Ball 1 s after", pt(info.ballAfter)],
          ["Ball speed at the change", Number.isFinite(info.ballSpeed) ? `${kmh(info.ballSpeed).toFixed(0)} km/h` : "—"],
        ]}
      />
      <p className={s.miniLabel}>Nearest players at the change</p>
      <ul className={s.nearList}>
        {info.nearest.map((p) => (
          <li key={p.slot}>
            <i className={p.team === 0 ? "home-bg" : "away-bg"} />
            <span>{slotName(replay, p.slot)}</span>
            <b>{p.distance.toFixed(1)} m</b>
            <b>{Number.isFinite(p.speed) ? `${kmh(p.speed).toFixed(0)} km/h` : "—"}</b>
          </li>
        ))}
      </ul>
      <p className={s.note}>
        The estimate's change is at {formatClock((replay.firstFrame + c.at) / fps)}; the slow-motion replay runs {AROUND} s either side.
      </p>
    </div>
  );
}

/** The pitch from above at fractional frame t: everyone moving, the ball's path drawing in. */
function SlowMotionPitch({ replay, c, info, t, lo, hi, closeUp }: { replay: Replay; c: Change; info: Inspection; t: number; lo: number; hi: number; closeUp: boolean }) {
  const [L, W] = replay.pitch;
  // Close-up: a 48 x 32 m window centred on where the ball goes during the replay, kept on the pitch.
  const box = useMemo(() => {
    if (!closeUp) return { x: -3, y: -3, w: L + 6, h: W + 6 };
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = lo; j <= hi; j++) {
      const e = replay.est[j];
      if (e) {
        sx += e[0];
        sy += e[1];
        n++;
      }
    }
    const w = 48;
    const h = 32;
    const cx = n ? sx / n : L / 2;
    const cy = n ? sy / n : W / 2;
    return { x: Math.max(-3, Math.min(L + 3 - w, cx - w / 2)), y: Math.max(-3, Math.min(W + 3 - h, cy - h / 2)), w, h };
  }, [closeUp, replay, lo, hi, L, W]);
  const k = closeUp ? 0.7 : 1; // markers a little smaller when zoomed in
  const view = frameAt(replay, t);
  const focus = [info.before, info.after].filter((v): v is number => v !== null);
  const near = new Set(info.nearest.map((p) => p.slot));
  const trail: string[] = [];
  for (let j = lo; j <= Math.floor(t); j++) {
    const e = replay.est[j];
    if (e) trail.push(`${e[0].toFixed(2)},${e[1].toFixed(2)}`);
  }
  if (view.est) trail.push(`${view.est.x.toFixed(2)},${view.est.y.toFixed(2)}`);
  const atChange = Math.abs(t - c.at) < replay.fps * 0.6;
  const call = view.label;
  const truth = replay.truth ? (replay.truth[view.index] as ReplayCall) : null;
  const callName = (k: ReplayCall) => (k === "H" ? "Home ball" : k === "A" ? "Away ball" : k === "D" ? "Dead ball" : "Not in play");
  return (
    <figure className={s.inspPitch}>
      <div className={s.slowChips}>
        <span className={`live-state live-state-${call === "X" ? "D" : call}`}>Estimate: {callName(call)}</span>
        {truth && <span className={`live-state live-state-${truth === "X" ? "D" : truth}`}>Truth: {callName(truth)}</span>}
        {atChange && <span className={s.changeFlag}>Possession changes</span>}
      </div>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} role="img" aria-label="Players and ball from above around the change">
        <rect x={box.x} y={box.y} width={box.w} height={box.h} className="pitch-field" />
        <rect x={0} y={0} width={L} height={W} className="pitch-field" />
        <g className={s.miniLines}>
          <rect x={0} y={0} width={L} height={W} />
          <line x1={L / 2} y1={0} x2={L / 2} y2={W} />
          <circle cx={L / 2} cy={W / 2} r={9.15} />
          <rect x={0} y={(W - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={L - 16.5} y={(W - 40.3) / 2} width={16.5} height={40.3} />
          <rect x={0} y={(W - 18.32) / 2} width={5.5} height={18.32} />
          <rect x={L - 5.5} y={(W - 18.32) / 2} width={5.5} height={18.32} />
        </g>
        <polyline points={trail.join(" ")} className={t < c.at ? s.pathBefore : s.pathAfter} />
        {view.players.map((p) => {
          const key = near.has(p.slot) || focus.includes(p.slot);
          return (
            <g key={p.slot} opacity={key ? 1 : 0.45}>
              <circle cx={p.x} cy={p.y} r={(key ? 1.6 : 1.15) * k} className={p.team === 0 ? s.miniHome : s.miniAway} />
              {focus.includes(p.slot) && <circle cx={p.x} cy={p.y} r={2.8 * k} className={s.miniFocus} />}
              {key && (
                <text x={p.x} y={p.y + 0.65 * k} textAnchor="middle" className={s.miniNum} style={{ fontSize: `${1.7 * k}px` }}>
                  {slotNumber(replay, p.slot)}
                </text>
              )}
            </g>
          );
        })}
        {view.est && view.est.sigma !== null && view.est.sigma < 15 && !view.ball && (
          <circle cx={view.est.x} cy={view.est.y} r={Math.max(view.est.sigma, 0.6)} className={s.miniRing} />
        )}
        {view.est && <circle cx={view.est.x} cy={view.est.y} r={0.9 * k} className={s.miniBall} data-hidden={!view.ball} />}
        {atChange && view.est && <circle cx={view.est.x} cy={view.est.y} r={4 * k} className={s.changePulse} />}
      </svg>
      <figcaption className="chart-legend">
        <span>
          <i className={s.kRing} />
          Previous and new possessor
        </span>
        <span>
          <i className={s.kAfter} />
          Ball's path so far
        </span>
        <span>
          <i className={s.kEstRing} />
          Ball hidden: estimate ± σ
        </span>
      </figcaption>
    </figure>
  );
}

const CONSOLE_CSS = `/* Match console. Built on the site's own classes and tokens (index.css), so it follows the
   light and dark themes; everything here is scoped with the mc- prefix. */
.mc-root { outline: none; }
.mc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.mc-root h3 { font-size: 14px; line-height: 20px; font-weight: 600; }

/* toolbar */
.mc-toolbar { flex-wrap: wrap; }
.mc-matchClock {
  display: grid; text-align: right;
  font: 600 20px/24px "JetBrains Mono", "JetBrains Mono Variable", monospace; font-variant-numeric: tabular-nums; letter-spacing: -0.02em;
}
.mc-matchClock small { font: 500 11px/14px "Inter", "Inter Tight Variable", sans-serif; letter-spacing: 0.04em; color: var(--muted); text-transform: uppercase; }

/* possession strips */
.mc-stripRow { display: grid; grid-template-columns: 112px 1fr; align-items: center; gap: 16px; margin-top: 16px; }
.mc-stripTitle { font-size: 12px; font-weight: 600; color: var(--muted); }
.mc-strip { position: relative; height: 40px; border-radius: 3px; background: var(--surface-2); cursor: pointer; }
.mc-strip > span { position: absolute; top: 0; bottom: 0; border-right: 1px solid color-mix(in srgb, var(--surface) 70%, transparent); }
.mc-stripCompact { height: 14px; }
.mc-strip:hover { filter: brightness(1.05); }
.mc-axis { display: flex; justify-content: space-between; margin: 8px 0 8px 128px; color: var(--muted); font: 11px/16px "JetBrains Mono", "JetBrains Mono Variable", monospace; }

/* pitch card */
.mc-stage { position: relative; overflow: hidden; border-radius: 4px; border: 1px solid var(--border); }
.mc-stageSvg { display: block; width: 100%; height: auto; aspect-ratio: 2 / 1; user-select: none; }
.mc-overlay {
  position: absolute; display: inline-flex; align-items: center; gap: 7px;
  padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: blur(6px);
  font: 500 11px/16px "Inter", "Inter Tight Variable", sans-serif; color: var(--text); pointer-events: none;
}
.mc-overlayTL { top: 12px; left: 12px; }
.mc-overlayBL { bottom: 12px; left: 12px; color: var(--muted); }
.mc-overlayBR { bottom: 12px; right: 12px; color: var(--muted); font-family: "JetBrains Mono", "JetBrains Mono Variable", monospace; }
.mc-onDot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 3px var(--green-light); }
.mc-pitchLegend { margin-top: 16px; }
.mc-kBall { background: white; border-radius: 50% !important; box-shadow: 0 0 0 1px #16181d, 0 0 0 3px var(--amber); width: 8px !important; height: 8px !important; margin-left: 2px; }
.mc-kEst { border: 1.5px dashed var(--amber); border-radius: 50% !important; }
.mc-kTrail { height: 2px !important; width: 16px !important; background: var(--muted); vertical-align: 3px !important; }
.mc-kPath { height: 0 !important; width: 16px !important; border-top: 2px dashed var(--amber); vertical-align: 3px !important; }
.mc-kOnBall { border: 2px solid var(--amber); }
.mc-kSel { border: 2px solid var(--text); }
.mc-kDash { height: 0 !important; width: 16px !important; border-top: 2px dashed var(--dead); vertical-align: 3px !important; }

.mc-controls { display: grid; grid-template-columns: 48px auto 120px 1fr; align-items: center; gap: 16px; margin-top: 16px; }
.mc-controls .timecode { margin: 0; font-size: 14px; line-height: 20px; letter-spacing: 0; }
.mc-controls .timecode .muted { font-size: 12px; }
.mc-controls .play-button { color: white; }
[data-theme="dark"] .mc-controls .play-button { color: #0f1214; }
.mc-stepButtons { display: flex; gap: 4px; }
.mc-iconBtn {
  position: relative; width: 40px; height: 40px; display: grid; place-items: center; cursor: pointer;
  background: transparent; border: 1px solid var(--border); border-radius: 4px; color: var(--muted);
}
.mc-iconBtn:hover { color: var(--green); border-color: var(--green); background: var(--green-light); }
.mc-iconBtn[data-tooltip]::after { right: auto; left: 50%; transform: translate(-50%, 4px); }
.mc-iconBtn[data-tooltip]:hover::after, .mc-iconBtn[data-tooltip]:focus-visible::after { transform: translate(-50%, 0); }

/* SVG pitch, in theme colours */
.mc-sky { fill: var(--surface-2); }
.mc-fieldFlat { fill: var(--green-light); }
.mc-field { fill: var(--green-light); }
.mc-stripe { fill: var(--green); opacity: 0.06; }
.mc-boards rect { fill: var(--surface); stroke: var(--border); stroke-width: 0.6; }
.mc-boards text { fill: var(--muted); font-family: "Inter", "Inter Tight Variable", sans-serif; font-weight: 600; letter-spacing: 0.08em; }
.mc-lines polyline { fill: none; stroke: var(--green); stroke-width: 1.4; stroke-linejoin: round; opacity: 0.85; }
.mc-goal polyline { fill: none; stroke: var(--text); stroke-width: 2; stroke-linejoin: round; }
.mc-goal .mc-net { stroke: var(--muted); stroke-width: 0.7; fill: color-mix(in srgb, var(--surface) 30%, transparent); }
.mc-trails polyline { fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; opacity: 0.4; }
.mc-trails polyline[data-team="0"] { stroke: var(--home); }
.mc-trails polyline[data-team="1"] { stroke: var(--away); }
.mc-trails polyline[data-selected="true"] { stroke: var(--text); opacity: 0.8; stroke-width: 2.2; }
.mc-ring { fill: color-mix(in srgb, var(--amber) 14%, transparent); stroke: var(--amber); stroke-width: 1; stroke-dasharray: 4 3; }
.mc-ring[data-hidden="false"] { opacity: 0.5; }
.mc-ballTrail { fill: none; stroke: var(--amber); stroke-width: 2; stroke-dasharray: 6 4; stroke-linecap: round; }

.mc-player { cursor: pointer; }
.mc-shadow { fill: color-mix(in srgb, #000 28%, transparent); }
.mc-legs { fill: none; stroke: #16181d; stroke-width: 2.2; stroke-linecap: round; }
.mc-body { stroke: color-mix(in srgb, #000 20%, transparent); stroke-width: 0.6; }
.mc-head { fill: #d9b79c; }
.mc-player[data-team="0"] .mc-body { fill: var(--home); }
.mc-player[data-team="1"] .mc-body { fill: var(--away); }
.mc-bbox { fill: none; stroke-width: 1.1; }
.mc-player[data-team="0"] .mc-bbox { stroke: color-mix(in srgb, var(--home) 80%, transparent); }
.mc-player[data-team="1"] .mc-bbox { stroke: color-mix(in srgb, var(--away) 80%, transparent); }
.mc-tag rect { stroke: none; }
.mc-tag text { font: 600 9px "JetBrains Mono", "JetBrains Mono Variable", monospace; fill: white; }
.mc-player[data-team="0"] .mc-tag rect { fill: var(--home); }
.mc-player[data-team="1"] .mc-tag rect { fill: var(--away); }
[data-theme="dark"] .mc-tag text { fill: #0f1214; }
.mc-player[data-onball="true"] .mc-bbox { stroke: var(--amber); stroke-width: 2; }
.mc-player[data-selected="true"] .mc-bbox { stroke: var(--text); stroke-width: 2; }
.mc-player[data-selected="true"] .mc-tag rect { fill: var(--text); }
.mc-player[data-selected="true"] .mc-tag text { fill: var(--bg); }
.mc-player:hover .mc-bbox { stroke-width: 2; }
.mc-dot { stroke: var(--surface); stroke-width: 1.5; }
.mc-player[data-team="0"] .mc-dot { fill: var(--home); }
.mc-player[data-team="1"] .mc-dot { fill: var(--away); }
.mc-halo { fill: none; stroke-width: 2.5; }
.mc-player[data-onball="true"] .mc-halo { stroke: var(--amber); }
.mc-player[data-selected="true"] .mc-halo { stroke: var(--text); }
.mc-dotNum { font: 600 11px "JetBrains Mono", "JetBrains Mono Variable", monospace; fill: white; pointer-events: none; }
.mc-estBall { fill: none; stroke: var(--amber); stroke-width: 1.6; }
.mc-seenBall circle { fill: white; stroke: #16181d; stroke-width: 0.8; }
.mc-seenBall rect { fill: none; stroke: var(--amber); stroke-width: 1.3; }

/* right column tiles */
.mc-tile { min-height: auto; padding: 24px; }
.mc-tileHead { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.mc-tag { color: var(--muted); font-size: 12px; font-weight: 400; }
.mc-donut { width: 44px; height: 44px; flex: none; }
.mc-donut circle { fill: none; stroke-width: 12; }
.mc-donutAway { stroke: var(--away); }
.mc-donutHome { stroke: var(--home); transition: stroke-dasharray 120ms linear; }
.mc-teamGrid > div { display: grid; grid-template-columns: 1fr 64px 64px; padding: 10px 0; border-top: 1px solid var(--border); font-size: 14px; }
.mc-teamGrid > div > span:not(:first-child) { text-align: right; font-family: "JetBrains Mono", "JetBrains Mono Variable", monospace; font-variant-numeric: tabular-nums; }
.mc-teamGrid > div > span:first-child { color: var(--muted); }
.mc-teamGrid .mc-teamHead { border-top: 0; padding-top: 0; font-size: 12px; font-weight: 600; }
.mc-teamHead span { font-family: "Inter", "Inter Tight Variable", sans-serif !important; }
.mc-homeText { color: var(--home); }
.mc-awayText { color: var(--away); }

.mc-events { list-style: none; margin: 0; padding: 0; display: grid; }
.mc-events li + li { border-top: 1px solid var(--border); }
.mc-events button {
  width: 100%; display: grid; grid-template-columns: 10px 52px 1fr auto; gap: 10px; align-items: center;
  background: none; border: 0; text-align: left; padding: 9px 4px; cursor: pointer; font-size: 14px; border-radius: 4px;
}
.mc-events button:hover { background: var(--surface-2); }
.mc-events i { width: 10px; height: 10px; border-radius: 2px; }
.mc-events i[data-kind="home"] { background: var(--home); }
.mc-events i[data-kind="away"] { background: var(--away); }
.mc-events i[data-kind="restart"] { background: var(--green); }
.mc-events i[data-kind="hidden"] { background: var(--amber); }
.mc-events i[data-kind="found"] { background: transparent; box-shadow: inset 0 0 0 2px var(--green); }
.mc-events i[data-kind="run"] { background: var(--focus); }
.mc-eventTime, .mc-eventWho { color: var(--muted); font: 12px/16px "JetBrains Mono", "JetBrains Mono Variable", monospace; }
.mc-eventText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* transition inspector */
.mc-sectionLede { margin-top: 12px; max-width: 70ch; color: var(--muted); }
.mc-inspector { padding: 24px; display: grid; gap: 20px; }
.mc-inspHead { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
.mc-inspCount { color: var(--muted); font: 12px/16px "JetBrains Mono", "JetBrains Mono Variable", monospace; }
.mc-root .mc-inspTitle { margin-top: 6px; font-size: 22px; line-height: 30px; letter-spacing: -0.02em; }
.mc-inspTitle .state-chip { margin-right: 8px; }
.mc-inspNav { display: flex; gap: 8px; flex-wrap: wrap; }
.mc-inspNav .button { min-height: 40px; padding: 8px 14px; gap: 8px; cursor: pointer; }
.mc-inspNav .button:disabled { opacity: 0.4; cursor: default; }
.mc-follow { justify-self: start; background: none; border: 0; padding: 0; cursor: pointer; margin-top: -8px; }
.mc-inspGrid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 24px; align-items: start; }
.mc-inspPitch { margin: 0; }
.mc-inspPitch svg { width: 100%; height: auto; display: block; border-radius: 4px; }
.mc-inspPitch figcaption { margin-top: 10px; }
.mc-miniLines rect, .mc-miniLines line, .mc-miniLines circle { fill: none; stroke: var(--green); stroke-width: 0.35; opacity: 0.7; }
.mc-miniHome { fill: var(--home); stroke: var(--surface); stroke-width: 0.3; }
.mc-miniAway { fill: var(--away); stroke: var(--surface); stroke-width: 0.3; }
.mc-miniFocus { fill: none; stroke: var(--text); stroke-width: 0.45; }
.mc-miniNum { font: 600 1.7px "JetBrains Mono", "JetBrains Mono Variable", monospace; fill: white; pointer-events: none; }
.mc-pathBefore { fill: none; stroke: var(--amber); stroke-width: 0.5; stroke-dasharray: 1.2 0.9; stroke-linecap: round; }
.mc-pathAfter { fill: none; stroke: var(--amber); stroke-width: 0.6; stroke-linecap: round; }
.mc-miniBall { fill: white; stroke: #16181d; stroke-width: 0.3; }
.mc-kBefore { height: 0 !important; width: 16px !important; border-top: 2px dashed var(--amber); vertical-align: 3px !important; }
.mc-kAfter { height: 2px !important; width: 16px !important; background: var(--amber); vertical-align: 3px !important; }
.mc-kRing { border: 2px solid var(--text); border-radius: 50% !important; }
.mc-inspFacts { display: grid; gap: 14px; min-width: 0; }
.mc-cause { padding: 14px 16px; border-radius: 4px; background: var(--surface-2); }
.mc-cause p:not(.kicker) { margin-top: 6px; font-size: 14px; line-height: 22px; }
.mc-cause .mc-inferred { color: var(--muted); font-size: 12px; line-height: 18px; }
.mc-verdict { font-size: 14px; font-weight: 600; }
.mc-verdict[data-ok="true"] { color: var(--green); }
.mc-verdict[data-ok="false"] { color: var(--amber); }
.mc-nearList { list-style: none; margin: 0; padding: 0; display: grid; }
.mc-nearList li { display: grid; grid-template-columns: 10px 1fr auto 72px; gap: 10px; align-items: center; padding: 7px 0; font-size: 13px; }
.mc-nearList li + li { border-top: 1px solid var(--border); }
.mc-nearList i { width: 10px; height: 10px; border-radius: 2px; }
.mc-nearList b { font: 500 12px "JetBrains Mono", "JetBrains Mono Variable", monospace; text-align: right; }
.mc-probWrap svg { width: 100%; height: auto; display: block; margin-top: 6px; }
.mc-root .mc-changeLine { stroke: var(--text); stroke-width: 1.5; }
.mc-root .mc-truthLine { stroke: var(--green); stroke-width: 1.5; stroke-dasharray: 4 3; }
.mc-kChange { height: 10px !important; width: 2px !important; background: var(--text); }
.mc-kTruth { height: 10px !important; width: 0 !important; border-left: 2px dashed var(--green); }
.mc-kHead { height: 10px !important; width: 2px !important; background: var(--muted); }
.mc-root .mc-probHead { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 2 2; }

/* console: link to the Transitions page */
.mc-teaser { padding: 32px; display: flex; justify-content: space-between; align-items: center; gap: 24px; flex-wrap: wrap; }
.mc-teaser > div { max-width: 70ch; }
.mc-teaser h2 { margin-top: 8px; }
.mc-teaser p:not(.kicker) { margin-top: 12px; color: var(--muted); }

/* transitions page */
.mc-slowControls { display: grid; grid-template-columns: 48px auto auto auto 1fr; align-items: center; gap: 14px; margin-top: 14px; }
.mc-slowControls .play-button { color: white; }
[data-theme="dark"] .mc-slowControls .play-button { color: #0f1214; }
.mc-relClock { font: 600 14px/20px "JetBrains Mono", "JetBrains Mono Variable", monospace; font-variant-numeric: tabular-nums; min-width: 58px; }
.mc-slowChips { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; min-height: 26px; margin-bottom: 8px; }
.mc-changeFlag { font-size: 12px; font-weight: 600; color: var(--amber); }
.mc-miniRing { fill: color-mix(in srgb, var(--amber) 14%, transparent); stroke: var(--amber); stroke-width: 0.3; stroke-dasharray: 0.8 0.6; }
.mc-miniBall[data-hidden="true"] { fill: none; stroke: var(--amber); stroke-width: 0.4; }
.mc-changePulse { fill: none; stroke: var(--amber); stroke-width: 0.5; opacity: 0.8; }
.mc-kEstRing { border: 1.5px dashed var(--amber); border-radius: 50% !important; }
.mc-changeList { padding: 8px 24px 16px; }
.mc-changeHead, .mc-changeList li button { display: grid; grid-template-columns: 72px minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: center; }
.mc-changeHead { padding: 12px 8px; color: var(--muted); font-size: 12px; font-weight: 600; border-bottom: 1px solid var(--border); }
.mc-changeList ul { list-style: none; margin: 0; padding: 0; }
.mc-changeList li + li { border-top: 1px solid var(--border); }
.mc-changeList li button { width: 100%; padding: 10px 8px; background: none; border: 0; text-align: left; font-size: 14px; border-radius: 4px; cursor: pointer; }
.mc-changeList li button:hover { background: var(--surface-2); }
.mc-changeList li button[aria-pressed="true"] { background: var(--green-light); }
.mc-changeList .state-chip { margin-right: 6px; }

/* sections */
.mc-section { margin-top: 96px; }
.mc-layers { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 24px; }
.mc-layersTwo { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.mc-sideLayers { display: grid; gap: 24px; align-content: start; min-width: 0; }
.mc-soFar { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; align-items: stretch; }
.mc-charts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.mc-dataGrid { display: grid; grid-template-columns: 7fr 5fr; gap: 24px; align-items: start; }
.mc-side { display: grid; gap: 24px; }
.mc-picker { display: grid; gap: 14px; }
.mc-picker .chart-heading { margin-bottom: 0; }
.mc-pickerText { color: var(--muted); font-size: 14px; line-height: 22px; }
.mc-command {
  margin: 0; padding: 10px 12px; border-radius: 4px; background: var(--surface-2); overflow-x: auto;
  font: 12px/18px "JetBrains Mono", "JetBrains Mono Variable", monospace; white-space: pre-wrap; overflow-wrap: anywhere;
}
.mc-pickerActions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; }
.mc-pickerActions label { cursor: pointer; }
.mc-pickerActions label:focus-within { outline: 3px solid var(--focus); outline-offset: 3px; }
.mc-pickerActions .text-link { background: none; border: 0; padding: 0; cursor: pointer; }
.mc-pickError { color: var(--amber); font-size: 13px; line-height: 20px; }
.mc-dataGrid .callout li + li { margin-top: 8px; }
.mc-dataGrid .callout ul { list-style: disc; }
.mc-card { padding: 24px; }
.mc-card svg { display: block; }
.mc-clickable { cursor: pointer; }

.mc-layer { padding: 24px; display: flex; flex-direction: column; }
.mc-layerHead { display: flex; justify-content: space-between; align-items: center; min-height: 24px; margin-bottom: 12px; }
.mc-layerSub { color: var(--muted); font-size: 12px; line-height: 16px; margin-bottom: 16px; }
.mc-rows { margin: 0; display: grid; gap: 8px; font-size: 13px; }
.mc-rows div { display: flex; justify-content: space-between; gap: 12px; }
.mc-rows dt { color: var(--muted); }
.mc-rows dd { margin: 0; text-align: right; font-family: "JetBrains Mono", "JetBrains Mono Variable", monospace; font-variant-numeric: tabular-nums; }
.mc-note { margin-top: 12px; color: var(--muted); font-size: 12px; line-height: 18px; }
.mc-sparkWrap { margin: auto 0 0; padding-top: 16px; }
.mc-spark { width: 100%; height: 44px; display: block; overflow: visible; }
.mc-spark polyline { fill: none; stroke-width: 1.8; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.mc-baseline { stroke: var(--border); vector-effect: non-scaling-stroke; }
.mc-threshold { stroke: var(--dead); stroke-dasharray: 4 3; vector-effect: non-scaling-stroke; }
.mc-sparkWrap figcaption { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 8px; margin-top: 6px; color: var(--muted); font-size: 11px; }
.mc-linkBtn { background: none; border: 0; padding: 0; color: var(--green); font-weight: 600; cursor: pointer; }

.mc-playerCard { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.mc-playerCard strong { display: block; font-size: 14px; line-height: 18px; }
.mc-playerCard small { color: var(--muted); font-size: 11px; }
.mc-badgeNum { width: 36px; height: 36px; flex: none; border-radius: 4px; display: grid; place-items: center; color: white; font: 600 13px "JetBrains Mono", "JetBrains Mono Variable", monospace; }
[data-theme="dark"] .mc-badgeNum { color: #0f1214; }
.mc-bigStat { margin-left: auto; text-align: right; font: 600 24px/28px "JetBrains Mono", "JetBrains Mono Variable", monospace; letter-spacing: -0.03em; }
.mc-bigStat small { display: block; font: 11px/14px "Inter", "Inter Tight Variable", sans-serif; letter-spacing: 0; color: var(--muted); }

.mc-gauge { margin-bottom: 16px; }
.mc-gaugeTrack { position: relative; height: 10px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.mc-gaugeZone { position: absolute; inset: 0 auto 0 0; opacity: 0.55; }
.mc-gaugeFill { position: absolute; inset: 0 auto 0 0; background: var(--green); border-right: 2px solid var(--text); transition: width 80ms linear; }
.mc-gaugeScale { position: relative; display: flex; justify-content: space-between; height: 14px; margin-top: 6px; color: var(--muted); font: 10px/14px "JetBrains Mono", "JetBrains Mono Variable", monospace; }
.mc-gaugeScale span:nth-child(2) { position: absolute; transform: translateX(-50%); color: var(--text); }

.mc-posterior { display: grid; gap: 8px; margin-bottom: 16px; font-size: 13px; }
.mc-posterior > div { display: grid; grid-template-columns: 44px 1fr 40px; align-items: center; gap: 10px; }
.mc-posterior > div > span:first-child { color: var(--muted); }
.mc-posterior b { text-align: right; font: 500 12px "JetBrains Mono", "JetBrains Mono Variable", monospace; }
.mc-barTrack { height: 8px; border-radius: 999px; background: var(--surface-2); overflow: hidden; }
.mc-barTrack span { display: block; height: 100%; border-radius: inherit; transition: width 80ms linear; }
.mc-truth[data-agree="true"] { color: var(--green); }
.mc-truth[data-agree="false"] { color: var(--amber); }

.mc-series { fill: none; stroke-width: 2; stroke-linejoin: round; }
.mc-playhead { stroke: var(--text) !important; stroke-width: 1.5; }
.mc-heat { width: 100%; height: auto; border-radius: 4px; }
.mc-heatCell { fill: var(--green); }
.mc-heatLines rect, .mc-heatLines line, .mc-heatLines circle { fill: none; stroke: var(--green); stroke-width: 0.35; opacity: 0.7; }
.mc-thirds { display: flex; justify-content: space-between; margin-top: 12px; color: var(--muted); font-size: 12px; }
.mc-thirds b { color: var(--text); font: 600 12px "JetBrains Mono", "JetBrains Mono Variable", monospace; }

.mc-checks { list-style: none; margin: 0 0 16px; padding: 0; display: grid; }
.mc-checks li { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 8px; padding: 8px 0; font-size: 13px; color: var(--muted); }
.mc-checks li + li { border-top: 1px solid var(--border); }
.mc-checks li b { color: var(--text); font: 500 12px "JetBrains Mono", "JetBrains Mono Variable", monospace; }
.mc-check { width: 18px; height: 18px; border-radius: 4px; display: grid; place-items: center; font-size: 11px; background: var(--surface-2); color: var(--muted); }
.mc-checks li[data-ok="true"] { color: var(--text); }
.mc-checks li[data-ok="true"] .mc-check { background: var(--green-light); color: var(--green); }
.mc-miniLabel { color: var(--muted); font-size: 12px; }
.mc-miniValue { font: 600 24px/32px "JetBrains Mono", "JetBrains Mono Variable", monospace; letter-spacing: -0.03em; }
.mc-good { color: var(--green); }

.mc-feed {
  margin: 0; padding: 16px; border-radius: 4px; background: var(--surface-2);
  font: 12px/1.6 "JetBrains Mono", "JetBrains Mono Variable", monospace; color: var(--muted);
  white-space: pre-wrap; word-break: break-word; max-height: 420px; overflow: auto;
}
.mc-jKey { color: var(--text); }
.mc-jStr { color: var(--green); }
.mc-jNum { color: var(--amber); }
.mc-jBool { color: var(--focus); }
.mc-jNull { color: var(--muted); font-style: italic; }

@media (max-width: 1100px) {
  .mc-layers { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mc-soFar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mc-soFar > :last-child { grid-column: 1 / -1; }
}
@media (max-width: 900px) {
  .mc-charts, .mc-dataGrid { grid-template-columns: 1fr; }
  .mc-inspGrid { grid-template-columns: 1fr; }
  .mc-sideLayers { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mc-section { margin-top: 64px; }
}
@media (max-width: 767px) {
  .mc-layers, .mc-sideLayers, .mc-soFar { grid-template-columns: 1fr; }
  .mc-slowControls { grid-template-columns: 48px 1fr; }
  .mc-slowControls .segmented { grid-column: 1 / -1; }
  .mc-slowControls input[type="range"] { grid-column: 1 / -1; }
  .mc-changeHead { display: none !important; }
  .mc-changeList li button { grid-template-columns: 64px 1fr; }
  .mc-changeList li button > span:nth-child(n+3) { grid-column: 2; font-size: 13px; color: var(--muted); }
  .mc-controls { grid-template-columns: 48px 1fr; }
  .mc-controls .timecode { grid-column: 1 / -1; white-space: nowrap; }
  .mc-controls input[type="range"] { grid-column: 1 / -1; }
  .mc-stripRow { grid-template-columns: 1fr; gap: 6px; }
  .mc-axis { margin-left: 0; }
  .mc-overlayBL { display: none; }
  .mc-matchClock { text-align: left; }
}
@media (prefers-reduced-motion: reduce) {
  .mc-gaugeFill, .mc-barTrack span, .mc-donutHome { transition: none; }
}
`;
