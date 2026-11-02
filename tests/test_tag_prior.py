"""Synthetic tests for starter/tag_prior.py and tools/tag_agreement.py. No match data."""

import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "starter"))
sys.path.insert(0, os.path.join(ROOT, "evaluation"))
sys.path.insert(0, os.path.join(ROOT, "tools"))

import possession_metrics as pm  # noqa: E402
from live_estimator import run_blocks  # noqa: E402
from postprocess import clean_segments  # noqa: E402
from synthetic_match import AWAY_NAME, HOME_NAME, simulate, simulate_tags  # noqa: E402
from tag_agreement import agreement, verdict  # noqa: E402
from tag_prior import TEAM_BOOST, build_prior, side_of  # noqa: E402


def tag(code, start, stop, team, **extra):
    tags = {"Team": team}
    tags.update(extra)
    return {"code": code, "start_frame": start, "end_frame": stop, "tags": tags}


class SideOf(unittest.TestCase):

    def test_matches_differently_spelled_names(self):
        self.assertEqual(side_of("Barcelona", "FC Barcelona", "Athletic Club"), 0)
        self.assertEqual(side_of("Atletic Club", "FC Barcelona", "Athletic Club"), 1)

    def test_na_is_no_team(self):
        self.assertIsNone(side_of("N/A", "FC Barcelona", "Athletic Club"))
        self.assertIsNone(side_of(None, "FC Barcelona", "Athletic Club"))

    def test_unrecognised_team_is_an_error(self):
        with self.assertRaises(ValueError):
            side_of("Real Madrid", "FC Barcelona", "Athletic Club")


class BuildPrior(unittest.TestCase):

    def test_attacking_defending_conflict_and_case(self):
        events = [
            tag("BUILD UP", 0, 10, "Home"),                       # home attacks -> H
            tag("Defending In Middle Third", 20, 30, "Home"),     # home defends -> A
            tag("PROGRESSION", 40, 50, "Home"),
            tag("PROGRESSION", 45, 50, "Away"),                   # conflict on 45-49
            tag("SET PIECES", 60, 70, "N/A", Type="Throw-in"),    # no team -> nothing
            tag("PLAYERS IN THE BOX", 80, 90, "Away"),
        ]
        prior, summary = build_prior(events, 100, "Home", "Away")
        self.assertTrue((prior[0:10, 0] == TEAM_BOOST).all())
        self.assertTrue((prior[20:30, 1] == TEAM_BOOST).all())
        self.assertTrue((prior[40:45, 0] == TEAM_BOOST).all())
        self.assertTrue((prior[45:50] == 1.0).all())
        self.assertTrue((prior[60:70] == 1.0).all())
        self.assertTrue((prior[80:90, 1] == TEAM_BOOST).all())
        self.assertTrue((prior[:, 2] == 1.0).all())
        self.assertEqual(summary["no_team"], 1)

    def test_goal_to_restart_is_dead(self):
        events = [
            tag("GOALS", 100, 120, "Home"),
            tag("SET PIECES", 400, 500, "Away", Type="Kick Off (After Goal)"),
        ]
        prior, summary = build_prior(events, 600, "Home", "Away", dead_boost=2.0)
        self.assertEqual(summary["goal_stoppages"], 1)
        self.assertTrue((prior[120:400, 2] == 2.0).all())
        self.assertTrue((prior[120:400, :2] == 1.0).all())
        self.assertEqual(prior[400, 2], 1.0)

    def test_goal_without_a_near_restart_is_ignored(self):
        events = [tag("GOALS", 0, 10, "Home"),
                  tag("SET PIECES", 9000, 9100, "Away", Type="Kick Off (After Goal)")]
        _, summary = build_prior(events, 10000, "Home", "Away", max_goal_stop_s=60)
        self.assertEqual(summary["goal_stoppages"], 0)

    def test_tags_outside_the_video_are_clipped(self):
        prior, _ = build_prior([tag("BUILD UP", 90, 500, "Home")], 100, "Home", "Away")
        self.assertEqual(prior.shape, (100, 3))
        self.assertTrue((prior[90:, 0] == TEAM_BOOST).all())


class Agreement(unittest.TestCase):

    def test_counts_and_verdict(self):
        gt = pm.label_codes(np.array(list("HHHHAAAADDXX")))
        prior = np.ones((12, 3))
        prior[0:4, 0] = 1.1   # right
        prior[4:6, 0] = 1.1   # wrong
        prior[8:10, 1] = 1.1  # dead ball
        prior[10:12, 1] = 1.1 # ungraded, ignored
        stats = agreement(prior, gt)
        self.assertEqual((stats["covered"], stats["right"], stats["wrong"]), (8, 4, 2))
        self.assertEqual(stats["dead_while_covered"], 2)
        share, text = verdict(stats)
        self.assertAlmostEqual(share, 4 / 6.0)
        self.assertIn("mixed", text)


class EndToEnd(unittest.TestCase):

    def test_realistic_tags_do_not_hurt_and_flags_wire_through(self):
        n = 10 * 60 * 25
        match = simulate(n, seed=61)
        gt = pm.label_codes(match.labels)
        runs = pm.valid_runs(gt)
        blocks = [(1, 0, n - 1)]
        prior, summary = build_prior(simulate_tags(match.labels, seed=161), n, HOME_NAME,
                                     AWAY_NAME)
        self.assertGreater(summary["used"], 10)

        def spell(prior):
            frames = ((t, match.players[t], match.ball[t]) for t in range(n))
            labels = run_blocks(frames, blocks, n, match.teams, match.pitch, offline=True,
                                prior=prior)
            return pm.spell_scores(gt, pm.label_codes(clean_segments(labels, blocks)),
                                   runs)["mean_f1"]

        without, with_tags = spell(None), spell(prior)
        print("\n      synthetic  offline+clean spellF1 {:.4f} without tags, {:.4f} with".format(
            without, with_tags))
        self.assertGreater(with_tags, without - 0.03)


if __name__ == "__main__":
    unittest.main()
