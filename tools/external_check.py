"""Score our pipeline on matches other than the competition game (Metrica Sports sample data).

    python3 tools/external_check.py [--games 1 2] [--dir external/metrica]

The public 5 minutes of BAR-ATH are not a tuning set (RULES.md section 2), so this is where our
settings get checked against real football. Nothing here reads data/ or any BAR-ATH file.

Data: https://github.com/metrica-sports/sample-data (anonymised, 25 fps tracking + events).
Download Sample_Game_N_RawTrackingData_{Home,Away}_Team.csv and Sample_Game_N_RawEventsData.csv
into external/metrica/ (gitignored).

Reference labels are rebuilt from the Metrica events to follow CHALLENGE.md:
  * D from the end of the last live action before a restart (set piece or goal kick) until the
    restart; from a foul, from the foul itself. Frames before each period's kick-off are D too.
  * otherwise the team of the last on-ball action (pass, shot, recovery, set piece, ball lost,
    ball out). Challenges don't move possession, so a loose ball stays with the last team until
    the other side records a recovery or a pass.
These are an approximation of the competition's tracking-derived ground truth, not a copy of it:
treat differences between settings as evidence, not the absolute numbers.

Each game is also run a second time with the ball hidden in bursts on about 40% of frames
(more often when the ball is dead), the way the BAR-ATH tracking loses it.
"""

import argparse
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for sub in ("", "starter", "evaluation"):
    sys.path.insert(0, os.path.join(ROOT, sub))

import possession_metrics as pm                                    # noqa: E402
from baseline import smooth                                        # noqa: E402
from live_estimator import LiveEstimator, PossessionHMM, forward_backward, STATE_LABELS  # noqa
from postprocess import clean_segments                             # noqa: E402

PITCH = (105.0, 68.0)
FPS = 25
HOME, AWAY = 0, 1

ON_BALL = {"PASS", "SET PIECE", "SHOT", "RECOVERY", "BALL LOST", "BALL OUT"}
POWERS = (0.1, 0.15, 0.25, 0.5, 1.0)
CLEANS = ((25, 75), (25, 125), (50, 75), (50, 125))
SUBMISSION = (0.15, 25, 75)  # make_submission.py: POWER, MIN_SPELL, MAX_GAP (plus RESTART_LEAD,
                             # which this table leaves out; tools/validation_report.py includes it)


# -- loading -------------------------------------------------------------------------------------

def read_tracking(path):
    """(periods (n,), frames (n,) 0-based, players (n, k, 2) metres, ball (n, 2) metres)."""
    data = np.genfromtxt(path, delimiter=",", skip_header=3, dtype=float)
    periods = data[:, 0].astype(int)
    frames = data[:, 1].astype(int) - 1
    xy = data[:, 3:]
    if np.isnan(xy[:, -1]).all() and xy.shape[1] % 2:  # trailing comma
        xy = xy[:, :-1]
    xy = xy.reshape(len(data), -1, 2) * np.array(PITCH)
    return periods, frames, xy[:, :-1], xy[:, -1]


def read_events(path):
    rows = []
    with open(path) as handle:
        header = handle.readline().strip().split(",")
        for line in handle:
            values = line.rstrip("\n").split(",")
            rows.append(dict(zip(header, values)))
    for r in rows:
        r["start"] = int(r["Start Frame"]) - 1
        end = int(r["End Frame"] or 0)
        r["end"] = max(end - 1, r["start"])
        r["team"] = HOME if r["Team"] == "Home" else AWAY
    rows.sort(key=lambda r: (r["start"], r["end"]))
    return rows


def is_restart(r):
    return r["Type"] == "SET PIECE" or r["Subtype"].startswith("GOAL KICK") and \
        r["Type"] in ("PASS", "BALL LOST")


def is_foul(r):
    return r["Type"] == "FAULT RECEIVED" or (
        r["Type"] == "CHALLENGE" and "FAULT" in r["Subtype"] and "ADVANTAGE" not in r["Subtype"])


def reference_labels(events, n_frames, blocks):
    """H/A/D per frame from the event stream (see module docstring); X outside the periods."""
    labels = np.full(n_frames, "X", dtype="<U1")
    for _, first, last in blocks:
        labels[first:last + 1] = "D"

    team = None
    live_from = None
    previous = None   # last live action before the current one: where a stoppage would begin
    foul_at = None

    def paint(lo, hi, value):
        if hi > lo:
            labels[lo:hi] = np.where(labels[lo:hi] == "X", "X", value)

    cursor = 0
    for r in events:
        if r["Type"] == "CARD":
            continue
        if is_restart(r):
            if live_from is not None and team is not None:
                stop = foul_at if foul_at is not None else (previous["end"] if previous else r["start"])
                stop = min(max(stop, cursor), r["start"])
                paint(cursor, stop, "H" if team == HOME else "A")
            # [stop, restart) stays D
            team, live_from, cursor, foul_at = r["team"], r["start"], r["start"], None
            previous = r
            continue
        if live_from is None:
            continue
        if is_foul(r):
            if foul_at is None:
                foul_at = r["start"]
            continue
        if r["Type"] in ON_BALL and r["team"] != team:
            paint(cursor, r["start"], "H" if team == HOME else "A")
            team, cursor = r["team"], r["start"]
        previous = r
    # the final stretch of each period ends with the period
    return _close_periods(labels, events, blocks, team, cursor)


def _close_periods(labels, events, blocks, team, cursor):
    # Possession runs to the last live action of the match; a half that ends mid-play is handled
    # by the next kick-off restart above, which closes the previous stretch at its last action.
    last_end = max(r["end"] for r in events if r["Type"] not in ("CARD",))
    if team is not None and last_end > cursor:
        seg = labels[cursor:last_end]
        labels[cursor:last_end] = np.where(seg == "X", "X", "H" if team == HOME else "A")
    return labels


# -- the pipeline on Metrica tracking --------------------------------------------------------------

def hide_ball(ball, labels, seed, fraction=0.4, mean_seconds=1.5):
    """synthetic_match._observe's ball dropout, applied to real tracking."""
    rng = np.random.RandomState(seed)
    out = ball.copy()
    p_off = 1.0 / (mean_seconds * FPS)
    p_on = fraction / (1.0 - fraction) * p_off * 0.8
    hidden = False
    for t in range(len(out)):
        on = p_on * (3.0 if labels[t] == "D" else 1.0)
        hidden = (rng.rand() > p_off) if hidden else (rng.rand() < on)
        if hidden:
            out[t] = np.nan
    return out


def raw_likelihoods(frames, players, ball, teams, blocks):
    """Per-block (frame indices, (n, 3) likelihoods) at evidence power 1."""
    est = LiveEstimator(teams, pitch=PITCH, fps=FPS, lag=0, evidence_power=1.0)
    out = []
    for _, first, last in blocks:
        est.reset()
        keep = (frames >= first) & (frames <= last)
        idx, liks = [], []
        for t in np.flatnonzero(keep):
            b = None if np.isnan(ball[t]).any() else (float(ball[t, 0]), float(ball[t, 1]))
            est.push(int(frames[t]), players[t], b)
            idx.append(int(frames[t]))
            liks.append(est.last_likelihood)
        out.append((np.asarray(idx), np.asarray(liks, float)))
    return out


def hmm_labels(per_block, power, n_frames):
    T = PossessionHMM().T
    labels = np.full(n_frames, "X", dtype="<U1")
    for idx, lik in per_block:
        post = forward_backward(lik ** power, T)
        labels[idx] = np.array(STATE_LABELS)[post.argmax(axis=1)]
    return labels


def nearest_codes(frames, players, ball, teams, n_frames):
    out = np.full(n_frames, -1, dtype=np.int8)
    d = np.linalg.norm(players - ball[:, None, :], axis=2)
    ok = ~np.isnan(d).all(axis=1)
    best = np.nanargmin(np.where(np.isnan(d), np.inf, d)[ok], axis=1)
    out[frames[ok]] = teams[best]
    return out


# -- scoring ---------------------------------------------------------------------------------------

def score(gt_codes, runs, labels):
    codes = pm.label_codes(labels)
    spell = pm.spell_scores(gt_codes, codes, runs)
    macro = pm.macro_f1(pm.scored_confusion(pm.confusion(gt_codes, codes)))
    return spell["mean_f1"], macro, spell["n_pred"]


def run_game(folder, game, seed):
    prefix = os.path.join(folder, "Sample_Game_{}_".format(game))
    periods, frames, home, ball = read_tracking(prefix + "RawTrackingData_Home_Team.csv")
    _, frames_a, away, _ = read_tracking(prefix + "RawTrackingData_Away_Team.csv")
    assert (frames == frames_a).all(), "home/away tracking frames differ"
    players = np.concatenate([home, away], axis=1)
    teams = np.array([HOME] * home.shape[1] + [AWAY] * away.shape[1], dtype=np.int8)
    n_frames = int(frames.max()) + 1
    blocks = [(int(p), int(frames[periods == p].min()), int(frames[periods == p].max()))
              for p in np.unique(periods)]
    runs = [(first, last + 1) for _, first, last in blocks]  # halves never merge

    gt = reference_labels(read_events(prefix + "RawEventsData.csv"), n_frames, blocks)
    gt_codes = pm.label_codes(gt)
    n_true = len(pm.possession_spells(gt_codes, runs))
    dead = (gt[gt != "X"] == "D").mean()

    results = {}
    for variant, b in (("full ball", ball), ("ball hidden 40%", hide_ball(ball, gt, seed))):
        rows = []
        near = nearest_codes(frames, players, b, teams, n_frames)
        for w in (25, 50, 125):
            lab = smooth(near, w)
            lab[gt == "X"] = "X"
            rows.append(("baseline_smooth{}".format(w), score(gt_codes, runs, lab)))
        per_block = raw_likelihoods(frames, players, b, teams, blocks)
        for p in POWERS:
            lab = hmm_labels(per_block, p, n_frames)
            rows.append(("hmm p{}".format(p), score(gt_codes, runs, lab)))
            for ms, mg in CLEANS:
                tag = " <- submission" if (p, ms, mg) == SUBMISSION else ""
                rows.append(("hmm p{} clean{}/{}{}".format(p, ms, mg, tag),
                             score(gt_codes, runs, clean_segments(lab, blocks, ms, mg))))
        results[variant] = rows
    print("game {}: {} frames, {} reference possessions, {:.0%} of graded frames dead, "
          "ball NaN on {:.0%} of tracked frames".format(
              game, len(frames), n_true, dead, np.isnan(ball[:, 0]).mean()))
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--games", type=int, nargs="+", default=[1, 2])
    parser.add_argument("--dir", default=os.path.join(ROOT, "external", "metrica"))
    args = parser.parse_args(argv)

    per_game = [run_game(args.dir, g, seed=g) for g in args.games]
    for variant in per_game[0]:
        print("\n== {} ==  (spellF1 / macroF1 / predicted possessions per game, then mean)".format(
            variant))
        names = [name for name, _ in per_game[0][variant]]
        table = []
        for i, name in enumerate(names):
            vals = [res[variant][i][1] for res in per_game]
            table.append((np.mean([v[0] for v in vals]), np.mean([v[1] for v in vals]), name, vals))
        table.sort(key=lambda r: -r[0])
        for spell, macro, name, vals in table:
            cells = "  ".join("{:.3f}/{:.3f}/{:>4}".format(*v) for v in vals)
            print("{:<38} {}   mean {:.3f} / {:.3f}".format(name, cells, spell, macro))
    return 0


if __name__ == "__main__":
    sys.exit(main())
