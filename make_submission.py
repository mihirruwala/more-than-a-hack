"""Regenerate Team MSN's Phase 1 submission from the match data.

    pip install -r requirements-submission.txt
    python3 make_submission.py

Needs data/tactical/BAR-ATH_tactical_atd.xml and .txt (see DATA.md). Writes
evaluation/results/Team_MSN.csv, checks it with the official validator and prints its SHA-256,
so two runs can be compared byte for byte.

The pipeline, with every setting spelled out here rather than taken from module defaults, so a
later change to a default cannot quietly change the submission:

  1. starter/live_estimator.py, offline: Kalman ball filter + sticky H/A/D HMM, smoothed over
     each whole half, per-frame evidence raised to POWER. The evidence itself (control radius,
     dead-ball speed term, hidden-ball cap, ...) uses the constants at the top of that module.
  2. starter/postprocess.clean_segments with MIN_SPELL / MAX_GAP
  3. frames outside both halves are X

No Smart Tagging, no homography, no video, and nothing read from any ground truth.
"""

import argparse
import hashlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "starter"))
sys.path.insert(0, os.path.join(HERE, "evaluation"))

TEAM_NAME = "Team_MSN"
POWER = 0.25      # evidence power, chosen on simulated matches
MIN_SPELL = 25    # frames: spells shorter than 1 s are folded into their neighbours
MAX_GAP = 75      # frames: D/X gaps up to 3 s inside one team's spell are bridged


def build_labels(frames, blocks, n_frames, teams, pitch):
    """The submission labels for a stream of (video_frame, players, ball) tracking frames."""
    from live_estimator import run_blocks
    from postprocess import clean_segments

    labels = run_blocks(frames, blocks, n_frames, teams, pitch, offline=True,
                        evidence_power=POWER, prior=None)
    return clean_segments(labels, blocks, min_spell=MIN_SPELL, max_gap=MAX_GAP)


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", default=os.path.join(HERE, "evaluation", "results",
                                                      TEAM_NAME + ".csv"))
    args = parser.parse_args(argv)

    import possession_metrics as pm
    from baseline import team_of_each_track, write_submission
    from games import GAME, GAMES, half_video_blocks, require, source_frames
    from live_estimator import read_atd_frames

    meta_path, raw_path = require(["atd_meta", "atd_raw"], GAME)
    teams = team_of_each_track(meta_path)
    pitch = GAMES[GAME]["pitch"]
    n_frames = source_frames("tactical", GAME)

    print("reading {} ...".format(os.path.basename(raw_path)))
    labels = build_labels(read_atd_frames(raw_path, len(teams), pitch),
                          half_video_blocks(GAME), n_frames, teams, pitch)
    path = write_submission(args.out, labels)

    problem = pm.validate_submission(pm.read_label_csv(path), n_frames)
    if problem:
        raise SystemExit("INVALID {}: {}".format(path, problem))
    print("wrote {}  (valid)".format(path))
    print("sha256 {}".format(sha256_of(path)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
