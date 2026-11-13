"""Everything we measure away from BAR-ATH, in one run: writes docs/VALIDATION.md.

    python3 tools/validation_report.py            # about 5 minutes the first time, then cached

Matches: Metrica Sports sample games 1 and 2 (as tracked, and with the ball hidden in extra
bursts the way BAR-ATH loses it), plus four simulated matches with seeds 201-204, which nothing
was ever chosen on. Nothing here reads data/ or any BAR-ATH file.

Each match is run through the estimator once to record every frame's raw evidence (the same
cache tools/dead_ball_study.py uses). Every variant below is rebuilt from that record, so a
variant differs from the submission only in the setting named, and all scores come from the
official metric functions in evaluation/possession_metrics.py.

Sections of the report:
  1. the submitted pipeline against the nearest-player baseline, with block-bootstrap intervals
     and a paired bootstrap of the difference
  2. post-processing: lighter and heavier cleanup, each repair on its own
  3. transitions: why transition F1 is low (tolerance, latency, which kinds are missed)
  4. dead ball: precision, recall, false and missed stoppages
  5. short possessions and quick restarts: recall by duration
  6. possession durations, predicted against reference
  7. offline, one-second lag and zero lag
  8. calibration: how often a call made with confidence p is right
  9. parameter sensitivity, one setting at a time
 10. the ball filter: error while the ball is hidden, and how fast it locks back on
 11. ablations: each part of the pipeline taken away in turn

Metrica's reference labels are rebuilt from event logs (tools/external_check.py), so they are an
approximation of the competition's ground truth. Compare settings with them; don't read much
into the absolute numbers.
"""

import datetime
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for sub in ("", "starter", "evaluation", "tools"):
    sys.path.insert(0, os.path.join(ROOT, sub))

import dead_ball_study as dbs                                      # noqa: E402
import external_check as ec                                        # noqa: E402
import live_estimator as le                                        # noqa: E402
import possession_metrics as pm                                    # noqa: E402
from baseline import smooth                                        # noqa: E402
from postprocess import clean_segments                             # noqa: E402
from synthetic_match import simulate                               # noqa: E402

OUT = os.path.join(ROOT, "docs", "VALIDATION.md")
CACHE = dbs.CACHE
FPS = 25
HELD_OUT = (201, 202, 203, 204)   # never used to choose anything
SIM_MINUTES = 20
BOOT = 1000
TOLS = (12, 25, 50, 125)

# The submission, as make_submission.py runs it (see live_estimator for the evidence rule).
SUBMITTED = {
    "power": 0.25, "gain": le.DEAD_SPEED_GAIN, "mid": le.DEAD_SPEED_MID, "unseen": 0.4,
    "cap": le.HIDDEN_CONTROL_CAP, "p_switch": le.P_SWITCH, "p_to_dead": le.P_TO_DEAD,
    "p_from_dead": le.P_FROM_DEAD, "clean": (25, 75), "mode": "offline",
}


# -- matches ---------------------------------------------------------------------------------------

class Match(object):
    def __init__(self, name, group, gt, runs, blocks, n, per_block, baseline, raw=None,
                 recorder=None):
        self.name, self.group = name, group
        self.gt = pm.label_codes(gt)
        self.runs, self.blocks, self.n = runs, blocks, n
        self.per_block = per_block
        self.baseline = baseline  # nearest player, 50-frame vote: the published floor
        self.minutes = float(np.sum(self.gt != pm.X)) / FPS / 60
        # (frames, players, observed ball, true ball, teams, pitch) where the true ball position
        # is known on frames the estimator can't see it: our own extra dropouts, or a simulation.
        self.raw = raw
        # (cache name, frames_fn, teams, pitch): enough to record the evidence again with a part
        # of the estimator switched off.
        self.recorder = recorder


def metrica():
    out = []
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
            name = "metrica{} {}".format(game, variant)
            # Bind this game's arrays now: the function may be called again much later.
            frames_fn = (lambda b=b, frames=frames, players=players: ((int(frames[t]), players[t],
                                       None if np.isnan(b[t]).any() else tuple(b[t]))
                                      for t in range(len(frames))))
            per_block = dbs.load(name, frames_fn, blocks, teams, ec.PITCH)
            base = smooth(ec.nearest_codes(frames, players, b, teams, n), 50)
            base[gt == "X"] = "X"
            label = "Metrica {} ({})".format(game, "as tracked" if variant == "full" else
                                             "extra ball dropouts")
            raw = (frames, players, b, ball, teams, ec.PITCH) if variant == "hid40" else None
            out.append(Match(label, "metrica", gt, runs, blocks, n, per_block, base, raw,
                             (name, frames_fn, teams, ec.PITCH)))
    return out


def sims():
    out = []
    for seed in HELD_OUT:
        n = SIM_MINUTES * 60 * FPS
        m = simulate(n, seed=seed)
        blocks = [(1, 0, n - 1)]
        frames_fn = (lambda m=m: ((t, m.players[t],
                                   None if np.isnan(m.ball[t]).any() else tuple(m.ball[t]))
                                  for t in range(n)))
        per_block = dbs.load("sim{}".format(seed), frames_fn, blocks, m.teams, m.pitch)
        near = np.full(n, -1, dtype=np.int8)
        d = np.linalg.norm(m.players - m.ball[:, None, :], axis=2)
        ok = ~np.isnan(d).all(axis=1)
        near[ok] = m.teams[np.nanargmin(np.where(np.isnan(d), np.inf, d)[ok], axis=1)]
        out.append(Match("simulated, seed {}".format(seed), "sim", m.labels, [(0, n)], blocks, n,
                         per_block, smooth(near, 50),
                         (np.arange(n), m.players, m.ball, m.ball_true, m.teams, m.pitch),
                         ("sim{}".format(seed), frames_fn, m.teams, m.pitch)))
    return out


# -- the pipeline, rebuilt from recorded evidence ---------------------------------------------------

def transition_matrix(c):
    stay = 1.0 - c["p_switch"] - c["p_to_dead"]
    return np.array([[stay, c["p_switch"], c["p_to_dead"]],
                     [c["p_switch"], stay, c["p_to_dead"]],
                     [c["p_from_dead"] / 2, c["p_from_dead"] / 2, 1.0 - c["p_from_dead"]]])


def forward(lik, T):
    n = len(lik)
    alpha = np.empty((n, 3))
    prior = np.full(3, 1.0 / 3)
    for t in range(n):
        a = prior * lik[t]
        s = a.sum()
        a = a / s if s > 0 and np.isfinite(s) else np.full(3, 1.0 / 3)
        alpha[t] = a
        prior = a @ T
    return alpha


def fixed_lag(lik, T, lag):
    """PossessionHMM's fixed-lag smoother for every frame at once: alpha_t times the backward
    message over the next `lag` frames (fewer at the end of a block, as flush() does)."""
    alpha = forward(lik, T)
    if lag == 0:
        return alpha
    n = len(lik)
    beta = np.ones((n, 3))
    for k in range(lag, 0, -1):
        shifted = np.ones((n, 3))
        shifted[:n - k] = lik[k:]
        beta = (shifted * beta) @ T.T
        beta /= beta.sum(axis=1, keepdims=True)
    post = alpha * beta
    return post / post.sum(axis=1, keepdims=True)


def run(match, cfg):
    """(labels, posterior (n, 3) with NaN outside the blocks) for one configuration."""
    T = transition_matrix(cfg)
    labels = np.full(match.n, "X", dtype="<U1")
    post_all = np.full((match.n, 3), np.nan)
    for idx, f in match.per_block:
        lik = dbs.likelihood(f, cfg["gain"], cfg["mid"], cfg["unseen"], cfg["cap"]) ** cfg["power"]
        if cfg["mode"] == "offline":
            post = le.forward_backward(lik, T)
        else:
            post = fixed_lag(lik, T, {"lag25": 25, "lag0": 0}[cfg["mode"]])
        labels[idx] = np.array(le.STATE_LABELS)[post.argmax(axis=1)]
        post_all[idx] = post
    if cfg["clean"]:
        labels = clean_segments(labels, match.blocks, *cfg["clean"])
    return labels, post_all


def variant(**changes):
    c = dict(SUBMITTED)
    c.update(changes)
    return c


# -- measurements ----------------------------------------------------------------------------------

def evaluate(match, labels):
    codes = pm.label_codes(labels)
    return pm.evaluate(match.gt, codes, taus=TOLS), pm.fill_abstentions(codes, pm.valid_runs(match.gt))


def paired_spell_diff(match, codes_a, codes_b, n_draws=BOOT, seed=0):
    """Bootstrap over reference possessions of spellF1(a) - spellF1(b): (mean, low, high, P(<=0))."""
    runs = pm.valid_runs(match.gt)
    gt_spells = pm.possession_spells(match.gt, runs)
    flags, n_pred = [], []
    for codes in (codes_a, codes_b):
        pred = pm.possession_spells(codes, runs)
        ov = pm.spell_overlaps(gt_spells, pred)
        flags.append(np.vstack([pm.matched_gt_flags(ov, len(gt_spells), t) for t in pm.SPELL_IOUS]))
        n_pred.append(len(pred))
    n_gt = len(gt_spells)
    rng = np.random.RandomState(seed)
    diffs = np.empty(n_draws)
    for k in range(n_draws):
        picks = rng.randint(0, n_gt, n_gt)
        vals = []
        for fl, npred in zip(flags, n_pred):
            f1s = []
            for row in fl:
                tp = int(row[picks].sum())
                fp, fn = max(0, npred - tp), n_gt - tp
                f1s.append(2.0 * tp / (2 * tp + fp + fn) if tp else 0.0)
            vals.append(np.mean(f1s))
        diffs[k] = vals[0] - vals[1]
    lo, hi = np.percentile(diffs, (5, 95))
    return float(diffs.mean()), float(lo), float(hi), float(np.mean(diffs <= 0))


def runs_of(codes, runs, code):
    return [(a, b) for a, b, k in pm.segments(codes, runs) if k == code]


def overlap(a, b, spans):
    return sum(max(0, min(b, d) - max(a, c)) for c, d in spans)


def dead_ball(match, codes):
    runs = pm.valid_runs(match.gt)
    gt_d = runs_of(match.gt, runs, pm.D)
    pr_d = runs_of(codes, runs, pm.D)
    false_stops = [(a, b) for a, b in pr_d if b - a >= FPS and overlap(a, b, gt_d) == 0]
    missed = [(a, b) for a, b in gt_d if overlap(a, b, pr_d) == 0]
    found = {}
    for lo, hi, name in ((0, 5, "under 5 s"), (5, 15, "5-15 s"), (15, 1e9, "15 s or more")):
        sel = [(a, b) for a, b in gt_d if lo * FPS <= b - a < hi * FPS]
        hit = [s for s in sel if overlap(s[0], s[1], pr_d) >= 0.5 * (s[1] - s[0])]
        found[name] = (len(hit), len(sel))
    per90 = 90.0 / match.minutes
    return {"false_per90": len(false_stops) * per90, "missed": len(missed), "n_gt": len(gt_d),
            "false_mean_s": np.mean([b - a for a, b in false_stops]) / FPS if false_stops else 0.0,
            "by_length": found}


DURATION_BINS = ((0, 2), (2, 5), (5, 10), (10, 20), (20, 40), (40, 1e9))


def bin_name(lo, hi):
    return "{}+ s".format(lo) if hi > 1e8 else "{}-{} s".format(lo, hi)


def spell_recall_by_length(match, codes, iou=0.5):
    runs = pm.valid_runs(match.gt)
    gt = pm.possession_spells(match.gt, runs)
    pred = pm.possession_spells(codes, runs)
    flags = pm.matched_gt_flags(pm.spell_overlaps(gt, pred), len(gt), iou)
    lengths = np.array([b - a for a, b, _ in gt]) / FPS
    return {bin_name(lo, hi): (int(flags[(lengths >= lo) & (lengths < hi)].sum()),
                               int(((lengths >= lo) & (lengths < hi)).sum()))
            for lo, hi in DURATION_BINS}


def durations(codes, runs):
    return np.array([b - a for a, b, _ in pm.possession_spells(codes, runs)]) / FPS


def transition_kinds(match, result, tol=25):
    """Recall per kind of reference transition, and what the spurious ones are."""
    tr = result["transitions"][tol]
    names = {(pm.H, pm.A): "turnover", (pm.A, pm.H): "turnover", (pm.H, pm.D): "into dead ball",
             (pm.A, pm.D): "into dead ball", (pm.D, pm.H): "restart", (pm.D, pm.A): "restart"}
    hit, total, spur = {}, {}, {}
    for g, _ in tr["pairs"]:
        k = names.get((g[1], g[2]), "other")
        hit[k] = hit.get(k, 0) + 1
    for g in [p[0] for p in tr["pairs"]] + list(tr["missed"]):
        k = names.get((g[1], g[2]), "other")
        total[k] = total.get(k, 0) + 1
    for p in tr["spurious"]:
        k = names.get((p[1], p[2]), "other")
        spur[k] = spur.get(k, 0) + 1
    return hit, total, spur


def calibration(match, post, labels):
    ok = (match.gt != pm.X) & np.isfinite(post).all(axis=1)
    conf = post[ok].max(axis=1)
    correct = pm.label_codes(labels)[ok] == match.gt[ok]
    return conf, correct


def ball_study(match):
    """Per frame: (estimate error vs true ball (m), sigma, seconds since last seen, seen) and the
    reacquisition delay (frames until within 1 m) after every gap of 2 s or more."""
    frames, players, observed, truth, teams, pitch = match.raw
    est = le.LiveEstimator(teams, pitch=pitch, fps=FPS, lag=0)
    errors, sigmas, hidden_for, seen_flags = [], [], [], []
    for _, first, last in match.blocks:
        est.reset()
        since = 0
        for t in np.flatnonzero((frames >= first) & (frames <= last)):
            b = observed[t]
            obs = None if np.isnan(b).any() else (float(b[0]), float(b[1]))
            est.push(int(frames[t]), players[t], obs)
            pos = est.ball.position
            since = 0 if obs is not None else since + 1
            err = np.nan if pos is None or np.isnan(truth[t]).any() else float(np.linalg.norm(pos - truth[t]))
            errors.append(err)
            sigmas.append(est.ball.sigma)
            hidden_for.append(since)
            seen_flags.append(obs is not None)
    errors, sigmas = np.array(errors), np.array(sigmas)
    hidden_for, seen_flags = np.array(hidden_for), np.array(seen_flags)
    delays = []
    gap_end = np.flatnonzero(seen_flags[1:] & (hidden_for[:-1] >= 2 * FPS)) + 1
    for k in gap_end:
        window = errors[k:k + 2 * FPS]
        ok = np.flatnonzero(window < 1.0)
        delays.append(int(ok[0]) if len(ok) else 2 * FPS)
    return errors, sigmas, hidden_for, np.array(delays)


CONF_BINS = ((0.0, 0.6), (0.6, 0.8), (0.8, 0.9), (0.9, 0.95), (0.95, 0.99), (0.99, 1.01))


# -- report ----------------------------------------------------------------------------------------

def fmt(x, d=3):
    return "–" if x is None else ("{:." + str(d) + "f}").format(x)


def table(header, rows):
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def mean_over(matches, group, fn):
    vals = [fn(m) for m in matches if m.group == group]
    return float(np.mean(vals))


def main():
    print("loading matches (the first run records evidence and caches it) ...", flush=True)
    matches = metrica() + sims()
    groups = (("metrica", "Metrica (4 runs)"), ("sim", "held-out simulations (4)"))
    lines = ["# Validation report", "",
             "Generated by `python3 tools/validation_report.py` on {}. Don't edit by hand.".format(
                 datetime.date.today().isoformat()), "",
             "Matches: Metrica Sports sample games 1 and 2, each as tracked and with the ball "
             "hidden in extra bursts on about 40% of frames (the way BAR-ATH loses it), and four "
             "20-minute simulated matches (seeds 201-204) that no setting was ever chosen on. "
             "Nothing here touches BAR-ATH. Metrica's reference labels are rebuilt from event "
             "logs, so they approximate the competition's ground truth: compare settings with "
             "them rather than reading the absolute numbers. Intervals are 5-95% block-bootstrap "
             "intervals over reference possessions (1,000 draws), the method "
             "`evaluation/possession_metrics.py` documents.", ""]

    cache = {}

    def get(match, cfg_key, cfg):
        key = (match.name, cfg_key)
        if key not in cache:
            labels, post = run(match, cfg)
            result, filled = evaluate(match, labels)
            cache[key] = (labels, post, result, filled)
        return cache[key]

    sub = SUBMITTED

    # 1. headline with intervals --------------------------------------------------------------
    print("1. headline and bootstrap", flush=True)
    rows = []
    for m in matches:
        _, _, r, filled = get(m, "submitted", sub)
        base_codes = pm.label_codes(m.baseline)
        base_filled = pm.fill_abstentions(base_codes, pm.valid_runs(m.gt))
        runs = pm.valid_runs(m.gt)
        lo, hi = pm.bootstrap_spell_f1(m.gt, filled, runs, BOOT)
        b_spell = pm.spell_scores(m.gt, base_filled, runs)["mean_f1"]
        blo, bhi = pm.bootstrap_spell_f1(m.gt, base_filled, runs, BOOT)
        mlo, mhi = pm.bootstrap_macro_f1(m.gt, pm.label_codes(cache[(m.name, "submitted")][0]), runs, BOOT)
        diff = paired_spell_diff(m, filled, base_filled)
        rows.append([m.name, "{} [{}, {}]".format(fmt(r["spell_f1_mean"]), fmt(lo), fmt(hi)),
                     "{} [{}, {}]".format(fmt(b_spell), fmt(blo), fmt(bhi)),
                     "{:+.3f} [{:+.3f}, {:+.3f}]".format(diff[0], diff[1], diff[2]),
                     "{} [{}, {}]".format(fmt(r["macro_f1"]), fmt(mlo), fmt(mhi)),
                     "{} / {}".format(r["n_pred_spells"], r["n_gt_spells"])])
    lines += ["## 1. The submitted pipeline, with intervals", "",
              "spellF1 is the ranking metric. The difference column is a paired bootstrap: both "
              "pipelines are scored on the same resampled possessions, so it is much tighter than "
              "comparing the two intervals.", "",
              table(["match", "submitted spellF1", "baseline spellF1", "difference", "submitted macroF1",
                     "possessions (ours / ref)"], rows), ""]

    # 2. post-processing ----------------------------------------------------------------------
    print("2. post-processing", flush=True)
    cleans = [("none", None), ("gap bridging only (3 s)", (0, 75)), ("short-spell removal only (1 s)", (25, 0)),
              ("lighter: 0.5 s / 1.5 s", (12, 37)), ("lighter: 0.5 s / 3 s", (12, 75)),
              ("lighter: 1 s / 1.5 s", (25, 37)), ("**submitted: 1 s / 3 s**", (25, 75)),
              ("heavier: 2 s / 3 s", (50, 75)), ("heavier: 1 s / 5 s", (25, 125))]
    rows = []
    for label, clean in cleans:
        cfg = variant(clean=clean)
        cells = [label]
        for g, _ in groups:
            sel = [m for m in matches if m.group == g]
            res = [get(m, "clean{}".format(clean), cfg)[2] for m in sel]
            cells += [fmt(np.mean([r["spell_f1_mean"] for r in res])),
                      fmt(np.mean([r["transitions"][25]["f1"] for r in res])),
                      "{:.2f}".format(np.mean([r["n_pred_spells"] / float(r["n_gt_spells"]) for r in res]))]
        # paired against the submission on the hardest Metrica runs
        diffs = []
        for m in matches:
            if m.group != "metrica":
                continue
            a = get(m, "clean{}".format(clean), cfg)[3]
            b = get(m, "submitted", sub)[3]
            diffs.append(paired_spell_diff(m, a, b)[1:3])
        cells.append("{} better, {} worse".format(sum(1 for lo, hi in diffs if lo > 0),
                                                  sum(1 for lo, hi in diffs if hi < 0)))
        rows.append(cells)
    lines += ["## 2. Post-processing: lighter and heavier cleanup", "",
              "Mean over each group. 'possessions' is predicted over reference count. The last "
              "column counts Metrica runs where the paired 5-95% interval of the difference from "
              "the submission excludes zero.", "",
              table(["cleanup (min spell / max gap)", "Metrica spellF1", "Metrica transF1@1s",
                     "Metrica possessions", "sim spellF1", "sim transF1@1s", "sim possessions",
                     "vs submitted (Metrica)"], rows), ""]

    # 3. transitions --------------------------------------------------------------------------
    print("3. transitions", flush=True)
    rows = []
    for m in matches:
        r = get(m, "submitted", sub)[2]
        tr = r["transitions"]
        rows.append([m.name] + ["{} ({}/{})".format(fmt(tr[t]["f1"], 2), fmt(tr[t]["precision"], 2),
                                                    fmt(tr[t]["recall"], 2)) for t in TOLS] +
                    [fmt(tr[125]["median_latency"] / FPS if tr[125]["median_latency"] is not None else None, 2),
                     fmt(tr[125]["p90_abs_latency"] / FPS if tr[125]["p90_abs_latency"] is not None else None, 2)])
    kinds = {}
    for m in matches:
        hit, total, spur = transition_kinds(m, get(m, "submitted", sub)[2])
        g = kinds.setdefault(m.group, {})
        for k in set(total) | set(spur):
            h, t, s = g.get(k, (0, 0, 0))
            g[k] = (h + hit.get(k, 0), t + total.get(k, 0), s + spur.get(k, 0))
    lat = {}
    for m in matches:
        tr = get(m, "submitted", sub)[2]["transitions"][125]
        for g_, p_ in tr["pairs"]:
            k = {(pm.H, pm.A): "turnover", (pm.A, pm.H): "turnover", (pm.H, pm.D): "into dead ball",
                 (pm.A, pm.D): "into dead ball", (pm.D, pm.H): "restart", (pm.D, pm.A): "restart"}.get((g_[1], g_[2]))
            if k:
                lat.setdefault((m.group, k), []).append((p_[0] - g_[0]) / float(FPS))
    lrows = []
    for g, gname in groups:
        for k in ("turnover", "into dead ball", "restart"):
            v = np.array(lat.get((g, k), [0.0]))
            lrows.append([gname, k, len(v), "{:+.2f}".format(np.median(v)), "{:.0%}".format(np.mean(v > 0.5)),
                          "{:.0%}".format(np.mean(v < -0.5)), "{:.2f}".format(np.percentile(np.abs(v), 90))])
    krows = []
    for g, gname in groups:
        for k in ("turnover", "into dead ball", "restart"):
            h, t, s = kinds[g].get(k, (0, 0, 0))
            krows.append([gname, k, "{}/{} ({:.0%})".format(h, t, h / float(t) if t else 0), s])
    # no-clean comparison
    nc = [[gname, fmt(mean_over(matches, g, lambda m: get(m, "submitted", sub)[2]["transitions"][25]["f1"]), 2),
           fmt(mean_over(matches, g, lambda m: get(m, "cleanNone", variant(clean=None))[2]["transitions"][25]["f1"]), 2),
           fmt(mean_over(matches, g, lambda m: get(m, "submitted", sub)[2]["transitions"][125]["f1"]), 2)]
          for g, gname in groups]
    lines += ["## 3. Transitions", "",
              "Transition F1 (precision/recall) at four matching tolerances, 0.5 s to 5 s, and the "
              "timing of matched transitions at the loosest tolerance (prediction minus reference, "
              "seconds; positive means late).", "",
              table(["match", "F1 @0.5 s", "F1 @1 s", "F1 @2 s", "F1 @5 s", "median latency (s)",
                     "p90 |latency| (s)"], rows), "",
              "Reference transitions found within 1 s, by kind, and spurious predicted ones of each kind:", "",
              table(["group", "kind", "found within 1 s", "spurious"], krows), "",
              "Timing of the transitions matched within 5 s, by kind (seconds, prediction minus "
              "reference; positive means late):", "",
              table(["group", "kind", "matched", "median", "more than 0.5 s late", "more than 0.5 s early",
                     "p90 |latency|"], lrows), "",
              table(["group", "transF1 @1 s, submitted", "same, no cleanup", "submitted @5 s"], nc), ""]

    # 4. dead ball ----------------------------------------------------------------------------
    print("4. dead ball", flush=True)
    rows = []
    for m in matches:
        r = get(m, "submitted", sub)[2]
        db = dead_ball(m, get(m, "submitted", sub)[3])
        d = r["per_class"]["D"]
        bl = db["by_length"]
        rows.append([m.name, fmt(d["precision"], 2), fmt(d["recall"], 2), fmt(d["f1"], 2),
                     "{:.1f}".format(db["false_per90"]), "{:.1f}".format(db["false_mean_s"]),
                     "{}/{}".format(db["missed"], db["n_gt"])] +
                    ["{}/{}".format(*bl[k]) for k in ("under 5 s", "5-15 s", "15 s or more")])
    lines += ["## 4. Dead ball", "",
              "Frame-level precision and recall of D. A false stoppage is a predicted dead-ball "
              "spell of at least 1 s that overlaps no reference stoppage; rates are per 90 "
              "minutes of graded play. A reference stoppage counts as found when at least half of "
              "it is predicted D.", "",
              table(["match", "D precision", "D recall", "D F1", "false stoppages /90", "their mean length (s)",
                     "stoppages missed entirely", "found: under 5 s", "found: 5-15 s", "found: 15 s+"], rows), ""]

    # 5. short possessions and quick restarts ---------------------------------------------------
    print("5. short possessions", flush=True)
    rows = []
    for g, gname in groups:
        agg = {}
        for m in matches:
            if m.group != g:
                continue
            for k, (h, t) in spell_recall_by_length(m, get(m, "submitted", sub)[3]).items():
                a, b = agg.get(k, (0, 0))
                agg[k] = (a + h, b + t)
        rows.append([gname] + ["{}/{} ({:.0%})".format(h, t, h / float(t) if t else 0)
                               for h, t in (agg[bin_name(lo, hi)] for lo, hi in DURATION_BINS)])
    lines += ["## 5. Short possessions and quick restarts", "",
              "Reference possessions matched at IoU 0.5, by length. Quick restarts are the 'under "
              "5 s' column of section 4.", "",
              table(["group"] + [bin_name(lo, hi) for lo, hi in DURATION_BINS], rows), ""]

    # 6. durations --------------------------------------------------------------------------
    print("6. durations", flush=True)
    rows = []
    for g, gname in groups:
        ref = np.concatenate([durations(m.gt, pm.valid_runs(m.gt)) for m in matches if m.group == g])
        ours = np.concatenate([durations(get(m, "submitted", sub)[3], pm.valid_runs(m.gt))
                               for m in matches if m.group == g])
        base = np.concatenate([durations(pm.fill_abstentions(pm.label_codes(m.baseline), pm.valid_runs(m.gt)),
                                          pm.valid_runs(m.gt)) for m in matches if m.group == g])
        for name, d in (("reference", ref), ("submitted", ours), ("baseline", base)):
            q = np.percentile(d, (10, 25, 50, 75, 90))
            hist = [int(((d >= lo) & (d < hi)).sum()) for lo, hi in DURATION_BINS]
            rows.append([gname, name, len(d)] + ["{:.1f}".format(v) for v in q] + hist)
    lines += ["## 6. Possession durations", "",
              "Possession lengths in seconds, pooled over each group: count, percentiles, then a "
              "histogram.", "",
              table(["group", "labels", "n", "p10", "p25", "median", "p75", "p90"] +
                    [bin_name(lo, hi) for lo, hi in DURATION_BINS], rows), ""]

    # 7. hindsight ----------------------------------------------------------------------------
    print("7. hindsight modes", flush=True)
    modes = (("offline: whole half of hindsight, with cleanup (the submission)", "submitted", sub),
             ("offline, no cleanup", "cleanNone", variant(clean=None)),
             ("fixed lag: 1 s of hindsight (the site's Console)", "lag25", variant(mode="lag25", clean=None)),
             ("zero latency: no hindsight", "lag0", variant(mode="lag0", clean=None)))
    rows = []
    for label, key, cfg in modes:
        cells = [label]
        for g, _ in groups:
            sel = [m for m in matches if m.group == g]
            res = [get(m, key, cfg)[2] for m in sel]
            cells += [fmt(np.mean([r["spell_f1_mean"] for r in res])), fmt(np.mean([r["macro_f1"] for r in res])),
                      fmt(np.mean([r["transitions"][25]["f1"] for r in res]), 2),
                      "{:.2f}".format(np.mean([r["n_pred_spells"] / float(r["n_gt_spells"]) for r in res]))]
        rows.append(cells)
    lines += ["## 7. Offline, fixed-lag and zero-latency", "",
              "The same evidence and model, answering with different amounts of hindsight. Only "
              "the offline mode can use the whole half; a live system must answer with a fixed "
              "delay or none.", "",
              table(["mode", "Metrica spellF1", "Metrica macroF1", "Metrica transF1@1s", "Metrica possessions",
                     "sim spellF1", "sim macroF1", "sim transF1@1s", "sim possessions"], rows), ""]

    # 8. calibration ----------------------------------------------------------------------------
    print("8. calibration", flush=True)
    rows = []
    for label, key, cfg in modes[1:]:
        for g, gname in groups:
            confs, oks = [], []
            for m in matches:
                if m.group != g:
                    continue
                labels, post = get(m, key, cfg)[:2]
                c, ok = calibration(m, post, labels)
                confs.append(c)
                oks.append(ok)
            c, ok = np.concatenate(confs), np.concatenate(oks)
            cells = [label.split(":")[0], gname]
            ece = 0.0
            for lo, hi in CONF_BINS:
                sel = (c >= lo) & (c < hi)
                if sel.any():
                    ece += sel.mean() * abs(ok[sel].mean() - c[sel].mean())
                    cells.append("{:.0%} right ({:.0%} of frames)".format(ok[sel].mean(), sel.mean()))
                else:
                    cells.append("–")
            cells.append("{:.3f}".format(ece))
            rows.append(cells)
    lines += ["## 8. Calibration", "",
              "For frames whose top posterior falls in each band, how often that call matches the "
              "reference, and what share of graded frames the band holds. A calibrated model is "
              "right about as often as it is confident. ECE is the frame-weighted mean gap. "
              "Posteriors before cleanup.", "",
              table(["mode", "matches"] + ["{:.0%}-{:.0%}".format(lo, min(hi, 1)) for lo, hi in CONF_BINS] + ["ECE"],
                    rows), ""]

    # 9. sensitivity ----------------------------------------------------------------------------
    print("9. sensitivity", flush=True)
    sweeps = [("evidence power", "power", (0.15, 0.25, 0.35, 0.5)),
              ("P(team switch) per frame", "p_switch", (0.002, 0.004, 0.008)),
              ("P(play stops) per frame", "p_to_dead", (0.001, 0.002, 0.004)),
              ("P(restart) per frame", "p_from_dead", (0.002, 0.004, 0.008)),
              ("dead-ball speed midpoint (m/s)", "mid", (1.5, 2.0, 2.5)),
              ("dead-ball speed gain", "gain", (0.5, 1.0, 2.0)),
              ("hidden-ball control cap", "cap", (0.1, 0.25, 0.5, None))]
    base_vals = {g: mean_over(matches, g, lambda m: get(m, "submitted", sub)[2]["spell_f1_mean"])
                 for g, _ in groups}
    rows = []
    for label, key, values in sweeps:
        for v in values:
            cfg = variant(**{key: v})
            mark = " (submitted)" if v == SUBMITTED[key] else ""
            cells = [label, "{}{}".format(v, mark)]
            for g, _ in groups:
                val = mean_over(matches, g, lambda m: get(m, "{}={}".format(key, v), cfg)[2]["spell_f1_mean"])
                cells.append("{} ({:+.3f})".format(fmt(val), val - base_vals[g]))
            rows.append(cells)
    lines += ["## 9. Parameter sensitivity", "",
              "One setting at a time, everything else as submitted. spellF1, mean over each group, "
              "and the change from the submission.", "",
              table(["setting", "value", "Metrica spellF1", "sim spellF1"], rows), ""]

    # 10. the ball filter -----------------------------------------------------------------------
    print("10. ball filter", flush=True)
    rows, rrows = [], []
    for g, gname in (("metrica", "Metrica, extra ball dropouts"), ("sim", "held-out simulations (4)")):
        studies = [ball_study(m) for m in matches if m.group == g and m.raw is not None]
        err = np.concatenate([s[0] for s in studies])
        sig = np.concatenate([s[1] for s in studies])
        hid = np.concatenate([s[2] for s in studies]) / float(FPS)
        delays = np.concatenate([s[3] for s in studies])
        for lo, hi in ((0, 0.04), (0.04, 0.5), (0.5, 1), (1, 2), (2, 5), (5, 1e9)):
            sel = (hid >= lo) & (hid < hi) & np.isfinite(err)
            if not sel.any():
                continue
            name = "seen" if lo == 0 else ("{}+ s".format(lo) if hi > 1e8 else "{}-{} s".format(lo, hi))
            rows.append([gname, name, "{:.0%}".format(sel.mean() / np.isfinite(err).mean()),
                         "{:.2f}".format(np.median(err[sel])), "{:.2f}".format(np.percentile(err[sel], 90)),
                         "{:.0%}".format(np.mean(err[sel] <= 2 * sig[sel]))])
        rrows.append([gname, len(delays), "{:.0%}".format(np.mean(delays == 0)),
                      "{:.0%}".format(np.mean(delays <= 2)),
                      "{:.1f}".format(np.median(delays)), "{:.0f}".format(np.percentile(delays, 90))])
    lines += ["## 10. The ball filter: hidden balls and reacquisition", "",
              "Where the estimate is, against the true ball, by how long the tracking has not seen "
              "it. The true position is known here because we hid the ball ourselves (Metrica) or "
              "the simulator records it. 'within 2σ' is how often the error is inside twice the "
              "filter's own stated uncertainty, which the hidden-ball control test relies on.", "",
              table(["matches", "time unseen", "share of frames", "median error (m)", "p90 error (m)",
                     "within 2σ"], rows), "",
              "Reacquisition after gaps of 2 s or more: frames after the ball is seen again until "
              "the estimate is within 1 m of it (25 frames = 1 s; capped at 50).", "",
              table(["matches", "gaps", "within 1 m at once", "within 2 frames", "median frames", "p90 frames"],
                    rrows), ""]

    # 11. ablations --------------------------------------------------------------------------------
    print("11. ablations (records evidence again without velocity matching; cached)", flush=True)
    no_velocity = {}
    saved = le.MATCH_SPEED
    le.MATCH_SPEED = 1e9   # the velocity factor becomes 1 for every player: distance alone decides
    try:
        for m in matches:
            name, frames_fn, teams, pitch = m.recorder
            no_velocity[m.name] = dbs.load("novel_" + name, frames_fn, m.blocks, teams, pitch)
    finally:
        le.MATCH_SPEED = saved
    ablations = [
        ("the submitted pipeline", "submitted", sub, None),
        ("without cleanup", "cleanNone", variant(clean=None), None),
        ("without the evidence discount (power 1)", "power=1.0", variant(power=1.0), None),
        ("without stickiness (every frame decided alone)", "nosticky",
         variant(p_switch=1 / 3.0, p_to_dead=1 / 3.0, p_from_dead=2 / 3.0), None),
        ("without the player-speed stoppage term", "gain=0", variant(gain=0.0), None),
        ("without the hidden-ball control cap", "cap=None", variant(cap=None), None),
        ("without velocity matching", "novelocity", sub, no_velocity),
    ]
    rows = []
    for label, key, cfg, swap in ablations:
        cells = [label]
        for g, _ in groups:
            sel = [m for m in matches if m.group == g]
            res = []
            for m in sel:
                if swap is None:
                    res.append(get(m, key, cfg)[2])
                else:
                    original = m.per_block
                    m.per_block = swap[m.name]
                    try:
                        labels, _ = run(m, cfg)
                    finally:
                        m.per_block = original
                    res.append(evaluate(m, labels)[0])
            cells += [fmt(np.mean([r["spell_f1_mean"] for r in res])), fmt(np.mean([r["macro_f1"] for r in res])),
                      "{:.2f}".format(np.mean([r["n_pred_spells"] / float(r["n_gt_spells"]) for r in res]))]
        rows.append(cells)
    base_cells = ["nearest-player baseline (published floor)"]
    for g, _ in groups:
        res = [pm.evaluate(m.gt, pm.label_codes(m.baseline)) for m in matches if m.group == g]
        base_cells += [fmt(np.mean([r["spell_f1_mean"] for r in res])), fmt(np.mean([r["macro_f1"] for r in res])),
                       "{:.2f}".format(np.mean([r["n_pred_spells"] / float(r["n_gt_spells"]) for r in res]))]
    rows.append(base_cells)
    lines += ["## 11. Ablations", "",
              "Each part of the pipeline taken away in turn, everything else as submitted. Mean "
              "over each group; 'possessions' is predicted over reference count.", "",
              table(["pipeline", "Metrica spellF1", "Metrica macroF1", "Metrica possessions",
                     "sim spellF1", "sim macroF1", "sim possessions"], rows), ""]

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as handle:
        handle.write("\n".join(lines) + "\n")
    print("wrote", os.path.relpath(OUT, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
