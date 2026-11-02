"""make_submission.build_labels on simulated tracking. No match data."""

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
from baseline import write_submission  # noqa: E402
from make_submission import build_labels, sha256_of  # noqa: E402
from synthetic_match import simulate  # noqa: E402


class BuildLabels(unittest.TestCase):

    def test_same_input_gives_byte_identical_files(self):
        n = 4000
        match = simulate(n, seed=71)
        blocks = [(1, 200, 1899), (2, 2100, 3799)]

        def run(folder, name):
            frames = ((t, match.players[t], match.ball[t]) for t in range(n))
            labels = build_labels(frames, blocks, n, match.teams, match.pitch)
            return write_submission(os.path.join(folder, name), labels)

        with tempfile.TemporaryDirectory() as folder:
            first, second = run(folder, "a.csv"), run(folder, "b.csv")
            self.assertEqual(sha256_of(first), sha256_of(second))
            frame = pm.read_label_csv(first)
            self.assertIsNone(pm.validate_submission(frame, n))
            labels = frame["label"].values
            self.assertTrue((labels[:200] == "X").all())
            self.assertTrue((labels[1900:2100] == "X").all())
            self.assertTrue(set(labels[200:1900]) <= set("HAD"))


if __name__ == "__main__":
    unittest.main()
