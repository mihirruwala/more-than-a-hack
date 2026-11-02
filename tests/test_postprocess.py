"""Synthetic tests for starter/postprocess.py. No match data, no ground truth file.

    python -m unittest discover -s tests -v

The end-to-end test scores with the official possession_metrics, unmodified, so "spellF1 went up"
means exactly what the scorer would mean by it.
"""

import os
import sys
import tempfile
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "starter"))
sys.path.insert(0, os.path.join(ROOT, "evaluation"))

import possession_metrics as pm  # noqa: E402
from games import GAME, GAMES, half_video_blocks  # noqa: E402
from postprocess import clean_segments  # noqa: E402


def seq(*parts):
    """seq(("H", 100), ("D", 30)) -> array of 130 labels."""
    return np.array([label for label, count in parts for _ in range(count)], dtype="<U1")


def whole(labels):
    """One block covering the whole array, in half_video_blocks format."""
    return [(1, 0, len(labels) - 1)]


def spells(labels):
    codes = pm.label_codes(labels)
    return pm.possession_spells(codes, [(0, len(codes))])


class BridgeGaps(unittest.TestCase):

    def test_short_gap_inside_possession_is_bridged(self):
        labels = seq(("H", 100), ("D", 30), ("H", 100))
        out = clean_segments(labels, whole(labels))
        self.assertTrue((out == "H").all())

    def test_x_gap_is_bridged_too(self):
        labels = seq(("A", 100), ("X", 40), ("A", 100))
        self.assertTrue((clean_segments(labels, whole(labels)) == "A").all())

    def test_long_gap_is_a_stoppage(self):
        labels = seq(("H", 100), ("D", 76), ("H", 100))
        np.testing.assert_array_equal(clean_segments(labels, whole(labels)), labels)

    def test_gap_between_different_teams_is_kept(self):
        labels = seq(("H", 100), ("D", 30), ("A", 100))
        np.testing.assert_array_equal(clean_segments(labels, whole(labels)), labels)


class AbsorbShortSpells(unittest.TestCase):

    def test_blip_inside_opponent_possession(self):
        labels = seq(("A", 200), ("H", 5), ("A", 200))
        out = clean_segments(labels, whole(labels))
        self.assertTrue((out == "A").all())
        self.assertEqual(len(spells(out)), 1)

    def test_short_spell_against_stoppage_becomes_dead(self):
        labels = seq(("D", 200), ("H", 10), ("A", 200))
        np.testing.assert_array_equal(clean_segments(labels, whole(labels)),
                                      seq(("D", 210), ("A", 200)))

    def test_real_possession_is_kept(self):
        labels = seq(("A", 200), ("H", 25), ("A", 200))
        np.testing.assert_array_equal(clean_segments(labels, whole(labels)), labels)

    def test_flicker_collapses(self):
        # H A H A ... in 3-frame pieces between two long spells: all noise.
        flicker = [("H" if i % 2 else "A", 3) for i in range(10)]
        labels = seq(("H", 200), *flicker, ("A", 200))
        out = clean_segments(labels, whole(labels))
        self.assertEqual([k for _, _, k in spells(out)], [pm.H, pm.A])

    def test_flicker_cluster_does_not_fuse_into_a_spell(self):
        # Shortest-first alone would drop the H2s and fuse the A blips into 38 frames.
        labels = seq(("H", 70), ("A", 9), ("H", 2), ("A", 12), ("H", 2), ("A", 13), ("H", 77))
        self.assertTrue((clean_segments(labels, whole(labels)) == "H").all())

    def test_absorb_then_bridge(self):
        # Absorbing the A blip leaves H | 30 D | H, which the next pass bridges.
        labels = seq(("H", 100), ("D", 10), ("A", 10), ("D", 10), ("H", 100))
        self.assertTrue((clean_segments(labels, whole(labels)) == "H").all())

    def test_spell_surrounded_by_x_is_left_alone(self):
        labels = seq(("X", 50), ("H", 5), ("X", 50))
        np.testing.assert_array_equal(clean_segments(labels, whole(labels)), labels)

    def test_head_run_absorbed(self):
        labels = seq(("H", 3), ("A", 100))
        self.assertTrue((clean_segments(labels, whole(labels)) == "A").all())


class Blocks(unittest.TestCase):

    def test_no_bridging_across_a_block_boundary(self):
        labels = seq(("H", 100), ("D", 20), ("H", 100))
        out = clean_segments(labels, [(1, 0, 109), (2, 110, 219)])
        np.testing.assert_array_equal(out, labels)

    def test_frames_outside_blocks_untouched(self):
        labels = seq(("A", 10), ("H", 3), ("A", 10), ("H", 100), ("D", 5), ("H", 100))
        out = clean_segments(labels, [(1, 23, len(labels) - 1)])
        np.testing.assert_array_equal(out[:23], labels[:23])
        self.assertTrue((out[23:] == "H").all())


class Properties(unittest.TestCase):

    def test_idempotent_length_and_alphabet(self):
        rng = np.random.RandomState(0)
        labels = np.array(["H", "A", "D", "X"])[rng.randint(0, 4, 5000)]
        once = clean_segments(labels, whole(labels))
        np.testing.assert_array_equal(clean_segments(once, whole(once)), once)
        self.assertEqual(len(once), len(labels))
        self.assertTrue(set(once) <= {"H", "A", "D", "X"})

    def test_accepts_scorer_tolerant_labels(self):
        labels = np.array([" h", "H", "a "] + ["H"] * 50)
        self.assertTrue((clean_segments(labels, whole(labels)) == "H").all())


def synthetic_match(rng, n_frames):
    """(gt, pred): a plausible possession sequence and a fragmented copy of it.

    The truth alternates teams with spells of 4-24 s and stoppages of 8-20 s. The prediction
    adds the two kinds of damage clean_segments targets: occlusion gaps and opponent blips, kept
    clear of the true boundaries so the test measures the repair and not boundary luck.
    """
    gt = np.full(n_frames, "X", dtype="<U1")
    position, team = 0, "H"
    while position < n_frames:
        size = rng.randint(100, 600)
        gt[position:position + size] = team
        position += size
        if rng.rand() < 0.3:
            stop = rng.randint(200, 500)
            gt[position:position + stop] = "D"
            position += stop
        team = "A" if team == "H" else "H"

    pred = gt.copy()
    for start, stop, code in spells(gt):
        if stop - start < 150:
            continue
        for _ in range(rng.randint(1, 4)):
            at = rng.randint(start + 40, stop - 80)
            if rng.rand() < 0.5:
                pred[at:at + rng.randint(10, 60)] = "D"
            else:
                pred[at:at + rng.randint(2, 15)] = "A" if code == pm.H else "H"
    return gt, pred


class EndToEnd(unittest.TestCase):

    def test_spell_f1_improves_on_fragmented_prediction(self):
        rng = np.random.RandomState(7)
        gt, pred = synthetic_match(rng, 30000)
        blocks = whole(gt)
        cleaned = clean_segments(pred, blocks)

        gt_codes = pm.label_codes(gt)
        runs = pm.valid_runs(gt_codes)
        before = pm.spell_scores(gt_codes, pm.label_codes(pred), runs)
        after = pm.spell_scores(gt_codes, pm.label_codes(cleaned), runs)
        print("\n      synthetic spellF1  before {:.4f} ({} spells)  after {:.4f} ({} spells)"
              "  truth {} spells".format(before["mean_f1"], before["n_pred"],
                                         after["mean_f1"], after["n_pred"], before["n_gt"]))
        self.assertGreater(after["mean_f1"], before["mean_f1"] + 0.2)
        self.assertGreater(after["mean_f1"], 0.95)

    def test_full_length_output_passes_official_validation(self):
        n_rows = GAMES[GAME]["n_video_frames"]
        rng = np.random.RandomState(3)
        labels = np.full(n_rows, "X", dtype="<U1")
        for _, first, last in half_video_blocks(GAME):
            _, half = synthetic_match(rng, last - first + 1)
            labels[first:last + 1] = half
        cleaned = clean_segments(labels)

        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "synthetic.csv")
            with open(path, "w") as handle:
                handle.write("frame,label\n")
                handle.writelines("{},{}\n".format(i, v) for i, v in enumerate(cleaned))
            self.assertIsNone(pm.validate_submission(pm.read_label_csv(path), n_rows))


if __name__ == "__main__":
    unittest.main()
