"""How far can the Smart Tagging be trusted? Compare its team evidence with the public ground truth.

Read-only, local-only. It builds the same per-frame evidence the estimator would use with --tags
(starter/tag_prior.build_prior) and, on the graded frames of the public five minutes, reports
how often the side a tag supports is the side in possession. It prints percentages and counts,
never a frame, a position or a label.

    python3 tools/tag_agreement.py

How to read it. The simulator suggests the tags help when their team agrees with the truth on
roughly 80% or more of the frames they cover, and start to cost below roughly 65%. Five minutes is
a small sample, so treat the number as a rough regime, not a setting to tune: it decides whether
--tags is worth a run at all, and nothing else.
"""

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "starter"))
sys.path.insert(0, os.path.join(ROOT, "evaluation"))

import possession_metrics as pm  # noqa: E402
from games import GAME, require, source_frames  # noqa: E402
from run_evaluation import find_gt  # noqa: E402


def _norm(value):
    return " ".join(str(value or "").strip().lower().split())


def _groups():
    from tag_prior import ATTACKING, DEFENDING, SET_PIECES
    return (
        ("attacking phases", lambda code, e: code in ATTACKING),
        ("defending phases", lambda code, e: code in DEFENDING and code != "defensive transition"),
        ("defensive transition", lambda code, e: code == "defensive transition"),
        ("set pieces (with a team)", lambda code, e: code == SET_PIECES),
    )


def agreement(prior, gt_codes):
    """Counts of graded frames, by what the tag evidence says and what the truth is."""
    graded = gt_codes != pm.X
    says_home = (prior[:, 0] > 1) & graded
    says_away = (prior[:, 1] > 1) & graded
    says_dead = (prior[:, 2] > 1) & graded
    covered = says_home | says_away
    right = (says_home & (gt_codes == pm.H)) | (says_away & (gt_codes == pm.A))
    wrong = (says_home & (gt_codes == pm.A)) | (says_away & (gt_codes == pm.H))
    return {
        "graded": int(graded.sum()),
        "covered": int(covered.sum()),
        "right": int(right.sum()),
        "wrong": int(wrong.sum()),
        "dead_while_covered": int((covered & (gt_codes == pm.D)).sum()),
        "says_dead": int(says_dead.sum()),
        "says_dead_right": int((says_dead & (gt_codes == pm.D)).sum()),
    }


def verdict(stats):
    alive = stats["right"] + stats["wrong"]
    if alive == 0:
        return None, "no tagged frame is graded and live; nothing to judge"
    share = stats["right"] / float(alive)
    if share >= 0.80:
        return share, "good -- run with --tags and compare"
    if share >= 0.65:
        return share, "mixed -- --tags is unlikely to help much; worth one run at most"
    return share, "poor -- leave --tags off"


def main():
    import load_smart_tagging
    from baseline import team_names
    from tag_prior import build_prior

    meta_path = require(["atd_meta"], GAME)[0]
    n_frames = source_frames("tactical", GAME)
    events = load_smart_tagging.load()
    if not load_smart_tagging.check_time_base(events)["agrees"]:
        raise SystemExit("time base mismatch; run python3 starter/load_smart_tagging.py")
    home, away = team_names(meta_path)
    prior, _ = build_prior(events, n_frames, home, away)
    gt_codes = pm.label_codes(pm.read_label_csv(find_gt("public")))

    stats = agreement(prior, gt_codes)
    alive = stats["right"] + stats["wrong"]
    print("public ground truth: {graded} graded frames; tags give a team on {covered} of them"
          .format(**stats))
    if alive:
        print("  where the truth is a team, the tagged team is right on {:.0%} ({} of {})".format(
            stats["right"] / float(alive), stats["right"], alive))
    if stats["covered"]:
        print("  {:.0%} of tagged frames are actually dead ball".format(
            stats["dead_while_covered"] / float(stats["covered"])))
    if stats["says_dead"]:
        print("  goal stoppages: {} graded frames, {:.0%} truly dead".format(
            stats["says_dead"], stats["says_dead_right"] / float(stats["says_dead"])))
    share, text = verdict(stats)
    print("verdict: {}".format(text))

    # The same check per kind of tag, each read on its own. A kind far below the others, or
    # far below 50%, means that kind is being read the wrong way round, not that it is noisy.
    print("\nby kind of tag (each kind alone; where the truth is a team):")
    for name, keep in _groups():
        subset = [e for e in events if keep(_norm(e.get("code")), e)]
        part = agreement(build_prior(subset, n_frames, home, away)[0], gt_codes)
        alive = part["right"] + part["wrong"]
        if alive:
            print("  {:<28} right on {:>4.0%}  ({} of {} frames)".format(
                name, part["right"] / float(alive), part["right"], alive))
        else:
            print("  {:<28} no graded live frames".format(name))


if __name__ == "__main__":
    main()
