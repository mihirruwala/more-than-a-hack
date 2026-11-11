"""Synthetic tests for starter/live_estimator.py and starter/synthetic_match.py.

    python -m unittest discover -s tests -v

No match data and no ground-truth file: every input is either hand-built or simulated. The
end-to-end tests score with the official possession_metrics, unmodified.
"""

import json
import os
import sys
import tempfile
import time
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "starter"))
sys.path.insert(0, os.path.join(ROOT, "evaluation"))

import possession_metrics as pm  # noqa: E402
from baseline import smooth  # noqa: E402
from live_estimator import (BallFilter, LiveEstimator, PossessionHMM, ReplayRecorder,  # noqa: E402
                            _nearest_team, forward_backward, read_atd_frames, run_blocks)
from synthetic_match import simulate  # noqa: E402

PITCH = (105.3, 68.0)


def straight_line(n, start=(20.0, 30.0), velocity=(10.0, 0.0), fps=25):
    t = np.arange(n)[:, None] / float(fps)
    return np.asarray(start) + t * np.asarray(velocity)


class BallFilterTests(unittest.TestCase):

    def test_tracks_and_coasts_through_a_gap(self):
        f = BallFilter()
        path = straight_line(60)
        for t in range(40):
            f.step(path[t])
        for t in range(40, 50):  # hidden for 0.4 s
            f.step(None)
        self.assertLess(np.linalg.norm(f.position - path[49]), 1.0)
        self.assertGreater(f.sigma, 0.3)  # uncertainty grew while unseen

    def test_follows_carrier_when_hidden(self):
        f = BallFilter()
        for t in range(10):
            f.step((50.0, 30.0))
        carrier = straight_line(50, start=(50.0, 30.0), velocity=(0.0, 5.0))
        for t in range(50):
            f.step(None, carrier=carrier[t])
        self.assertLess(np.linalg.norm(f.position - carrier[-1]), 1.5)

    def test_single_outlier_rejected_then_persistent_jump_accepted(self):
        f = BallFilter()
        for _ in range(20):
            f.step((30.0, 30.0))
        self.assertFalse(f.step((80.0, 10.0)))
        self.assertLess(np.linalg.norm(f.position - (30.0, 30.0)), 1.0)
        f.step((80.0, 10.0))
        self.assertTrue(f.step((80.0, 10.0)))  # third in a row: the ball really is there
        self.assertLess(np.linalg.norm(f.position - (80.0, 10.0)), 1.0)

    def test_covariance_stays_valid(self):
        rng = np.random.RandomState(0)
        f = BallFilter()
        for _ in range(5000):
            z = None if rng.rand() < 0.4 else rng.uniform(0, 100, 2)
            carrier = rng.uniform(0, 100, 2) if rng.rand() < 0.3 else None
            f.step(z, carrier)
            self.assertTrue(np.isfinite(f.sigma))
            self.assertGreater(np.linalg.eigvalsh(f.P).min(), -1e-9)


class PossessionHMMTests(unittest.TestCase):

    def test_lag_zero_answers_every_frame(self):
        hmm = PossessionHMM(lag=0)
        for _ in range(10):
            self.assertEqual(len(hmm.push((1.0, 0.1, 0.1))), 1)
        self.assertEqual(hmm.flush(), [])

    def test_lag_delays_and_flush_drains(self):
        hmm = PossessionHMM(lag=5)
        out = [hmm.push((1.0, 0.1, 0.1)) for _ in range(12)]
        self.assertEqual([len(o) for o in out], [0] * 5 + [1] * 7)
        self.assertEqual(len(hmm.flush()), 5)

    def test_one_contrary_frame_does_not_flip(self):
        hmm = PossessionHMM(lag=0)
        for _ in range(50):
            hmm.push((1.0, 0.08, 0.03))
        posterior = hmm.push((0.08, 1.0, 0.03))[0]
        self.assertGreater(posterior[0], posterior[1])

    def test_sustained_evidence_flips(self):
        hmm = PossessionHMM(lag=0)
        for _ in range(50):
            hmm.push((1.0, 0.08, 0.03))
        for _ in range(15):
            posterior = hmm.push((0.08, 1.0, 0.03))[0]
        self.assertGreater(posterior[1], posterior[0])

    def test_hindsight_moves_the_switch_earlier(self):
        evidence = [(1.0, 0.08, 0.03)] * 60 + [(0.08, 1.0, 0.03)] * 60

        def first_away(lag):
            hmm, posts = PossessionHMM(lag=lag), []
            for lik in evidence:
                posts.extend(hmm.push(lik))
            posts.extend(hmm.flush())
            return next(i for i, p in enumerate(posts) if p[1] > p[0])

        self.assertGreater(first_away(0), 60)          # the filter needs a few frames
        self.assertLessEqual(abs(first_away(25) - 60), 1)  # the smoother finds the real switch


class LiveEstimatorTests(unittest.TestCase):

    def setUp(self):
        self.teams = np.array([0, 1])

    def test_hidden_dribble_stays_with_the_carrier(self):
        est = LiveEstimator(self.teams, PITCH, lag=0)
        carrier = straight_line(100, start=(40.0, 30.0), velocity=(5.0, 0.0))
        defender = np.array([[70.0, 50.0]] * 100)
        out = []
        for t in range(100):
            players = np.stack([carrier[t], defender[t]])
            ball = carrier[t] + (0.6, 0.0) if t < 30 else None  # hidden after 1.2 s
            out.extend(est.push(t, players, ball))
        self.assertTrue(all(e.label == "H" for e in out[20:]))
        last = out[-1]
        self.assertLess(np.hypot(last.ball_x - carrier[-1][0], last.ball_y - carrier[-1][1]), 2.0)
        self.assertFalse(last.ball_visible)

    def test_ball_out_of_play_is_dead(self):
        est = LiveEstimator(self.teams, PITCH, lag=0)
        players = np.array([[50.0, 66.0], [60.0, 40.0]])
        out = []
        for t in range(40):
            out.extend(est.push(t, players, (50.0, 30.0 + t)))  # rolls over the touchline at 68
        for t in range(40, 80):
            out.extend(est.push(t, players, (50.0, 71.0)))
        self.assertEqual(out[-1].label, "D")

    def _squad(self, n, speed, rng):
        """12 players (6 a side) jogging along x at `speed` m/s; slot 0 is the home carrier."""
        start = np.column_stack([np.linspace(20, 80, 12), rng.uniform(10, 58, 12)])
        t = np.arange(n)[:, None, None] / 25.0
        return start[None] + t * np.array([speed, 0.0]) + rng.normal(0, 0.05, (n, 12, 2))

    def test_stoppage_with_hidden_ball_is_dead(self):
        # Everyone stands around and the ball disappears next to a home player: the hidden
        # ball's guessed position must not outvote a stoppage.
        rng = np.random.RandomState(0)
        teams = np.array([0] * 6 + [1] * 6)
        players = self._squad(200, 0.0, rng)
        est = LiveEstimator(teams, PITCH, lag=0)
        out = []
        for t in range(200):
            ball = players[t, 0] + (0.5, 0.0) if t < 25 else None
            out.extend(est.push(t, players[t], ball))
        self.assertEqual(out[-1].label, "D")

    def test_hidden_ball_in_open_play_stays_with_the_team(self):
        # Same scene at a run (4 m/s): an occlusion in play, not a stoppage.
        rng = np.random.RandomState(0)
        teams = np.array([0] * 6 + [1] * 6)
        players = self._squad(200, 4.0, rng)
        est = LiveEstimator(teams, PITCH, lag=0)
        out = []
        for t in range(200):
            ball = players[t, 0] + (0.5, 0.0) if t < 25 else None
            out.extend(est.push(t, players[t], ball))
        self.assertTrue(all(e.label == "H" for e in out[25:]))

    def test_no_ball_no_players_does_not_crash(self):
        est = LiveEstimator(self.teams, PITCH, lag=3)
        nan = np.full((2, 2), np.nan)
        out = []
        for t in range(10):
            out.extend(est.push(t, nan, None))
        out.extend(est.flush())
        self.assertEqual([e.frame for e in out], list(range(10)))
        self.assertTrue(all(e.label in "HAD" for e in out))


class Harness(unittest.TestCase):

    def test_blocks_x_outside_and_every_frame_answered(self):
        match = simulate(800, seed=4)
        frames = ((t, match.players[t], match.ball[t]) for t in range(800))
        labels = run_blocks(frames, [(1, 100, 349), (2, 400, 699)], 800, match.teams,
                            match.pitch, lag=25)
        self.assertTrue((labels[:100] == "X").all())
        self.assertTrue((labels[350:400] == "X").all())
        self.assertTrue((labels[700:] == "X").all())
        self.assertTrue(set(labels[100:350]) <= set("HAD"))
        self.assertTrue(set(labels[400:700]) <= set("HAD"))

    def test_output_passes_official_validation(self):
        match = simulate(1000, seed=5)
        frames = ((t, match.players[t], match.ball[t]) for t in range(1000))
        labels = run_blocks(frames, [(1, 0, 999)], 1000, match.teams, match.pitch, lag=10)
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "live.csv")
            with open(path, "w") as handle:
                handle.write("frame,label\n")
                handle.writelines("{},{}\n".format(i, v) for i, v in enumerate(labels))
            self.assertIsNone(pm.validate_submission(pm.read_label_csv(path), 1000))

    def test_atd_reader_parses_the_baseline_line_format(self):
        lines = ["1:0.5,0.5,1.2;NaN,NaN,NaN:0.25,0.75,3.0\n",
                 "2:0.1,0.2,0.0;0.9,0.8,0.0:NaN,NaN,NaN\n"]
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "fake_atd.txt")
            with open(path, "w") as handle:
                handle.writelines(lines)
            rows = list(read_atd_frames(path, 2, (100.0, 50.0)))
        self.assertEqual([r[0] for r in rows], [0, 1])  # ids count from 1, frames from 0
        np.testing.assert_allclose(rows[0][1][0], (50.0, 25.0))
        self.assertTrue(np.isnan(rows[0][1][1]).all())
        self.assertEqual(rows[0][2], (25.0, 37.5))
        self.assertIsNone(rows[1][2])


class EvidencePower(unittest.TestCase):

    def test_discounting_evidence_reduces_fragmentation(self):
        n = 8 * 60 * 25
        match = simulate(n, seed=31)
        gt = pm.label_codes(match.labels)
        runs = pm.valid_runs(gt)

        def possessions(power):
            frames = ((t, match.players[t], match.ball[t]) for t in range(n))
            labels = run_blocks(frames, [(1, 0, n - 1)], n, match.teams, match.pitch, lag=25,
                                evidence_power=power)
            return len(pm.possession_spells(pm.label_codes(labels), runs))

        self.assertLess(possessions(0.25), possessions(1.0))


class Offline(unittest.TestCase):

    def test_forward_backward_equals_a_lag_covering_the_whole_block(self):
        rng = np.random.RandomState(1)
        liks = [tuple(rng.uniform(0.05, 1.0, 3)) for _ in range(60)]
        hmm = PossessionHMM(lag=60)
        for lik in liks:
            hmm.push(lik)
        fixed_lag = np.array(hmm.flush())
        np.testing.assert_allclose(forward_backward(liks, hmm.T), fixed_lag, atol=1e-9)

    def test_offline_labels_every_block_frame_and_resets_per_block(self):
        match = simulate(900, seed=8)
        frames = ((t, match.players[t], match.ball[t]) for t in range(900))
        labels = run_blocks(frames, [(1, 50, 399), (2, 500, 849)], 900, match.teams,
                            match.pitch, offline=True)
        self.assertTrue((labels[:50] == "X").all())
        self.assertTrue((labels[400:500] == "X").all())
        self.assertTrue((labels[850:] == "X").all())
        self.assertTrue(set(labels[50:400]) | set(labels[500:850]) <= set("HAD"))


class Replay(unittest.TestCase):

    def test_window_straddling_kickoff_marks_unanswered_frames_x(self):
        # Regression: a window starting 10 frames before the half crashed the writer.
        match = simulate(300, seed=6)
        recorder = ReplayRecorder(40, 100, match.teams, match.pitch, 25, 5, "synthetic", "test")
        frames = recorder.frames((t, match.players[t], match.ball[t]) for t in range(300))
        run_blocks(frames, [(1, 50, 299)], 300, match.teams, match.pitch, lag=5,
                   on_estimate=recorder.estimate)
        with tempfile.TemporaryDirectory() as folder:
            path = recorder.write(os.path.join(folder, "nested", "clip.json"), truth=match.labels)
            with open(path) as handle:
                record = json.load(handle)
        label = record["frames"]["label"]
        self.assertEqual(len(label), 100)
        self.assertEqual(label[:10], "X" * 10)
        self.assertTrue(set(label[10:]) <= set("HAD"))
        self.assertIsNone(record["frames"]["est"][0])
        self.assertEqual(record["frames"]["pHome"][0], 0)

    def test_window_outside_every_half_is_an_error(self):
        match = simulate(200, seed=6)
        recorder = ReplayRecorder(0, 40, match.teams, match.pitch, 25, 0, "synthetic", "test")
        frames = recorder.frames((t, match.players[t], match.ball[t]) for t in range(200))
        run_blocks(frames, [(1, 100, 199)], 200, match.teams, match.pitch,
                   on_estimate=recorder.estimate)
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError):
                recorder.write(os.path.join(folder, "clip.json"))


class Simulator(unittest.TestCase):

    def test_deterministic_and_plausible(self):
        a, b = simulate(3000, seed=9), simulate(3000, seed=9)
        np.testing.assert_array_equal(a.labels, b.labels)
        hidden = np.isnan(a.ball[:, 0]).mean()
        self.assertGreater(hidden, 0.25)
        self.assertLess(hidden, 0.6)
        self.assertTrue(set(a.labels) <= set("HAD"))


class EndToEnd(unittest.TestCase):

    def test_live_with_one_second_lag_beats_offline_baseline(self):
        n = 15 * 60 * 25
        match = simulate(n, seed=3)
        gt = pm.label_codes(match.labels)
        runs = pm.valid_runs(gt)

        started = time.perf_counter()
        frames = ((t, match.players[t], match.ball[t]) for t in range(n))
        live = pm.label_codes(run_blocks(frames, [(1, 0, n - 1)], n, match.teams, match.pitch,
                                         lag=25))
        ms_per_frame = (time.perf_counter() - started) / n * 1000
        base = pm.label_codes(smooth(_nearest_team(match), 50))

        live_spell = pm.spell_scores(gt, live, runs)["mean_f1"]
        base_spell = pm.spell_scores(gt, base, runs)["mean_f1"]
        live_macro = pm.macro_f1(pm.scored_confusion(pm.confusion(gt, live)))
        base_macro = pm.macro_f1(pm.scored_confusion(pm.confusion(gt, base)))
        print("\n      synthetic  live lag25 spellF1 {:.4f} macroF1 {:.4f}  |  baseline_smooth50 "
              "spellF1 {:.4f} macroF1 {:.4f}  |  {:.2f} ms/frame".format(
                  live_spell, live_macro, base_spell, base_macro, ms_per_frame))
        self.assertGreater(live_spell, base_spell)
        self.assertGreater(live_macro, base_macro + 0.1)
        self.assertLess(ms_per_frame, 5.0)  # the real-time budget at 25 fps is 40 ms


if __name__ == "__main__":
    unittest.main()
