"""Possession-segment cleanup: turn a flickering per-frame signal back into whole possessions.

The board ranks on spellF1, which scores each possession as one object. Two kinds of damage cost
it the most, and neither shows up much in macroF1:

  1. A possession split by a gap. The ball is lost behind a crowd for two seconds, the signal
     says D, and one true possession becomes two predicted ones: a miss plus two spurious
     spells, each of which may also fail the IoU test against the truth.
  2. A micro-spell. A deflection or a loose ball near an opponent flips the label for a handful
     of frames, inventing a possession that never happened and cutting its neighbour in half.

clean_segments() repairs both, inside each half separately, and nothing else. Clusters of
micro-spells are treated as one stretch, so flicker cannot fuse into a fake possession. It sees only
labels, with no tracking and no ground truth, so it can sit after any per-frame model.

    from postprocess import clean_segments
    labels = clean_segments(labels)              # an array of "H" / "A" / "D" / "X"

numpy only, like baseline.py.

The defaults are football priors, not fitted values: a real possession lasts longer than a
second, and a ball out of play for under three seconds is almost always an occlusion rather than
a stoppage. They are deliberately not tuned against the public five minutes. RULES.md and
EVALUATION.md explain why that would pick the wrong values anyway.
"""

import heapq
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
from games import GAME, half_video_blocks  # noqa: E402

# Params
# Frames at 25 fps. A team spell shorter than MIN_SPELL is absorbed; a D/X gap of at most MAX_GAP
# frames with the same team on both sides is bridged.
MIN_SPELL = 25   # 1 s
MAX_GAP = 75     # 3 s
# Frames a restart is moved earlier by lead_restarts: 0.5 s. Our estimate ends a stoppage only
# once players speed up again, a median 1.3 s after the restart on Metrica and 0.4 s on
# simulated matches (docs/VALIDATION.md, section 3). Half a second helped on both; a whole
# second already hurt on simulations.
RESTART_LEAD = 12

H, A, D, X = 0, 1, 2, 3
LABELS = np.array(["H", "A", "D", "X"])
TEAMS = (H, A)


def clean_segments(labels, blocks=None, min_spell=MIN_SPELL, max_gap=MAX_GAP):
    """A cleaned copy of `labels`: short gaps bridged, micro-spells absorbed, per half.

    `blocks` is [(half, first_frame, last_frame)] with both ends inclusive, the format of
    games.half_video_blocks, which is the default. Frames outside every block are returned
    untouched, and nothing is ever merged across a block boundary. The halftime hole must not
    join the last possession of one half to the first of the next.

    The two repairs feed each other (absorbing a blip can leave a short gap between two spells of
    the same team), so they alternate until neither changes anything. Both only ever merge runs,
    so the loop terminates, and the result is a fixed point: cleaning it again is a no-op.
    """
    codes = to_codes(labels)
    if blocks is None:
        blocks = half_video_blocks(GAME)

    for _, first, last in blocks:
        runs = run_lengths(codes[first:last + 1])
        while True:
            n_before = len(runs)
            runs = bridge_gaps(runs, max_gap)
            runs = absorb_short_spells(absorb_noisy_stretches(runs, min_spell), min_spell)
            if len(runs) == n_before:
                break
        codes[first:last + 1] = np.repeat([code for code, _ in runs],
                                          [length for _, length in runs])
    return LABELS[codes]


def lead_restarts(labels, blocks=None, frames=RESTART_LEAD):
    """A copy of `labels` with every restart moved up to `frames` earlier, per half.

    A restart is a D run followed by a team run. The last `frames` frames of the D run (all of it,
    if shorter) go to the team that restarts. Nothing else changes, and nothing crosses a block
    boundary. Run it after clean_segments, which is what we validated.
    """
    out = np.array(labels, dtype="<U1").copy()
    if blocks is None:
        blocks = half_video_blocks(GAME)
    for _, first, last in blocks:
        seg = out[first:last + 1]
        starts = np.flatnonzero((seg[1:] != "D") & (seg[1:] != "X") & (seg[:-1] == "D")) + 1
        for t in starts:
            lo = t
            while lo > 0 and t - lo < frames and seg[lo - 1] == "D":
                lo -= 1
            seg[lo:t] = seg[t]
    return out


def to_codes(labels):
    """Label strings to 0..3, tolerant of case and whitespace like the scorer."""
    values = np.array([str(v).strip().upper() for v in labels], dtype=object)
    codes = np.full(len(values), -1, dtype=np.int8)
    for index, name in enumerate(LABELS):
        codes[values == name] = index
    if (codes < 0).any():
        raise ValueError("labels outside {}: {}".format(
            list(LABELS), sorted(set(values[codes < 0]))[:5]))
    return codes


def run_lengths(codes):
    """[(code, length)] maximal constant runs."""
    if not len(codes):
        return []
    breaks = np.flatnonzero(codes[1:] != codes[:-1]) + 1
    bounds = np.concatenate(([0], breaks, [len(codes)]))
    return [(int(codes[bounds[i]]), int(bounds[i + 1] - bounds[i]))
            for i in range(len(bounds) - 1)]


def merge_adjacent(runs):
    """Join neighbouring runs that now share a code."""
    out = []
    for code, length in runs:
        if out and out[-1][0] == code:
            out[-1] = (code, out[-1][1] + length)
        else:
            out.append((code, length))
    return out


def bridge_gaps(runs, max_gap):
    """Relabel a D/X run of at most `max_gap` frames as the team holding the ball either side.

    Only when both sides are the same team. A gap between two different teams is a real hand-over
    whose exact frame is unknown, and guessing it here would just move the error around.
    """
    out = list(runs)
    for i in range(1, len(out) - 1):
        code, length = out[i]
        if code in TEAMS or length > max_gap:
            continue
        before, after = out[i - 1][0], out[i + 1][0]
        if before in TEAMS and before == after:
            out[i] = (before, length)
    return merge_adjacent(out)


def absorb_noisy_stretches(runs, min_spell):
    """Relabel a stretch of consecutive sub-`min_spell` team runs as the team enclosing it.

    Flicker clusters: 'H ... A9 H2 A12 H2 A13 ... H' is one H possession with a contested ball in
    the middle. Handled one run at a time, shortest first, the 2-frame H pieces go first and the A
    blips fuse into a 38-frame spell that clears the threshold, a possession invented from
    noise. Taken as a stretch, it is enclosed by H on both sides and goes to H whole.

    Only when both enclosing runs are the same team; anything else is left to
    absorb_short_spells, which decides run by run.
    """
    out, i = [], 0
    while i < len(runs):
        j = i
        while j < len(runs) and runs[j][0] in TEAMS and runs[j][1] < min_spell:
            j += 1
        if j == i:
            out.append(runs[i])
            i += 1
            continue
        before = out[-1][0] if out else None
        after = runs[j][0] if j < len(runs) else None
        if before in TEAMS and before == after:
            out.append((before, sum(length for _, length in runs[i:j])))
        else:
            out.extend(runs[i:j])
        i = j
    return merge_adjacent(out)


def absorb_short_spells(runs, min_spell):
    """Relabel every H/A run shorter than `min_spell` as one of its neighbours, shortest first.

    Which neighbour:
      - the other team on both sides (or on the only side, at a block edge) -> the other team.
        The blip was a touch, not a possession.
      - a D on either side -> D. A sub-second spell against a stoppage is the tracker catching the
        ball around a restart, and extending the stoppage moves no true possession boundary.
      - otherwise the other team, if it is on one side.
      - X on every side -> left alone; there is nothing to merge it into.

    Shortest first, ties to the earliest, so the order cannot depend on anything but the input.
    A doubly-linked list plus a heap with lazy invalidation keeps it O(n log n): a raw per-frame
    signal over a full match has tens of thousands of runs.
    """
    n = len(runs)
    code = [c for c, _ in runs]
    length = [size for _, size in runs]
    start = np.concatenate(([0], np.cumsum(length)[:-1])).tolist() if n else []
    prev = list(range(-1, n - 1))
    nxt = list(range(1, n + 1))
    if n:
        nxt[-1] = -1
    alive = [True] * n

    heap = [(length[i], start[i], i) for i in range(n)
            if code[i] in TEAMS and length[i] < min_spell]
    heapq.heapify(heap)

    while heap:
        size, _, i = heapq.heappop(heap)
        if not alive[i] or length[i] != size:
            continue  # stale entry: merged away, or grown since it was pushed

        other = A if code[i] == H else H
        sides = [code[j] for j in (prev[i], nxt[i]) if j >= 0]
        if sides and all(c == other for c in sides):
            new = other
        elif D in sides:
            new = D
        elif other in sides:
            new = other
        else:
            continue

        code[i] = new
        for j in (prev[i], nxt[i]):
            if j < 0 or code[j] != new:
                continue
            # Fold neighbour j into i, keeping the earlier start.
            length[i] += length[j]
            start[i] = min(start[i], start[j])
            alive[j] = False
            if j == prev[i]:
                prev[i] = prev[j]
                if prev[j] >= 0:
                    nxt[prev[j]] = i
            else:
                nxt[i] = nxt[j]
                if nxt[j] >= 0:
                    prev[nxt[j]] = i
        if new in TEAMS and length[i] < min_spell:
            heapq.heappush(heap, (length[i], start[i], i))

    # The head may have been folded into its successor, so find it rather than assume run 0.
    out = []
    i = next((k for k in range(n) if alive[k] and prev[k] < 0), -1)
    while i >= 0:
        out.append((code[i], length[i]))
        i = nxt[i]
    return out
