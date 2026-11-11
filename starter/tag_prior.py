"""Smart Tagging as soft evidence for the possession model.

Smart Tagging is Metrica's automatic annotation of the tactical video: phases of play and set
pieces, each an interval with a code and a Team tag (see DATA.md and load_smart_tagging.py). It is
not ground truth: it has false positives and false negatives, 36 tags have Team "N/A" (every
throw-in among them), and its intervals are phases, not possessions. So nothing here copies an
interval across as a label. Each tag only multiplies the per-frame likelihoods the HMM already
weighs, by a modest factor, and the tracking evidence can still outvote it.

What a tag says, per frame it covers:

  attacking phase by team T   (build up, progression, chances, final third, box, transitions,
                               long ball, goals)        -> evidence for T
  defending phase by team T   (defending in any third, defensive transition)
                                                        -> evidence for T's opponent
  set piece by team T                                   -> evidence for T
  tags supporting both teams on the same frame          -> no evidence either way
  from a goal to the next "Kick Off (After Goal)"       -> evidence for a dead ball

    from tag_prior import build_prior
    prior, summary = build_prior(events, n_frames, home_name, away_name)
    # prior: (n_frames, 3) multipliers for (H, A, D); 1.0 where no tag speaks

The strengths are per-frame factors applied after EVIDENCE_POWER, chosen on simulated matches
with deliberately noisy tags (synthetic_match.simulate_tags), not on the public five minutes.

numpy and the standard library only.
"""

import difflib

import numpy as np

H, A, D = 0, 1, 2

# Codes, lower case: the file has them upper case, matched case-insensitively.
ATTACKING = frozenset((
    "build up", "progression", "creating chances", "ball in final third", "ball in the box",
    "players in the box", "attacking transition", "long ball", "goals",
))
DEFENDING = frozenset((
    "defending in attacking third", "defending in middle third", "defending in defensive third",
    "defensive transition",
))
SET_PIECES = "set pieces"
GOALS = "goals"
KICKOFF_AFTER_GOAL = "kick off (after goal)"

# Params
TEAM_BOOST = 1.10          # per-frame factor for the side a tag supports. For scale: the
                           # strongest tracking evidence is ~1.9x per frame after the 0.25 power.
                           # On simulated matches 1.10 helped with realistic tag noise (+0.02
                           # spellF1), cost ~0.02 with very bad tags, and 1.25+ hurt either way.
DEAD_BOOST = 2.0           # per-frame factor for D between a goal and the restart
MAX_GOAL_STOP_S = 180.0    # a goal with no restart tag within this long is left alone


def side_of(team_tag, home_name, away_name):
    """0 (home), 1 (away) or None for a Team tag value such as "Barcelona" or "N/A".

    The tagging and the tracking spell club names independently ("Atletic Club" in the tagging),
    so names are matched by similarity, and a tag that resembles neither side is an error rather
    than a guess.
    """
    tag = _norm(team_tag)
    if not tag or tag in ("n/a", "na", "none"):
        return None
    scores = [difflib.SequenceMatcher(None, tag, _norm(name)).ratio()
              for name in (home_name, away_name)]
    best = int(np.argmax(scores))
    if scores[best] < 0.5 or abs(scores[0] - scores[1]) < 0.1:
        raise ValueError("Team tag {!r} matches neither {!r} nor {!r} clearly".format(
            team_tag, home_name, away_name))
    return best


def build_prior(events, n_frames, home_name, away_name, team_boost=TEAM_BOOST,
                dead_boost=DEAD_BOOST, max_goal_stop_s=MAX_GOAL_STOP_S, fps=25):
    """(n_frames, 3) likelihood multipliers for H, A, D, and a summary of what was used.

    `events` is load_smart_tagging.load() output: dicts with code, start_frame, end_frame
    (half-open) and tags. The summary holds counts only, so it is safe to print.
    """
    support = np.zeros((n_frames, 2), dtype=bool)
    summary = {"tags": len(events), "used": 0, "no_team": 0, "other_code": 0,
               "goal_stoppages": 0}

    for event in events:
        code = _norm(event.get("code"))
        start, stop = _clip(event, n_frames)
        if stop <= start:
            continue
        if code in ATTACKING or code == SET_PIECES:
            flip = False
        elif code in DEFENDING:
            flip = True
        else:
            summary["other_code"] += 1
            continue
        side = side_of(event.get("tags", {}).get("Team"), home_name, away_name)
        if side is None:
            summary["no_team"] += 1
            continue
        support[start:stop, (1 - side) if flip else side] = True
        summary["used"] += 1

    prior = np.ones((n_frames, 3))
    prior[support[:, 0] & ~support[:, 1], H] = team_boost
    prior[support[:, 1] & ~support[:, 0], A] = team_boost

    # Goal -> restart: the clearest stoppage the tagging marks.
    goals = sorted((e for e in events if _norm(e.get("code")) == GOALS),
                   key=lambda e: e["start_frame"])
    kickoffs = sorted((e for e in events if _norm(e.get("code")) == SET_PIECES
                       and _norm(e.get("tags", {}).get("Type")) == KICKOFF_AFTER_GOAL),
                      key=lambda e: e["start_frame"])
    for goal in goals:
        restart = next((k for k in kickoffs if k["start_frame"] >= goal["end_frame"]), None)
        if restart is None or restart["start_frame"] - goal["end_frame"] > max_goal_stop_s * fps:
            continue
        start = max(0, min(goal["end_frame"], n_frames))
        stop = max(0, min(restart["start_frame"], n_frames))
        prior[start:stop, H] = 1.0
        prior[start:stop, A] = 1.0
        prior[start:stop, D] = dead_boost
        summary["goal_stoppages"] += 1

    summary["frames_home"] = int((prior[:, H] > 1).sum())
    summary["frames_away"] = int((prior[:, A] > 1).sum())
    summary["frames_dead"] = int((prior[:, D] > 1).sum())
    return prior, summary


def _norm(value):
    return " ".join(str(value or "").strip().lower().split())


def _clip(event, n_frames):
    return (max(0, min(int(event["start_frame"]), n_frames)),
            max(0, min(int(event["end_frame"]), n_frames)))
