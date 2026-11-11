"""Grid-search dead-ball evidence on matches other than BAR-ATH: Metrica samples + simulations.

    python3 tools/dead_ball_study.py

Runs the live_estimator once per match to record each frame's raw evidence (team control,
fastest-tenth player speed, still ball, hidden time, ball out), then rebuilds the likelihood for
every candidate setting and scores it with the official metric functions. Nothing reads data/.

Settings explored (see live_estimator._likelihood for the current rule):
  gain / mid  dead += gain * sigmoid((mid - p90 speed) / SPEED_WIDTH), replacing the 0.25 step
  unseen      the bonus for "ball unseen > 2 s while players are slow" (0.4 today). Metrica
              loses the ball mostly when it is dead; BAR-ATH mostly in live play (DATA.md), so a
              setting that only wins through this term would not carry over.
  cap         team control from a ball we cannot see is capped at this (None = no cap)
"""

import itertools
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for sub in ("", "starter", "evaluation", "tools"):
    sys.path.insert(0, os.path.join(ROOT, sub))

import external_check as ec                                        # noqa: E402
import live_estimator as le                                        # noqa: E402
import possession_metrics as pm                                    # noqa: E402
from postprocess import clean_segments                             # noqa: E402
from synthetic_match import simulate                               # noqa: E402

CACHE = os.path.join(ROOT, "external", "cache")
SPEED_WIDTH = 0.4
POWER = 0.25
SIM_SEEDS = (101, 102, 103)  # held out: never used to choose anything before
SIM_MINUTES = 20


class Recorder(le.LiveEstimator):
    """LiveEstimator that also records the ingredients of each frame's likelihood."""

    def reset(self):
        super(Recorder, self).reset()
        self.features = []

    def _likelihood(self, players, speeds, seen):
        out = super(Recorder, self)._likelihood(players, speeds, seen)
        position = self.ball.position
        if position is None:
            self.features.append((0, 0, 0, 0, np.nan, 0, 0, 0))
            return out
        finite = speeds[np.isfinite(speeds)]
        p90 = float(np.percentile(finite, 90)) if len(finite) >= 6 else np.nan
        length, width = self.pitch
        x, y = position
        m = le.OUT_MARGIN
        outside = (x < -m or x > length + m or y < -m or y > width + m) and self.ball.sigma < 3.0
        distance = np.linalg.norm(players - position, axis=1)
        nobody = not np.any(distance[~np.isnan(distance)] < le.CONTROL_RADIUS * 0.6)
        still = seen and float(np.linalg.norm(self.ball.velocity)) < le.STILL_BALL and nobody
        unseen_long = self.hidden_frames > le.HIDDEN_LONG * self.fps
        self.features.append((1, out[0] - le.FLOOR, out[1] - le.FLOOR, float(seen), p90,
                              float(outside), float(still), float(unseen_long)))
        return out


def record(frames_iter, blocks, teams, pitch):
    """[(frame idx, (n, 8) features)] per block."""
    est = Recorder(teams, pitch=pitch, lag=0, evidence_power=1.0)
    out = []
    by_block = {}
    for frame, players, ball in frames_iter:
        k = next((i for i, (_, a, b) in enumerate(blocks) if a <= frame <= b), None)
        if k is None:
            continue
        by_block.setdefault(k, []).append((frame, players, ball))
    for k in sorted(by_block):
        est.reset()
        idx = []
        for frame, players, ball in by_block[k]:
            est.push(frame, players, ball)
            idx.append(frame)
        out.append((np.asarray(idx), np.asarray(est.features, float)))
    return out


def likelihood(f, gain, mid, unseen, cap):
    has, c0, c1, seen, p90, outside, still, longh = f.T
    if cap is not None:
        hidden = seen == 0
        c0 = np.where(hidden, np.minimum(c0, cap), c0)
        c1 = np.where(hidden, np.minimum(c1, cap), c1)
    slow = np.nan_to_num(p90, nan=99) < le.SLOW_PLAYERS
    dead = le.DEAD_FLOOR + 3.0 * outside
    if gain is None:   # today's rule
        dead = dead + slow * (0.25 + 0.6 * still + unseen * longh)
    else:
        s = 1.0 / (1.0 + np.exp(-(mid - np.nan_to_num(p90, nan=mid)) / SPEED_WIDTH))
        dead = dead + gain * s + slow * (0.6 * still + unseen * longh)
    lik = np.stack([le.FLOOR + c0, le.FLOOR + c1, dead], axis=1)
    lik[has == 0] = 1.0
    return lik


def labels_for(per_block, n_frames, params, T):
    labels = np.full(n_frames, "X", dtype="<U1")
    for idx, f in per_block:
        post = le.forward_backward(likelihood(f, *params) ** POWER, T)
        labels[idx] = np.array(le.STATE_LABELS)[post.argmax(axis=1)]
    return labels


# -- the matches -----------------------------------------------------------------------------------

def metrica_matches():
    for game in (1, 2):
        prefix = os.path.join(ROOT, "external", "metrica", "Sample_Game_{}_".format(game))
        periods, frames, home, ball = ec.read_tracking(prefix + "RawTrackingData_Home_Team.csv")
        _, _, away, _ = ec.read_tracking(prefix + "RawTrackingData_Away_Team.csv")
        players = np.concatenate([home, away], axis=1)
        teams = np.array([0] * home.shape[1] + [1] * away.shape[1], dtype=np.int8)
        n = int(frames.max()) + 1
        blocks = [(int(p), int(frames[periods == p].min()), int(frames[periods == p].max()))
                  for p in np.unique(periods)]
        gt = ec.reference_labels(ec.read_events(prefix + "RawEventsData.csv"), n, blocks)
        runs = [(a, b + 1) for _, a, b in blocks]
        for variant, b in (("full", ball), ("hid40", ec.hide_ball(ball, gt, game))):
            yield ("metrica{} {}".format(game, variant), gt, runs, blocks, n,
                   lambda b=b: ((int(frames[t]), players[t],
                                 None if np.isnan(b[t]).any() else tuple(b[t]))
                                for t in range(len(frames))),
                   teams, ec.PITCH)


def sim_matches():
    for seed in SIM_SEEDS:
        n = SIM_MINUTES * 60 * 25
        m = simulate(n, seed=seed)
        blocks = [(1, 0, n - 1)]
        yield ("sim{}".format(seed), m.labels, [(0, n)], blocks, n,
               lambda m=m: ((t, m.players[t],
                             None if np.isnan(m.ball[t]).any() else tuple(m.ball[t]))
                            for t in range(n)),
               m.teams, m.pitch)


def load(name, frames_fn, blocks, teams, pitch):
    path = os.path.join(CACHE, name.replace(" ", "_") + ".npz")
    if os.path.exists(path):
        z = np.load(path, allow_pickle=True)
        return list(z["blocks"])
    per_block = record(frames_fn(), blocks, teams, pitch)
    os.makedirs(CACHE, exist_ok=True)
    arr = np.empty(len(per_block), dtype=object)
    arr[:] = per_block
    np.savez(path, blocks=arr)
    return per_block


def main():
    matches = []
    for name, gt, runs, blocks, n, frames_fn, teams, pitch in \
            itertools.chain(metrica_matches(), sim_matches()):
        print("recording", name, flush=True)
        matches.append((name, pm.label_codes(gt), runs, blocks, n,
                        load(name, frames_fn, blocks, teams, pitch)))

    T = le.PossessionHMM().T
    grid = [(None, None, 0.4, None), (None, None, 0.0, None)]
    for gain, mid, unseen, cap in itertools.product((0.5, 1.0, 2.0), (2.0, 2.5),
                                                    (0.4, 0.0), (None, 0.5, 0.25)):
        grid.append((gain, mid, unseen, cap))
    for unseen, cap in itertools.product((0.4, 0.0), (0.5, 0.25)):
        grid.append((None, None, unseen, cap))

    names = [m[0] for m in matches]
    rows = []
    for params in grid:
        cells = []
        for name, gt, runs, blocks, n, per_block in matches:
            lab = labels_for(per_block, n, params, T)
            for clean in (False, True):
                l2 = clean_segments(lab, blocks, 25, 75) if clean else lab
                codes = pm.label_codes(l2)
                spell = pm.spell_scores(gt, codes, runs)["mean_f1"]
                cm = pm.scored_confusion(pm.confusion(gt, codes))
                d_rec = cm[2, 2] / max(cm[2].sum(), 1)
                cells.append((spell, pm.macro_f1(cm), d_rec))
        rows.append((params, np.array(cells).reshape(len(matches), 2, 3)))

    def fmt(p):
        gain, mid, unseen, cap = p
        g = "old step" if gain is None else "gain{} mid{}".format(gain, mid)
        return "{:<17} unseen{:<3} cap{}".format(g, unseen, cap)

    for clean in (0, 1):
        print("\n== {} ==   spellF1 per match | Metrica mean, sim mean | Metrica D recall".format(
            "with clean25/75" if clean else "no clean"))
        print("{:<36} ".format("") + " ".join("{:>11}".format(n[:11]) for n in names))
        ordered = sorted(rows, key=lambda r: -(r[1][:4, clean, 0].mean() + r[1][4:, clean, 0].mean()))
        for params, c in ordered:
            print("{:<36} ".format(fmt(params)) +
                  " ".join("{:>11.3f}".format(v) for v in c[:, clean, 0]) +
                  "  | {:.3f} {:.3f} | D {:.2f}".format(c[:4, clean, 0].mean(), c[4:, clean, 0].mean(),
                                                     c[:4, clean, 2].mean()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
