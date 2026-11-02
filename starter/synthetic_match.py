"""A synthetic football match, for testing possession estimators without any match data.

Everything here is invented: 22 simulated players, a ball that is carried, passed, intercepted,
tackled, kicked out and restarted, and a per-frame ground truth that follows from those events.
The tracking it produces is damaged the way real automatic tracking is damaged:

  * the ball is hidden in bursts (about 40% of frames by default, the share DATA.md reports for
    the real match), more often during stoppages;
  * every observed position carries noise, and player tracks drop out for a second or two.

It is a test bench, not a model of LaLiga. Scores measured on it say whether an estimator does
what it was designed to do; they say nothing about the real leaderboard.

    from synthetic_match import simulate
    match = simulate(n_frames=15000, seed=1)
    match.players     # (T, 22, 2) observed positions in metres, NaN where the track is missing
    match.ball        # (T, 2) observed ball position, NaN where the ball is hidden
    match.teams       # (22,) 0 = home, 1 = away
    match.labels      # (T,) ground truth "H" / "A" / "D"

numpy only.
"""

from collections import namedtuple

import numpy as np

FPS = 25
PITCH = (105.3, 68.0)
HOME, AWAY = 0, 1

Match = namedtuple("Match", "players ball ball_true teams labels fps pitch")

# Params
CARRY_SECONDS = (0.6, 3.0)       # how long a player keeps the ball before acting
PASS_SPEED = 15.0                # m/s, ball speed in flight
INTERCEPT_P = 0.18               # share of passes the other team reads
HIDDEN_SECONDS = 1.5             # mean length of an occlusion burst
DEAD_SECONDS = (6.0, 18.0)       # stoppage length
MAX_SPEED_PLAY = 7.0             # m/s
MAX_SPEED_DEAD = 1.4
BALL_NOISE = 0.25                # m, observation noise
PLAYER_NOISE = 0.10
DROPOUT_P = 0.0008               # per player per frame: chance a track starts a dropout


def simulate(n_frames, seed=0, hidden_fraction=0.4, pitch=PITCH, fps=FPS):
    """One continuous stretch of play, n_frames long. Deterministic for a given seed."""
    rng = np.random.RandomState(seed)
    length, width = pitch
    dt = 1.0 / fps
    teams = np.array([HOME] * 11 + [AWAY] * 11, dtype=np.int8)
    attack = np.where(teams == HOME, 1.0, -1.0)  # home attacks +x

    # Formation anchors: each side spread over its own two thirds of the pitch.
    anchor = np.empty((22, 2))
    anchor[:11, 0] = rng.uniform(8, length * 0.62, 11)
    anchor[11:, 0] = rng.uniform(length * 0.38, length - 8, 11)
    anchor[:, 1] = rng.uniform(5, width - 5, 22)
    pos = anchor + rng.normal(0, 2, (22, 2))
    vel = np.zeros((22, 2))

    players_true = np.empty((n_frames, 22, 2))
    ball_true = np.empty((n_frames, 2))
    labels = np.empty(n_frames, dtype="<U1")

    carrier = int(rng.randint(22))
    ball = pos[carrier].copy()
    phase, timer = "carry", _seconds(rng, CARRY_SECONDS, fps)
    flight = None          # (start, end, frames_total, frames_done, passer_team, receiver, intercept)
    dead_restart = None    # (taker_team, spot)

    for t in range(n_frames):
        team_with_ball = int(teams[carrier]) if carrier is not None else None

        # -- player motion --------------------------------------------------------------------
        shift = np.clip(ball - anchor, -25, 25) * 0.35
        target = anchor + shift
        vmax = np.full(22, MAX_SPEED_PLAY)
        if phase == "dead":
            vmax[:] = MAX_SPEED_DEAD
            if dead_restart is not None:
                taker = _nearest(pos, dead_restart[1], teams == dead_restart[0])
                target[taker] = dead_restart[1]
                vmax[taker] = 3.0
        else:
            if phase == "carry":
                target[carrier] = pos[carrier] + np.array([attack[carrier] * 6.0,
                                                           rng.normal(0, 3)])
                vmax[carrier] = 6.0
            if team_with_ball is not None:
                presser = _nearest(pos, ball, teams != team_with_ball)
                # Jockey goal-side of the ball rather than standing on it; tackles are events.
                target[presser] = ball + np.array([attack[carrier] * 1.8, 0.0]) \
                    if carrier is not None else ball
                vmax[presser] = 6.5
            if phase == "pass":
                start, end, total, done, passer_team, receiver, intercept = flight
                target[receiver] = end
                vmax[receiver] = 8.0
                if intercept is not None:
                    target[intercept] = end
                    vmax[intercept] = 8.5

        desired = target - pos
        norm = np.linalg.norm(desired, axis=1, keepdims=True)
        desired = desired / np.maximum(norm, 1e-6) * np.minimum(norm * 1.2, vmax[:, None])
        vel = 0.85 * vel + 0.15 * desired + rng.normal(0, 0.15, (22, 2))
        pos = pos + vel * dt
        pos[:, 0] = np.clip(pos[:, 0], 0.5, length - 0.5)
        pos[:, 1] = np.clip(pos[:, 1], 0.5, width - 0.5)

        # -- ball and events ------------------------------------------------------------------
        if phase == "carry":
            heading = vel[carrier] / max(np.linalg.norm(vel[carrier]), 1e-6)
            ball = pos[carrier] + heading * 0.6
            label = "H" if teams[carrier] == HOME else "A"
            timer -= 1
            if timer <= 0:
                phase, timer, flight, dead_restart, carrier, label = _act(
                    rng, pos, vel, teams, carrier, ball, pitch, fps, label)
        elif phase == "pass":
            start, end, total, done, passer_team, receiver, intercept = flight
            done += 1
            ball = start + (end - start) * min(done / float(total), 1.0)
            label = "H" if passer_team == HOME else "A"
            flight = (start, end, total, done, passer_team, receiver, intercept)
            if done >= total:
                if intercept is not None:
                    carrier = intercept
                elif np.linalg.norm(pos[receiver] - ball) < 4.0:
                    carrier = receiver
                else:
                    carrier = _nearest(pos, ball, np.ones(22, bool))  # loose ball, first there
                label = "H" if teams[carrier] == HOME else "A"
                phase, timer, flight = "carry", _seconds(rng, CARRY_SECONDS, fps), None
        elif phase == "out":
            start, end, total, done, passer_team, _, _ = flight
            done += 1
            ball = start + (end - start) * min(done / float(total), 1.0)
            flight = (start, end, total, done, passer_team, None, None)
            outside = not (0 <= ball[0] <= length and 0 <= ball[1] <= width)
            label = "D" if outside else ("H" if passer_team == HOME else "A")
            if done >= total:
                spot = np.array([np.clip(ball[0], 0, length), np.clip(ball[1], 0, width)])
                dead_restart = (1 - passer_team, spot)
                phase, timer, flight = "dead", _seconds(rng, DEAD_SECONDS, fps), None
                label = "D"
        else:  # dead
            label = "D"
            timer -= 1
            taker_team, spot = dead_restart
            if timer < fps * 2:
                ball = spot.copy()  # ball placed for the restart
            if timer <= 0:
                carrier = _nearest(pos, spot, teams == taker_team)
                pos[carrier] = spot + rng.normal(0, 0.3, 2)
                ball = pos[carrier].copy()
                phase, timer, dead_restart = "carry", _seconds(rng, CARRY_SECONDS, fps), None
                label = "H" if taker_team == HOME else "A"

        players_true[t] = pos
        ball_true[t] = ball
        labels[t] = label

    return Match(*_observe(rng, players_true, ball_true, labels, hidden_fraction, fps),
                 teams=teams, labels=labels, fps=fps, pitch=pitch)


def _act(rng, pos, vel, teams, carrier, ball, pitch, fps, label):
    """What the carrier does when their time on the ball runs out."""
    length, width = pitch
    team = int(teams[carrier])
    roll = rng.rand()

    if roll < 0.10:
        opponent = _nearest(pos, ball, teams != team)
        if np.linalg.norm(pos[opponent] - ball) < 3.0:  # tackle: possession changes on the spot
            label = "H" if teams[opponent] == HOME else "A"
            return "carry", _seconds(rng, CARRY_SECONDS, fps), None, None, opponent, label
        roll = 1.0  # nobody close enough to tackle: the carrier passes instead
    if roll < 0.14:  # foul: dead ball where it stands, same team restarts
        return "dead", _seconds(rng, DEAD_SECONDS, fps), None, (team, ball.copy()), None, "D"
    if roll < 0.21:  # kicked out over the nearest line
        candidates = [np.array([ball[0], -3.0]), np.array([ball[0], width + 3.0]),
                      np.array([-3.0, ball[1]]), np.array([length + 3.0, ball[1]])]
        end = min(candidates, key=lambda c: np.linalg.norm(c - ball))
        total = max(int(np.linalg.norm(end - ball) / PASS_SPEED * fps), 4)
        return "out", 0, (ball.copy(), end, total, 0, team, None, None), None, None, label

    mates = np.flatnonzero((teams == team) & (np.arange(22) != carrier))
    near = mates[np.argsort(np.linalg.norm(pos[mates] - ball, axis=1))[:5]]
    receiver = int(rng.choice(near))
    distance = np.linalg.norm(pos[receiver] - ball)
    total = max(int(distance / PASS_SPEED * fps), int(0.4 * fps))
    end = pos[receiver] + vel[receiver] * total / float(fps)
    end = np.array([np.clip(end[0], 1, length - 1), np.clip(end[1], 1, width - 1)])
    intercept = None
    if rng.rand() < INTERCEPT_P:
        intercept = _nearest(pos, (ball + end) / 2, teams != team)
    return "pass", 0, (ball.copy(), end, total, 0, team, receiver, intercept), None, None, label


def _observe(rng, players_true, ball_true, labels, hidden_fraction, fps):
    """Damage the truth the way automatic tracking does: noise, dropouts, a hidden ball."""
    n_frames = len(labels)
    players = players_true + rng.normal(0, PLAYER_NOISE, players_true.shape)
    for slot in range(players.shape[1]):
        t = 0
        while t < n_frames:
            if rng.rand() < DROPOUT_P:
                span = rng.randint(fps // 2, fps * 3)
                players[t:t + span, slot] = np.nan
                t += span
            t += 1

    ball = ball_true + rng.normal(0, BALL_NOISE, ball_true.shape)
    p_off = 1.0 / (HIDDEN_SECONDS * fps)
    p_on = hidden_fraction / max(1.0 - hidden_fraction, 1e-6) * p_off * 0.8
    hidden = False
    for t in range(n_frames):
        on = p_on * (3.0 if labels[t] == "D" else 1.0)
        hidden = (rng.rand() > p_off) if hidden else (rng.rand() < on)
        if hidden:
            ball[t] = np.nan
    return players, ball, ball_true


def _nearest(pos, point, mask):
    index = np.flatnonzero(mask)
    return int(index[np.argmin(np.linalg.norm(pos[index] - point, axis=1))])


def _seconds(rng, bounds, fps):
    return int(rng.uniform(*bounds) * fps)


# -- synthetic Smart Tagging ---------------------------------------------------------------------

HOME_NAME, AWAY_NAME = "Northbridge Athletic", "Harbour Rovers"
_ATTACK_CODES = ("BUILD UP", "PROGRESSION", "BALL IN FINAL THIRD", "CREATING CHANCES")
_DEFEND_CODES = ("DEFENDING IN MIDDLE THIRD", "DEFENDING IN DEFENSIVE THIRD")


def simulate_tags(labels, seed=0, fps=FPS, wrong=0.15, miss=0.2, false_per_min=1.0,
                  jitter_s=1.5, na_restarts=0.4):
    """Noisy phase tags derived from a synthetic ground truth, in load_smart_tagging format.

    Mimics what DATA.md says the real tagging is like, and errs on the pessimistic side:
    phases cover parts of possessions (not whole ones) and spill over their ends; `wrong` of them
    name the wrong team, `miss` are dropped, false alarms arrive at `false_per_min`, and a share
    `na_restarts` of set pieces have Team "N/A".
    """
    rng = np.random.RandomState(seed)
    n = len(labels)
    names = {HOME: HOME_NAME, AWAY: AWAY_NAME}
    events = []

    def add(code, start, stop, team, extra=None):
        start, stop = max(0, int(start)), min(n, int(stop))
        if stop - start < fps // 2:
            return
        tags = {"Team": names[team] if team is not None else "N/A"}
        tags.update(extra or {})
        events.append({"code": code, "start_frame": start, "end_frame": stop,
                       "start_s": start / float(fps), "end_s": stop / float(fps), "tags": tags})

    def jitter():
        return rng.normal(0, jitter_s * fps)

    spells, start = [], 0
    for t in range(1, n + 1):
        if t == n or labels[t] != labels[start]:
            spells.append((start, t, labels[start]))
            start = t

    for index, (first, stop, label) in enumerate(spells):
        if label in "HA":
            team = HOME if label == "H" else AWAY
            length = stop - first
            for _ in range(rng.randint(1, 3)):
                if rng.rand() < miss:
                    continue
                a = first + rng.uniform(0, 0.5) * length + jitter()
                b = a + rng.uniform(0.3, 0.9) * length + abs(jitter())
                tagged = team if rng.rand() > wrong else 1 - team
                if rng.rand() < 0.7:
                    add(_ATTACK_CODES[rng.randint(len(_ATTACK_CODES))], a, b, tagged)
                else:
                    add(_DEFEND_CODES[rng.randint(len(_DEFEND_CODES))], a, b, 1 - tagged)
        elif label == "D" and index + 1 < len(spells) and spells[index + 1][2] in "HA":
            restart = stop
            if rng.rand() < miss:
                continue
            team = HOME if spells[index + 1][2] == "H" else AWAY
            if rng.rand() < na_restarts:
                team = None
            elif rng.rand() < wrong:
                team = 1 - team
            add("SET PIECES", restart - 2.5 * fps + jitter(), restart + 2.5 * fps + jitter(),
                team, {"Type": "Throw-in" if team is None else "Free Kick"})

    for _ in range(rng.poisson(false_per_min * n / (60.0 * fps))):
        a = rng.randint(0, n)
        add(_ATTACK_CODES[rng.randint(len(_ATTACK_CODES))], a, a + rng.uniform(2, 8) * fps,
            rng.randint(2))
    return sorted(events, key=lambda e: e["start_frame"])
