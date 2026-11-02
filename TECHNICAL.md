# Team MSN: technical document

More than a Hack 2027, Phase 1 (ball possession). Submission file: `Team_MSN.csv`.

<!-- TODO before submitting: add team members' names here. -->

## Summary

We label every frame with a small probabilistic model on top of the provided ATD tracking.
A Kalman filter estimates where the ball is, including the 41% of graded frames where the
tracking cannot see it. A three-state hidden Markov model (home, away, dead ball) turns
per-frame evidence about who controls the ball into a label, using the whole half for
hindsight. A last pass removes possessions too short to be real. No machine learning, no
labelled data, and only the tactical ATD files are read.

On the public five minutes it scores spellF1 0.463 and macroF1 0.737, against 0.326 and
0.621 for the published `baseline_smooth50`. That window holds 17 possessions and the
scorer's bootstrap puts its noise band at about 0.33 spellF1, so these numbers only show the
pipeline works. They are not evidence of a ranking.

## Approach

### 1. Ball position (`starter/live_estimator.py`, `BallFilter`)

A constant-velocity Kalman filter on the ball in pitch metres (measurement noise 0.3 m,
acceleration noise 12 m/s²). A sighting more than 6 standard deviations from the prediction is
treated as a tracking error; three such sightings in a row mean the ball really moved, and
the filter restarts there.

While the ball is hidden, the filter decides what kind of hiding it is. When the ball
disappears, we compare its velocity with that of the player it was last seen with (within
1.6 m). If they were moving together (relative speed under 4 m/s), the ball is at that
player's feet, and the player's position becomes a weak measurement (1.2 m noise) so the
ball moves with them. Otherwise the ball was struck: it coasts on its own velocity until it
comes within 1.2 m of a player other than the passer, who then takes it. A ball unseen for
more than 5 frames slows down slightly each frame. The filter's uncertainty grows while the
ball is unseen, and that uncertainty widens the control test below.

### 2. Evidence per frame

For each frame we compute three likelihoods, one each for home, away and dead ball.

*Team evidence.* A player's control score is `exp(-d² / 2s²)`, where `d` is their distance
to the estimated ball and `s² = 1.6² + σ²` (σ is the ball uncertainty). When the ball is
seen, the score is also multiplied by how well the player's velocity matches the ball's
(`0.25 + 0.75·exp(-Δv² / 2·2.5²)`, with player velocity differenced over 5 frames). That
second factor matters more than anything else in the model. A defender pressing the
carrier is often as close to the ball as the carrier, but runs at the ball rather than with
it. Without the velocity test, possession kept flipping to the presser. A team's likelihood
is `0.08 +` the best control score among its players.

*Dead-ball evidence.* A base of 0.03, plus 3.0 if the ball is more than 0.5 m outside the
pitch (and its position is known to within 3 m). If even the fastest tenth of players is
moving under 2 m/s, add 0.25, plus 0.6 if the ball is also still with nobody on it, plus
0.4 if it has been unseen for over 2 s. The median player speed is no use here, because most
players walk or jog in open play too.

*Correlated frames.* Consecutive frames are close to the same observation, so treating each
as independent evidence overstates it badly. Each likelihood is raised to the power 0.25
before the HMM sees it. A team switch then needs evidence that persists for a while, not 25
frames of one defender standing close.

### 3. Possession model

A three-state HMM with sticky transitions: per frame, 0.4% chance of a team switch, 0.2%
of play stopping, 0.4% of a restart. For the submission it is smoothed forwards and
backwards over each half separately (`--offline`), and each frame takes the most probable
state. The estimator restarts at each half, so nothing carries over halftime. For live use,
the same model can answer a fixed number of frames late instead (`--lag`); that mode drives
the replay view described under Tooling below.

### 4. Cleanup (`starter/postprocess.py`)

`clean_segments` works inside each half and repeats two repairs until neither changes
anything. A D or X gap of up to 3 s with the same team on both sides becomes that team.
A spell under 1 s is folded into its neighbours, and a cluster of such blips is treated as
one stretch, so flicker can't merge into an invented possession.

### Why this and not something else

The ranking metric scores whole possessions, so the problem is mostly about time: deciding
when possession really changed, not which player is nearest on a given frame. The
nearest-player baseline already gets most frames right and still ranks poorly because it
breaks possessions apart. A sticky state model is the simplest thing that treats a
possession as something that lasts. We used hand-set parameters with physical meaning
rather than a learned model because we had no labelled data on other games, and the
provided game's labels may not be used for training.

## Assets used and dropped

| asset | used? | notes |
|---|---|---|
| Tactical ATD tracking (`_atd.txt`) | yes | players and ball, the only input to the labels |
| Tactical ATD metadata (`_atd.xml`) | yes | which track slot belongs to which team |
| Smart Tagging | tried, left out | see below |
| Homography | no | the ATD is already in pitch coordinates; we never needed pixels |
| Tactical and broadcast video | no | |
| Broadcast ATD | no | on a different timeline from the submission (164,488 vs 199,319 frames) |

**Smart Tagging.** `starter/tag_prior.py` (behind `--tags`, off in the submission) turns tags
into small per-frame nudges: attacking phases toward the tagged team, defending phases
toward the other team, goal to restart as dead ball. On simulated matches with noisy fake
tags, a gentle nudge gained about 0.02 spellF1 when the tags were mostly right and lost
about the same when they were often wrong; anything stronger lost either way. We then
measured once, with `tools/tag_agreement.py`, how often the real tags name the team in
possession on the public window: 68% overall. That is in the range where the simulator
said the tags hurt, so we left them out. A breakdown by tag kind suggested set pieces are
far more reliable than phases. We did not act on that, because choosing a component from
the public window is the kind of tuning RULES.md rules out.

## Training data

None. There is no learned component and no labelled data from any game.

To choose settings without touching the match labels, we wrote a simulator
(`starter/synthetic_match.py`). It plays out an invented match with 22 players, carries,
passes, interceptions, tackles, balls kicked out and restarts, and records its own ground
truth. It then damages the tracking the way automatic tracking is damaged: noise, track
dropouts, and a ball hidden in bursts about 40% of the time. Everything in it is generated
by code; nothing comes from the provided game. Every setting above was picked on simulated
matches, using match seeds not used while building the model. Averaged over five 15-minute
simulated matches:

| version | spellF1 | possessions (truth ≈ 73) |
|---|---|---|
| nearest player, 50-frame vote (the baseline) | 0.385 | 110 |
| our model, 1 s late, no evidence discount | 0.425 | 135 |
| same, evidence power 0.25 | 0.567 | 89 |
| same, plus cleanup | 0.604 | 72 |

The simulator is crude, so these numbers show the design works on invented data and say
nothing about the real leaderboard.

## Possession rules we implemented

- **Who has the ball.** A player controls it when they are near it and moving with it. One
  frame of that is not enough: the HMM needs it to persist, and the cleanup removes any
  spell shorter than a second.
- **Loose balls and passes.** While the ball travels between players, nobody controls it, so
  the team evidence is flat and the sticky model keeps the last team. Possession changes
  only when an opponent takes control. This matches the challenge's rule that a contested or
  loose ball stays with the last team in possession.
- **Challenges.** A defender close to the carrier but running at them, not with the ball,
  doesn't take possession. A successful tackle shows up as the defender moving with the ball
  afterwards, and possession switches once that persists.
- **Dead ball.** Ball out of the pitch, or play visibly stopped (everyone slow, ball still or
  unseen for a while). Short gaps inside one team's possession are bridged, because a ball
  lost behind a crowd for two seconds is almost always an occlusion.
- **Restarts.** No explicit model. After a stoppage, the first team to control the ball gets
  it.
- **Outside play.** Frames outside both halves are `X`.

## How we used the public five minutes

Only to check that the pipeline works: that files are aligned and valid, and that each
change moved the scores in the direction the simulator predicted. Our first full run gave
36 possessions where the public window has 17. Fragmentation was already visible on the
simulator; the fix (the evidence power) and its value were chosen on simulated matches. The
public window was also used once for the Smart Tagging agreement check above, which led to
leaving tags out. No threshold was fitted to it.

| on the public window | macroF1 | spellF1 | possessions (truth 17) |
|---|---|---|---|
| `baseline_smooth50` (published floor) | 0.621 | 0.326 | 26 |
| `baseline_smooth125` | 0.581 | 0.424 | 16 |
| ours, first version (no evidence discount) | 0.709 | 0.317 | 36 |
| **ours, submitted** | **0.737** | **0.463** | **21** |

## Limitations

- **Dead balls are the weakest class.** In our first full run, dead-ball recall was 0.39:
  most stoppages were labelled as possession. We have not re-measured per-class numbers for
  the final version. Stoppages where the ball is hidden and players keep moving are the main
  gap.
- **Transition timing.** Reducing fragmentation also cut matched possession changes (transF1
  0.295 to 0.18 on the public window): we now detect fewer of the real changes of
  possession.
- **Hand-set parameters.** Radii, speeds and switch rates are football priors checked only
  on a simulator. Real tracking differs: it has 46 track slots for 22 players because of
  identity switches (we only use each slot's team, so this matters little), and contested
  balls are messier than our simulator makes them.
- **No restart model.** Knowing which team takes a throw-in or goal kick would fix the first
  seconds after many stoppages.

With more time we would build a dead-ball detector from physical cues (players walking to
set-piece positions, the ball standing on a restart spot, long tracking gaps) and test it on
a better simulator. With labelled data from other matches, the hand-set evidence model could
be replaced by a learned one.

## Reproduction

```bash
pip install -r requirements-submission.txt      # numpy 2.2.6, pandas 2.3.1 (Python 3.13)
# put BAR-ATH_tactical_atd.xml and BAR-ATH_tactical_atd.txt in data/tactical/
python3 make_submission.py
```

This writes `evaluation/results/Team_MSN.csv`, runs the official validator and prints the
file's SHA-256. The pipeline is deterministic, so two runs give the same file. The tests
need no match data: `python3 -m unittest discover -s tests`.

## Tooling

The code and this document were written with the help of Claude Code, an AI coding
assistant. It worked from the repository's documentation and from synthetic data, and it did
not read the match files. The team ran everything that touches the match data on our own
machines.

`web/` holds Barca Lab, a local web console we built alongside the pipeline: an experiment
registry, a submission pre-check, and a replay view that plays the estimator back on a pitch.
It is not part of the submission pipeline and never reads the match data.
