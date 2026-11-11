"""Live ball and possession estimation: one frame in, one estimate out.

The baseline decides possession by looking at the whole match at once, with a majority vote over a
window that reaches seconds into the future. This module answers the same question the way a
live system has to: frames arrive one at a time, and each answer may only use what has arrived.

Two parts, wired together by LiveEstimator:

  BallFilter      Where the ball is, including the 41% of frames where the tracking cannot see
                  it. A constant-velocity Kalman filter. While the ball is hidden it either
                  coasts along its last velocity (a pass in flight) or, if the ball was last seen
                  at a player's feet and moving with them, follows that player.

  PossessionHMM   Who has it. A three-state hidden Markov model (H, A, D) with "sticky"
                  transitions: possession rarely changes from one frame to the next, so the model
                  needs several frames of consistent evidence before it switches. Optionally a
                  fixed-lag smoother: answer `lag` frames late, and use those frames of hindsight.

The lag is the real-time trade-off, made explicit. lag=0 answers immediately and flickers more;
lag=25 answers one second late and is much steadier. A broadcast graphic can afford a second.

    est = LiveEstimator(teams, pitch=(105.3, 68.0), lag=25)
    for frame, players, ball in source:           # players (N, 2) metres, NaN = missing
        for estimate in est.push(frame, players, ball):
            print(estimate.frame, estimate.label, estimate.p_home)
    for estimate in est.flush():                  # the last `lag` frames, at end of stream
        ...

Run it:

    python starter/live_estimator.py --synthetic           # simulated match, no data needed
    python starter/live_estimator.py --lag 25              # real match, needs data/tactical/
    python starter/live_estimator.py --lag 25 --clean      # + a cleaned copy for the board
                                                           # (--power 1.0 = no evidence discount)
    python starter/live_estimator.py --lag 25 --replay evaluation/replays/kickoff.json \
        --replay-from 448 --replay-seconds 90               # + a window for the live view

The real-match mode needs the tactical ATD files and writes evaluation/results/live_lag<L>.csv;
it does not read the ground truth. Every threshold below is a football prior. They were chosen on
the simulator, and the dead-ball ones were also checked on two open Metrica matches
(tools/external_check.py, tools/dead_ball_study.py).

numpy only, like baseline.py.
"""

import argparse
import json
import math
import os
import sys
import time
from collections import deque, namedtuple

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "evaluation"))

H, A, D = 0, 1, 2
STATE_LABELS = ("H", "A", "D")

Estimate = namedtuple(
    "Estimate", "frame label p_home p_away p_dead ball_x ball_y ball_sigma ball_visible")

# Params
FPS = 25
CONTROL_RADIUS = 1.6      # m: a player this close to the ball is plausibly playing it
FLOOR = 0.08              # team likelihood when nobody of that team is near the ball
DEAD_FLOOR = 0.03         # dead-ball likelihood with no evidence for a stoppage
OUT_MARGIN = 0.5          # m beyond a line before the ball counts as out
SLOW_PLAYERS = 2.0        # m/s: if even the fastest tenth of players is below this, play has
                          # probably stopped. The median is useless here: in open play most
                          # players are walking or jogging too.
STILL_BALL = 0.6          # m/s: ball speed below this, with nobody on it, looks placed
HIDDEN_LONG = 2.0         # s: ball unseen this long while everyone walks -> probably dead
DEAD_SPEED_GAIN = 1.0     # dead-ball evidence from players slowing down, graded rather than a
DEAD_SPEED_MID = 2.0      # step: gain * sigmoid((mid - fastest-tenth speed) / width), m/s.
DEAD_SPEED_WIDTH = 0.4    # On Metrica games 1-2 the fastest tenth runs a median 1.5 m/s when the
                          # ball is dead and 3.4 m/s in play, independent of whether the ball is
                          # seen. Chosen with tools/dead_ball_study.py on Metrica + simulations.
HIDDEN_CONTROL_CAP = 0.25 # team control from a ball we cannot see is capped at this: a hidden
                          # ball's position is our own guess, so it should not outvote a
                          # stoppage. Cautious end of the plateau, since BAR-ATH loses the ball
                          # mostly in live play (DATA.md).
P_SWITCH = 0.004          # per-frame chance possession changes team
P_TO_DEAD = 0.002         # per-frame chance play stops
P_FROM_DEAD = 0.004       # per-frame chance play restarts
EVIDENCE_POWER = 0.25     # each frame's likelihood is raised to this power before the HMM sees
                          # it. Consecutive frames are nearly the same observation, so counting
                          # each one as independent evidence overstates it; a power below 1
                          # discounts that, and a team switch then needs evidence that persists.
                          # 0.25 sits on a plateau on held-out simulated matches (0.15 is no
                          # better); it was not fitted to the public five minutes.
VELOCITY_SPAN = 5         # frames: player velocity is differenced over this many
MATCH_SPEED = 2.5         # m/s: how far a player's velocity may differ from the ball's and
                          # still count as "moving with it"


class BallFilter(object):
    """Constant-velocity Kalman filter on the ball, in pitch metres.

    step() takes one observation (or None) per frame. While the ball is unobserved, step() can be
    given a carrier position: the player the ball was last seen with. That position is used as a
    weak measurement, so a ball dribbled behind a crowd moves with the dribbler instead of
    drifting off along a stale velocity.
    """

    def __init__(self, fps=FPS, meas_sigma=0.3, accel_sigma=12.0, carrier_sigma=1.2,
                 gate_sigma=6.0, coast_damping=0.97):
        dt = 1.0 / fps
        self.F = np.array([[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]], float)
        q = accel_sigma ** 2
        self.Q = q * np.array([[dt ** 4 / 4, 0, dt ** 3 / 2, 0], [0, dt ** 4 / 4, 0, dt ** 3 / 2],
                               [dt ** 3 / 2, 0, dt ** 2, 0], [0, dt ** 3 / 2, 0, dt ** 2]])
        self.Hm = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], float)
        self.R = np.eye(2) * meas_sigma ** 2
        self.R_carrier = np.eye(2) * carrier_sigma ** 2
        self.gate2 = gate_sigma ** 2
        self.coast_damping = coast_damping
        self.reset()

    def reset(self):
        self.x = None
        self.P = None
        self.rejected = 0
        self.unseen = 0

    @property
    def position(self):
        return None if self.x is None else self.x[:2]

    @property
    def velocity(self):
        return None if self.x is None else self.x[2:]

    @property
    def sigma(self):
        """One-number position uncertainty in metres."""
        return float("inf") if self.P is None else math.sqrt(0.5 * np.trace(self.P[:2, :2]))

    def step(self, z=None, carrier=None):
        """Advance one frame. Returns True if `z` was accepted as a sighting of the ball."""
        if self.x is None:
            if z is None:
                return False
            self.x = np.array([z[0], z[1], 0.0, 0.0])
            self.P = np.diag([self.R[0, 0], self.R[1, 1], 25.0, 25.0])
            return True

        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + self.Q

        if z is not None:
            innovation = np.asarray(z, float) - self.x[:2]
            S = self.P[:2, :2] + self.R
            if innovation @ np.linalg.solve(S, innovation) <= self.gate2 or self.rejected >= 2:
                if self.rejected >= 2:  # three sightings in a row disagree with us: believe them
                    self.x = np.array([z[0], z[1], 0.0, 0.0])
                    self.P = np.diag([self.R[0, 0], self.R[1, 1], 25.0, 25.0])
                else:
                    self._update(innovation, S, self.R)
                self.rejected, self.unseen = 0, 0
                return True
            self.rejected += 1

        self.unseen += 1
        if carrier is not None:
            innovation = np.asarray(carrier, float) - self.x[:2]
            self._update(innovation, self.P[:2, :2] + self.R_carrier, self.R_carrier)
        elif self.unseen > 5:
            self.x[2:] *= self.coast_damping  # a ball nobody has seen for a while slows down
        return False

    def _update(self, innovation, S, R):
        K = self.P @ self.Hm.T @ np.linalg.inv(S)
        self.x = self.x + K @ innovation
        # Joseph form: stays symmetric positive definite where the short form drifts.
        I_KH = np.eye(4) - K @ self.Hm
        P = I_KH @ self.P @ I_KH.T + K @ R @ K.T
        self.P = 0.5 * (P + P.T)


class PossessionHMM(object):
    """Sticky three-state HMM over H / A / D, with optional fixed-lag smoothing.

    push() takes one likelihood triple per frame and returns the posteriors that are now final:
    with lag=0 that is this frame's filtered posterior; with lag=L it is the smoothed posterior
    of the frame L steps back, computed from everything up to now. flush() drains the buffer.
    Cost per frame is O(lag) with three states, about 50 microseconds at lag 25.
    """

    def __init__(self, lag=0, p_switch=P_SWITCH, p_to_dead=P_TO_DEAD, p_from_dead=P_FROM_DEAD):
        self.lag = int(lag)
        stay = 1.0 - p_switch - p_to_dead
        self.T = ((stay, p_switch, p_to_dead),
                  (p_switch, stay, p_to_dead),
                  (p_from_dead / 2, p_from_dead / 2, 1.0 - p_from_dead))
        self.reset()

    def reset(self):
        self.alpha = (1.0 / 3, 1.0 / 3, 1.0 / 3)
        self.started = False
        self.buffer = deque()  # (alpha, likelihood) for frames not yet final

    def push(self, likelihood):
        T = self.T
        if self.started:
            prior = tuple(sum(self.alpha[i] * T[i][j] for i in range(3)) for j in range(3))
        else:
            prior, self.started = (1.0 / 3, 1.0 / 3, 1.0 / 3), True
        alpha = _normalise(tuple(prior[j] * likelihood[j] for j in range(3)))
        self.alpha = alpha
        self.buffer.append((alpha, likelihood))
        if len(self.buffer) <= self.lag:
            return []
        return [self._pop_oldest()]

    def flush(self):
        out = []
        while self.buffer:
            out.append(self._pop_oldest())
        return out

    def _pop_oldest(self):
        """Smoothed posterior of the oldest buffered frame: forward alpha times backward beta."""
        T = self.T
        beta = (1.0, 1.0, 1.0)
        items = self.buffer
        for k in range(len(items) - 1, 0, -1):
            lik = items[k][1]
            weighted = (lik[0] * beta[0], lik[1] * beta[1], lik[2] * beta[2])
            beta = _normalise(tuple(sum(T[i][j] * weighted[j] for j in range(3))
                                    for i in range(3)))
        alpha, _ = items.popleft()
        return _normalise((alpha[0] * beta[0], alpha[1] * beta[1], alpha[2] * beta[2]))


class LiveEstimator(object):
    """BallFilter + PossessionHMM, fed one tracking frame at a time.

    `teams` maps each track slot to 0 (home) or 1 (away). Positions are pitch metres with the
    origin at a corner, NaN where a track is missing; the ball is (x, y) or None / NaN.
    """

    def __init__(self, teams, pitch=(105.3, 68.0), fps=FPS, lag=0, evidence_power=EVIDENCE_POWER,
                 prior=None):
        self.evidence_power = float(evidence_power)
        # Optional (n_frames, 3) likelihood multipliers indexed by frame, e.g. from Smart
        # Tagging (tag_prior.build_prior). Applied after the evidence power.
        self.prior = prior
        self.teams = np.asarray(teams)
        self.pitch = pitch
        self.fps = fps
        self.ball = BallFilter(fps=fps)
        self.hmm = PossessionHMM(lag=lag)
        self.pending = deque()  # per-frame ball info, released alongside the HMM posteriors
        self.reset()

    @property
    def lag(self):
        return self.hmm.lag

    def reset(self):
        """Start over, e.g. at the start of a half. Call flush() first to keep the tail."""
        self.ball.reset()
        self.hmm.reset()
        self.pending.clear()
        self.last_likelihood = None
        self.previous = None
        self.history = deque(maxlen=VELOCITY_SPAN + 1)
        self.player_velocity = None
        self.carrier = None       # track slot the hidden ball is attached to
        self.passer = None        # slot the ball left, while it is hidden in flight
        self.last_seen_with = None
        self.hidden_frames = 0

    def push(self, frame, players, ball):
        players = np.asarray(players, float)
        observed = ball is not None and not np.isnan(np.asarray(ball, float)).any()
        speeds = self._player_speeds(players)

        carrier_xy = self._carrier_position(players, observed)
        seen = self.ball.step(np.asarray(ball, float) if observed else None, carrier_xy)
        self._update_attachment(players, speeds, seen)

        likelihood = self._likelihood(players, speeds, seen)
        if self.evidence_power != 1.0:
            likelihood = tuple(v ** self.evidence_power for v in likelihood)
        if self.prior is not None and 0 <= frame < len(self.prior):
            factor = self.prior[frame]
            likelihood = (likelihood[0] * factor[0], likelihood[1] * factor[1],
                          likelihood[2] * factor[2])
        self.last_likelihood = likelihood
        position = self.ball.position
        self.pending.append((frame, position if position is None else position.copy(),
                             self.ball.sigma, seen))
        return [self._estimate(p) for p in self.hmm.push(likelihood)]

    def flush(self):
        return [self._estimate(p) for p in self.hmm.flush()]

    # -- internals ---------------------------------------------------------------------------

    def _estimate(self, posterior):
        frame, position, sigma, seen = self.pending.popleft()
        label = STATE_LABELS[max(range(3), key=lambda k: posterior[k])]
        x, y = (float("nan"), float("nan")) if position is None else map(float, position)
        return Estimate(frame, label, posterior[H], posterior[A], posterior[D], x, y,
                        sigma, seen)

    def _player_speeds(self, players):
        """Per-slot speed in m/s over the last VELOCITY_SPAN frames; NaN where unknown.

        One frame of 10 cm tracking noise is ~3.5 m/s of velocity noise at 25 fps; differencing
        over 5 frames cuts that to ~0.7 m/s, enough to tell a dribbler from a defender.
        """
        self.history.append(players)
        oldest = self.history[0]
        span = len(self.history) - 1
        if span == 0 or oldest.shape != players.shape:
            self.player_velocity = np.full(players.shape, np.nan)
        else:
            self.player_velocity = (players - oldest) * (self.fps / float(span))
        self.previous = players
        return np.linalg.norm(self.player_velocity, axis=1)

    def _carrier_position(self, players, observed):
        """Where the hidden ball's carrier is now, or None if the ball is not attached."""
        if observed or self.carrier is None:
            return None
        xy = players[self.carrier]
        if np.isnan(xy).any():
            self.carrier = None  # the carrier's track dropped out; let the ball coast
            return None
        return xy

    def _update_attachment(self, players, speeds, seen):
        """Decide whether a hidden ball travels with a player, or flies on its own."""
        position = self.ball.position
        if position is None:
            return
        distance = np.linalg.norm(players - position, axis=1)
        distance[np.isnan(distance)] = np.inf

        if seen:
            self.hidden_frames = 0
            self.carrier, self.passer = None, None
            nearest = int(np.argmin(distance))
            self.last_seen_with = nearest if distance[nearest] < CONTROL_RADIUS else None
            return

        self.hidden_frames += 1
        if self.hidden_frames == 1 and self.last_seen_with is not None:
            # The ball just vanished. Was it at the player's feet, moving with them, or had it
            # just been struck? Compare its velocity with the player's.
            slot = self.last_seen_with
            player_velocity = self._velocity_of(slot)
            relative = np.linalg.norm(self.ball.velocity - player_velocity) \
                if player_velocity is not None else 0.0
            if relative < 4.0:
                self.carrier = slot
            else:
                self.passer = slot
            return

        if self.carrier is None:
            # In flight: the first player (other than the passer) the ball reaches receives it.
            distance_free = distance.copy()
            if self.passer is not None:
                distance_free[self.passer] = np.inf
            nearest = int(np.argmin(distance_free))
            if distance_free[nearest] < CONTROL_RADIUS * 0.75:
                self.carrier, self.passer = nearest, None

    def _velocity_of(self, slot):
        # One frame of history is noisy, so this only feeds a coarse "moving together" test.
        velocity = self.player_velocity[slot]
        return None if np.isnan(velocity).any() else velocity

    def _likelihood(self, players, speeds, seen):
        """P(observation | H), P(observation | A), P(observation | D), up to a common factor."""
        position = self.ball.position
        if position is None:
            return (1.0, 1.0, 1.0)

        sigma = self.ball.sigma
        spread2 = CONTROL_RADIUS ** 2 + sigma ** 2
        distance = np.linalg.norm(players - position, axis=1)
        # Control = close to the ball AND moving with it. A defender pressing the carrier is
        # often as close as the carrier, but runs at the ball rather than with it. The velocity
        # test only applies while the ball is seen; a hidden ball's velocity is our own guess.
        control = np.exp(-distance ** 2 / (2 * spread2))
        if seen:
            mismatch = np.linalg.norm(self.player_velocity - self.ball.velocity, axis=1)
            mismatch[np.isnan(mismatch)] = MATCH_SPEED  # unknown velocity: neutral-ish
            control = control * (0.25 + 0.75 * np.exp(-mismatch ** 2 / (2 * MATCH_SPEED ** 2)))
        control[np.isnan(control)] = 0.0
        if not seen:
            control = np.minimum(control, HIDDEN_CONTROL_CAP)
        team_lik = [FLOOR + float(control[self.teams == team].max(initial=0.0))
                    for team in (0, 1)]

        # Dead-ball evidence.
        length, width = self.pitch
        x, y = position
        outside = (x < -OUT_MARGIN or x > length + OUT_MARGIN or y < -OUT_MARGIN
                   or y > width + OUT_MARGIN)
        finite = speeds[np.isfinite(speeds)]
        p90 = float(np.percentile(finite, 90)) if len(finite) >= 6 else None
        slow = p90 is not None and p90 < SLOW_PLAYERS
        nobody_on_it = not np.any(distance[~np.isnan(distance)] < CONTROL_RADIUS * 0.6)
        still = seen and float(np.linalg.norm(self.ball.velocity)) < STILL_BALL and nobody_on_it
        unseen_long = self.hidden_frames > HIDDEN_LONG * self.fps

        dead = DEAD_FLOOR
        if outside and sigma < 3.0:
            dead += 3.0
        if p90 is not None:
            dead += DEAD_SPEED_GAIN / (1.0 + np.exp(-(DEAD_SPEED_MID - p90) / DEAD_SPEED_WIDTH))
        if slow:
            if still:
                dead += 0.6
            if unseen_long:
                dead += 0.4
        return (team_lik[0], team_lik[1], dead)


def run_blocks(frames, blocks, n_frames, teams, pitch, lag=0, fps=FPS, on_estimate=None,
               evidence_power=EVIDENCE_POWER, offline=False, prior=None):
    """Stream `frames` through a fresh estimator per block; return a full-length label array.

    `frames` yields (video_frame, players, ball) in frame order. `blocks` is
    [(half, first, last)] as in games.half_video_blocks. Frames outside every block are X, and
    the estimator is reset at each block start so the halftime break carries nothing over.

    offline=True labels each half with full hindsight: the same ball filter and the same
    per-frame evidence, but the HMM is smoothed forwards and backwards over the whole half
    (forward_backward) instead of `lag` frames ahead. Not possible live; it is the right shape
    for a submission file. `lag` and `on_estimate` are ignored in this mode.
    """
    labels = np.full(n_frames, "X", dtype="<U1")
    est = LiveEstimator(teams, pitch=pitch, fps=fps, lag=0 if offline else lag,
                        evidence_power=evidence_power, prior=prior)
    current = None
    block_frames, block_liks = [], []

    def take(estimates):
        if offline:
            return
        for e in estimates:
            labels[e.frame] = e.label
            if on_estimate is not None:
                on_estimate(e)

    def finish_block():
        if offline and block_frames:
            posterior = forward_backward(block_liks, est.hmm.T)
            labels[np.asarray(block_frames)] = np.array(STATE_LABELS)[posterior.argmax(axis=1)]
        del block_frames[:], block_liks[:]

    for frame, players, ball in frames:
        block = next((i for i, (_, first, last) in enumerate(blocks)
                      if first <= frame <= last), None)
        if block is None:
            continue
        if block != current:
            take(est.flush())
            finish_block()
            est.reset()
            current = block
        take(est.push(frame, players, ball))
        if offline:
            block_frames.append(frame)
            block_liks.append(est.last_likelihood)
    take(est.flush())
    finish_block()
    return labels


def forward_backward(likelihoods, T):
    """(n, 3) posteriors of the sticky HMM given every likelihood of a block, past and future.

    The limit of PossessionHMM's fixed-lag smoother as the lag covers the whole block, computed
    in O(n) instead of O(n * lag). Scaled at every step, so long halves cannot underflow.
    """
    lik = np.asarray(likelihoods, float)
    T = np.asarray(T, float)
    n = len(lik)
    alpha = np.empty((n, 3))
    prior = np.full(3, 1.0 / 3)
    for t in range(n):
        a = prior * lik[t]
        total = a.sum()
        a = a / total if total > 0 and np.isfinite(total) else np.full(3, 1.0 / 3)
        alpha[t] = a
        prior = a @ T
    posterior = np.empty((n, 3))
    beta = np.ones(3)
    for t in range(n - 1, -1, -1):
        p = alpha[t] * beta
        posterior[t] = p / p.sum()
        b = T @ (lik[t] * beta)
        total = b.sum()
        beta = b / total if total > 0 and np.isfinite(total) else np.ones(3)
    return posterior


def read_atd_frames(raw_path, n_slots, pitch):
    """Yield (video_frame, players (n_slots, 2) metres, ball or None) from a raw ATD .txt.

    Same line format and frame numbering as baseline.py: "<frame>:<p>;<p>;...:<ball>", each
    group "x,y,speed" in 0-1 pitch units, NaN where missing, frame ids counting from 1.
    """
    length, width = pitch
    with open(raw_path) as handle:
        for line in handle:
            parts = line.strip().split(":")
            if len(parts) != 3:
                continue
            players = np.full((n_slots, 2), np.nan)
            for slot, group in enumerate(parts[1].split(";")[:n_slots]):
                values = group.split(",")
                if len(values) >= 2 and values[0][:1] != "N":
                    players[slot] = (float(values[0]) * length, float(values[1]) * width)
            values = parts[2].split(",")
            ball = None
            if len(values) >= 2 and values[0][:1] != "N":
                ball = (float(values[0]) * length, float(values[1]) * width)
            yield int(parts[0]) - 1, players, ball


def _normalise(v):
    total = v[0] + v[1] + v[2]
    if total <= 0 or total != total:
        return (1.0 / 3, 1.0 / 3, 1.0 / 3)
    return (v[0] / total, v[1] / total, v[2] / total)


# -- replay files for the Barca Lab live view ------------------------------------------------------

REPLAY_FORMAT = "barca-lab-replay"
REPLAY_VERSION = 1
REPLAY_MAX_SECONDS = 600


class ReplayRecorder(object):
    """Collects one window of frames and estimates, then writes it as a replay JSON file.

    The file holds, per frame: every track's position, the observed ball, the estimated ball and
    its uncertainty, the label and the H/A/D probabilities. For synthetic matches only, it also holds the
    simulator's ground truth. web/src/lib/replay.ts reads exactly this shape.
    """

    def __init__(self, first, n_frames, teams, pitch, fps, lag, provenance, source):
        if n_frames > REPLAY_MAX_SECONDS * fps:
            raise ValueError("a replay is limited to {} s".format(REPLAY_MAX_SECONDS))
        self.first, self.n = int(first), int(n_frames)
        self.meta = {"format": REPLAY_FORMAT, "version": REPLAY_VERSION,
                     "provenance": provenance, "source": source, "fps": fps,
                     "pitch": [float(pitch[0]), float(pitch[1])], "lag": int(lag),
                     "teams": [int(t) for t in teams], "firstFrame": self.first}
        self.players = [None] * self.n
        self.ball = [None] * self.n
        self.estimates = [None] * self.n

    def wants(self, frame):
        return self.first <= frame < self.first + self.n

    def frames(self, source):
        """Pass-through generator that keeps the tracking for frames inside the window."""
        for frame, players, ball in source:
            if self.wants(frame):
                self.players[frame - self.first] = _round_flat(players)
                self.ball[frame - self.first] = _round_point(ball)
            yield frame, players, ball

    def estimate(self, e):
        if self.wants(e.frame):
            self.estimates[e.frame - self.first] = e

    def write(self, path, truth=None):
        """Write the window. Frames the estimator never answered (outside both halves, e.g.
        before kickoff or at halftime) are kept, labelled X with no ball estimate, so a window
        may straddle a kickoff. A window with no answered frame at all is an error."""
        if all(e is None for e in self.estimates):
            raise ValueError("the replay window {}-{} has no frame inside a half".format(
                self.first, self.first + self.n - 1))
        empty_row = [None] * (2 * len(self.meta["teams"]))
        players = [row if row is not None else empty_row for row in self.players]
        est, label, p_home, p_away = [], [], [], []
        for e in self.estimates:
            if e is None:
                est.append(None)
                label.append("X")
                p_home.append(0)
                p_away.append(0)
                continue
            sigma = e.ball_sigma if math.isfinite(e.ball_sigma) else None
            est.append(None if not math.isfinite(e.ball_x) else
                       [round(e.ball_x, 1), round(e.ball_y, 1),
                        None if sigma is None else round(min(sigma, 99.0), 1)])
            label.append(e.label)
            p_home.append(int(round(e.p_home * 100)))
            p_away.append(int(round(e.p_away * 100)))
        record = dict(self.meta)
        record["frames"] = {"players": players, "ball": self.ball, "est": est,
                            "label": "".join(label), "pHome": p_home, "pAway": p_away}
        if truth is not None:
            record["frames"]["truth"] = "".join(truth[self.first:self.first + self.n])
        folder = os.path.dirname(os.path.abspath(path))
        if not os.path.isdir(folder):
            os.makedirs(folder)
        with open(path, "w") as handle:
            json.dump(record, handle, separators=(",", ":"))
        return path


def _round_flat(players):
    out = []
    for x, y in np.asarray(players, float):
        out.extend([None, None] if np.isnan(x) or np.isnan(y) else [round(float(x), 1),
                                                                    round(float(y), 1)])
    return out


def _round_point(ball):
    if ball is None:
        return None
    ball = np.asarray(ball, float)
    return None if np.isnan(ball).any() else [round(float(ball[0]), 1), round(float(ball[1]), 1)]


def export_synthetic_replay(path, start_s=60.0, seconds=90.0, seed=11, lag=25):
    """Simulate a match, run the estimator over it, and keep `seconds` of it as a replay."""
    from synthetic_match import simulate

    first, n = int(start_s * FPS), int(seconds * FPS)
    n_frames = first + n + lag + FPS  # run past the window so the lagged answers exist
    match = simulate(n_frames, seed=seed)
    recorder = ReplayRecorder(first, n, match.teams, match.pitch, FPS, lag, "synthetic",
                              "starter/synthetic_match.py seed={} ({:.0f}-{:.0f} s)".format(
                                  seed, start_s, start_s + seconds))
    frames = recorder.frames((t, match.players[t], match.ball[t]) for t in range(n_frames))
    run_blocks(frames, [(1, 0, n_frames - 1)], n_frames, match.teams, match.pitch, lag=lag,
               on_estimate=recorder.estimate)
    return recorder.write(path, truth=match.labels)


# -- command line ------------------------------------------------------------------------------

def synthetic_report(minutes=20, seed=11, lags=(0, 25, 50)):
    """Score the estimator against a simulated match with the official metric functions."""
    import possession_metrics as pm
    from baseline import smooth
    from postprocess import clean_segments
    from synthetic_match import simulate

    n_frames = int(minutes * 60 * FPS)
    match = simulate(n_frames, seed=seed)
    gt = pm.label_codes(match.labels)
    runs = pm.valid_runs(gt)
    blocks = [(1, 0, n_frames - 1)]

    def score(labels):
        codes = pm.label_codes(labels)
        spell = pm.spell_scores(gt, codes, runs)
        macro = pm.macro_f1(pm.scored_confusion(pm.confusion(gt, codes)))
        return spell["mean_f1"], macro, spell["n_pred"]

    rows = []
    nearest = _nearest_team(match)
    rows.append(("baseline_smooth50 (offline)", score(smooth(nearest, 50)), None))

    for lag in lags:
        started = time.perf_counter()
        frames = ((t, match.players[t], match.ball[t]) for t in range(n_frames))
        labels = run_blocks(frames, blocks, n_frames, match.teams, match.pitch, lag=lag)
        per_frame = (time.perf_counter() - started) / n_frames * 1000
        rows.append(("live lag {:>2} ({:.1f} s late)".format(lag, lag / float(FPS)),
                     score(labels), per_frame))
        rows.append(("  + clean_segments (offline)", score(clean_segments(labels, blocks)), None))

    print("synthetic match: {} min, {} true possessions, ball hidden on {:.0%} of frames".format(
        minutes, len(pm.possession_spells(gt, runs)), np.isnan(match.ball[:, 0]).mean()))
    print("{:<30} {:>8} {:>8} {:>6} {:>10}".format("", "spellF1", "macroF1", "poss", "ms/frame"))
    for name, (spell, macro, n_pred), ms in rows:
        print("{:<30} {:>8.4f} {:>8.4f} {:>6} {:>10}".format(
            name, spell, macro, n_pred, "" if ms is None else "{:.2f}".format(ms)))
    print("budget at 25 fps: 40 ms/frame. Synthetic scores say nothing about the real board.")
    return rows


def _nearest_team(match):
    """baseline.py step 1 on simulated tracking: team of the nearest player, -1 if no ball."""
    out = np.full(len(match.labels), -1, dtype=np.int8)
    for t in range(len(out)):
        if np.isnan(match.ball[t]).any():
            continue
        distance = np.linalg.norm(match.players[t] - match.ball[t], axis=1)
        if np.isnan(distance).all():
            continue
        out[t] = match.teams[int(np.nanargmin(distance))]
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--synthetic", action="store_true",
                        help="score on a simulated match instead of the real one (no data)")
    parser.add_argument("--minutes", type=float, default=20, help="simulated match length")
    parser.add_argument("--lag", type=int, default=25, help="frames of delay (real-match mode)")
    parser.add_argument("--realtime", action="store_true",
                        help="pace the stream at the video frame rate, printing as it goes")
    parser.add_argument("--jsonl", help="also write every estimate as one JSON line here")
    parser.add_argument("--power", type=float, default=EVIDENCE_POWER,
                        help="evidence power, 0-1 (default %(default)s; 1.0 = no discount)")
    parser.add_argument("--offline", action="store_true",
                        help="label each half with full hindsight (submission files; not live)")
    parser.add_argument("--tags", action="store_true",
                        help="add Smart Tagging as soft evidence (starter/tag_prior.py)")
    parser.add_argument("--clean", action="store_true",
                        help="also write live_lag<L>_clean.csv: the same labels after "
                             "postprocess.clean_segments (offline, not live)")
    parser.add_argument("--replay", metavar="PATH",
                        help="write a replay window for the Barca Lab live view")
    parser.add_argument("--replay-from", type=float, default=0.0, metavar="SECONDS",
                        help="replay window start: video seconds (real) or match seconds (synthetic)")
    parser.add_argument("--replay-seconds", type=float, default=90.0, metavar="SECONDS")
    args = parser.parse_args(argv)

    if args.synthetic:
        if args.replay:
            path = export_synthetic_replay(args.replay, start_s=args.replay_from or 60.0,
                                           seconds=args.replay_seconds, lag=args.lag)
            print("wrote {} ({:.0f} KB)".format(path, os.path.getsize(path) / 1024.0))
        else:
            synthetic_report(minutes=args.minutes)
        return 0

    if args.offline and (args.replay or args.realtime or args.jsonl):
        parser.error("--offline labels a whole half at once, so it has no per-frame live output "
                     "for --replay, --realtime or --jsonl; run those without --offline")
    if args.replay and _inside(args.replay, os.path.join(ROOT, "web")):
        # A replay of the real match is tracking-derived. It must never land where the web app
        # bundles or serves files; it is loaded in the browser with a file picker instead.
        parser.error("a real-match replay may not be written inside web/; "
                     "use evaluation/replays/ (git-ignored)")

    from baseline import RESULTS_DIR, team_of_each_track, write_submission
    from games import GAME, GAMES, half_video_blocks, require, source_frames

    meta_path, raw_path = require(["atd_meta", "atd_raw"], GAME)
    teams = team_of_each_track(meta_path)
    prior = None
    if args.tags:
        prior = _tag_prior(meta_path, source_frames("tactical", GAME))
    pitch = GAMES[GAME]["pitch"]
    n_frames = source_frames("tactical", GAME)
    frames = read_atd_frames(raw_path, len(teams), pitch)
    if args.realtime:
        frames = _paced(frames, FPS)

    sink = open(args.jsonl, "w") if args.jsonl else None
    recorder = None
    if args.replay:
        recorder = ReplayRecorder(int(args.replay_from * FPS), int(args.replay_seconds * FPS),
                                  teams, pitch, FPS, args.lag, "local-run",
                                  "starter/live_estimator.py on {} tactical, power {}".format(
                                      GAME, args.power))
        frames = recorder.frames(frames)

    def on_estimate(e):
        if recorder is not None:
            recorder.estimate(e)
        if sink is not None:
            sink.write(json.dumps(_finite(e._asdict())) + "\n")
        if args.realtime:
            print("{:>7} {} H {:.2f} A {:.2f} D {:.2f}  ball ({:.1f}, {:.1f}) +/- {:.1f} m".format(
                e.frame, e.label, e.p_home, e.p_away, e.p_dead, e.ball_x, e.ball_y,
                e.ball_sigma))

    try:
        labels = run_blocks(frames, half_video_blocks(GAME), n_frames, teams, pitch,
                            lag=args.lag, on_estimate=on_estimate, evidence_power=args.power,
                            offline=args.offline, prior=prior)
    finally:
        if sink is not None:
            sink.close()
    # The settings are in the name, so runs with different settings sit side by side on the
    # scoreboard. Power 1.0 keeps the original name, live_lag<L>.csv.
    stem = "live_offline" if args.offline else "live_lag{}".format(args.lag)
    if args.power != 1.0:
        stem += "_p{:03d}".format(int(round(args.power * 100)))
    if args.tags:
        stem += "_tags"
    path = write_submission(os.path.join(RESULTS_DIR, stem + ".csv"), labels)
    print("wrote {}".format(path))
    if args.clean:
        from postprocess import clean_segments
        path = write_submission(os.path.join(RESULTS_DIR, stem + "_clean.csv"),
                                clean_segments(labels, half_video_blocks(GAME)))
        print("wrote {}".format(path))
    if recorder is not None:
        print("wrote {}".format(recorder.write(args.replay)))
    return 0


def _tag_prior(meta_path, n_frames):
    """Smart Tagging -> per-frame multipliers, after checking the tag clock is the video's."""
    import load_smart_tagging
    from baseline import team_names
    from tag_prior import build_prior

    events = load_smart_tagging.load()
    check = load_smart_tagging.check_time_base(events)
    if not check["agrees"]:
        raise SystemExit("Smart Tagging time base does not match the tactical video; not using "
                         "it. Run python3 starter/load_smart_tagging.py for details.")
    home, away = team_names(meta_path)
    prior, summary = build_prior(events, n_frames, home, away)
    print("smart tagging: {used} of {tags} tags used ({no_team} with no team, {other_code} other "
          "codes), {goal_stoppages} goal stoppages; frames nudged H {frames_home}, "
          "A {frames_away}, D {frames_dead}".format(**summary))
    return prior


def _inside(path, folder):
    path, folder = os.path.realpath(path), os.path.realpath(folder)
    return os.path.commonpath([path, folder]) == folder


def _paced(frames, fps):
    start = time.perf_counter()
    for index, item in enumerate(frames):
        wait = start + index / float(fps) - time.perf_counter()
        if wait > 0:
            time.sleep(wait)
        yield item


def _finite(record):
    return {k: (None if isinstance(v, float) and not math.isfinite(v) else v)
            for k, v in record.items()}


if __name__ == "__main__":
    sys.exit(main())
