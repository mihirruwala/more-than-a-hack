# Team MSN: technical document

More than a Hack 2027, Phase 1 (ball possession). Submission file: `Team_MSN.csv`.

<!-- TODO before submitting: add team members' names here. -->

## Summary

We label every frame with a small probabilistic model on top of the provided ATD tracking.
A Kalman filter estimates where the ball is, including the 41% of graded frames where the
tracking cannot see it. A three-state hidden Markov model (home, away, dead ball) turns
per-frame evidence about who controls the ball into a label, using the whole half for
hindsight. A last pass removes possessions too short to be real. No machine learning, and
only the tactical ATD files are read to produce the submission.

Settings were chosen away from the competition game: on simulated matches, and on two real
matches from Metrica Sports' open sample data with labels rebuilt from their event logs. On
those two matches the submitted pipeline scores spellF1 0.474 (0.435 with extra ball
dropouts), against 0.408 (0.329) for the nearest-player baseline. The public five minutes of
BAR-ATH were only used to check that the pipeline runs; at 17 possessions and a noise band of
about 0.33 spellF1 they are not evidence of a ranking.

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
is `0.08 +` the best control score among its players. While the ball is unseen, each
player's control score is capped at 0.25: the ball's position is then our own guess, and in
the first version that guess, pinned to the last player near it, outvoted almost every
stoppage.

*Dead-ball evidence.* A base of 0.03, plus 3.0 if the ball is more than 0.5 m outside the
pitch (and its position is known to within 3 m), plus `1.0 · sigmoid((2.0 − v90) / 0.4)`,
where `v90` is the speed of the fastest tenth of players. If `v90` is under 2 m/s, add a
further 0.6 if the ball is still with nobody on it, and 0.4 if it has been unseen for over
2 s. On the two Metrica matches `v90` has a median of 1.5 m/s while the ball is dead and
3.4 m/s in play, and it does not depend on the ball being seen. The median player speed is
no use, because most players walk or jog in open play too.

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
possession as something that lasts. We used a handful of parameters with physical meaning
rather than a learned model: the provided game's labels may not be used for training, and
the open labelled data we found (two Metrica matches) is enough to check a few settings but
not to train on.

## Assets used and dropped

| asset | used? | notes |
|---|---|---|
| Tactical ATD tracking (`_atd.txt`) | yes | players and ball, the only input to the labels |
| Tactical ATD metadata (`_atd.xml`) | yes | which track slot belongs to which team |
| Smart Tagging | tried, left out | see below |
| Homography | no | the ATD is already in pitch coordinates; we never needed pixels |
| Tactical and broadcast video | no | |
| Broadcast ATD | no | on a different timeline from the submission (164,488 vs 199,319 frames) |
| Metrica Sports sample data, games 1 and 2 (external, [github.com/metrica-sports/sample-data](https://github.com/metrica-sports/sample-data)) | for validation only | two anonymised real matches, tracking + events; used to choose settings, never read by `make_submission.py`. See "Validation on other matches" |

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

None: there is no learned component. Labelled data from other matches (Metrica, below) was
used only to compare a small number of hand-set settings, which RULES.md allows.

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
nothing about the real leaderboard. (This table is the first version, before the dead-ball
change below.)

## Validation on other matches

`tools/external_check.py` runs the pipeline on Metrica's sample games 1 and 2 (about 95
minutes each, 25 fps, anonymised). Neither involves BAR-ATH. Metrica ships events, not
possession labels, so we rebuild frame labels from the event log following CHALLENGE.md:
`D` from the last live action before each restart (set piece or goal kick; from the foul
itself after a foul) until the restart, otherwise the team of the last on-ball action, with
challenges not moving possession, so a loose ball stays with the last team. That gives 376
and 354 possessions, about 3.9 a minute (the public window has 3.4). These labels are an
approximation of the competition's tracking-derived ground truth, so we read differences
between settings, not absolute scores.

Each game is also run with the ball hidden in extra bursts on about 40% of frames, the way
BAR-ATH loses it. One trap: Metrica's tracking loses the ball on 84% of dead-ball frames but
only 12% of live ones, so on this data "no ball" almost means "dead". BAR-ATH loses it mostly
in live play (DATA.md). Any setting that only wins through "the ball is unseen" would not
carry over, so we checked each candidate with that evidence switched off.

The first run showed dead-ball recall of 8-14%: the team evidence from a hidden ball pinned
to a nearby player outvoted almost every stoppage. `tools/dead_ball_study.py` then searched
the graded player-speed term and the hidden-ball cap described in section 2 on the four
Metrica runs plus three new simulated matches (seeds 101-103). The top settings form a broad
plateau, within about 0.02 spellF1 of each other. We took its cautious end (the larger cap),
because a smaller one discards more team evidence whenever the ball is hidden, which costs
little on Metrica but is risky on BAR-ATH. Switching off the "unseen for 2 s" bonus changed
the chosen setting's score by less than 0.001.

spellF1 / macroF1, mean of the two Metrica games, submitted pipeline (power 0.25 + cleanup):

| version | as tracked | extra ball dropouts |
|---|---|---|
| nearest player, 50-frame vote (the baseline) | 0.408 / 0.767 | 0.329 / 0.751 |
| first version | 0.392 / 0.474 | 0.347 / 0.458 |
| **submitted** | **0.474 / 0.766** | **0.435 / 0.758** |

Dead-ball recall went from 8% to 84%. On the original 20-minute simulated match (seed 11)
the offline pipeline went from 0.659 to 0.825 spellF1. The same data also confirmed the
evidence power: 0.25 was the best of 0.1, 0.25, 0.5 and 1.0 in both Metrica runs.

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
- **Dead ball.** Ball out of the pitch, or play visibly stopped: even the fastest players
  have slowed to a walk, more so if the ball is also still. Short gaps inside one team's possession are bridged, because a ball
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
leaving tags out. The dead-ball change was chosen entirely on Metrica and simulated matches.
No threshold was fitted to the public window.

| on the public window | macroF1 | spellF1 | possessions (truth 17) |
|---|---|---|---|
| `baseline_smooth50` (published floor) | 0.621 | 0.326 | 26 |
| `baseline_smooth125` | 0.581 | 0.424 | 16 |
| ours, first version (no evidence discount) | 0.709 | 0.317 | 36 |
| ours, evidence power 0.25 + cleanup, before the dead-ball change | 0.737 | 0.463 | 21 |
<!-- TODO: add the submitted version's row: python3 evaluation/run_evaluation.py -->

## Limitations

- **Dead balls.** Still the hardest call. A stoppage where players keep jogging (a quick
  throw-in, a restart taken at pace) looks like play. On BAR-ATH we cannot measure
  dead-ball recall without tuning on the public window, so the 84% above is a Metrica
  number.
- **Validation labels are approximate.** The Metrica labels come from event logs, not from
  corrected tracking, and only two matches were available.
- **Live mode.** The dead-ball change helps the offline pipeline but makes the zero-lag live
  estimator more fragmented on simulated matches (spellF1 0.485 to 0.411). The replay view in
  Barca Lab uses a lag, and the submission is offline, so neither is affected.
- **Transition timing.** Reducing fragmentation also cut matched possession changes (transF1
  0.295 to 0.18 on the public window): we now detect fewer of the real changes of
  possession.
- **Hand-set parameters.** Radii, speeds and switch rates are football priors, checked on a
  simulator and two real matches. Real tracking differs: it has 46 track slots for 22 players because of
  identity switches (we only use each slot's team, so this matters little), and contested
  balls are messier than our simulator makes them.
- **No restart model.** Knowing which team takes a throw-in or goal kick would fix the first
  seconds after many stoppages.

With more time we would add more open matches (for example the seven Bundesliga matches of
the IDSSE dataset) to validate on, model restarts explicitly (players walking to set-piece
positions, the ball standing on a restart spot), and with enough labelled matches replace the
hand-set evidence model with a learned one.

## Reproduction

```bash
pip install -r requirements-submission.txt      # numpy 2.2.6, pandas 2.3.1 (Python 3.13)
# put BAR-ATH_tactical_atd.xml and BAR-ATH_tactical_atd.txt in data/tactical/
python3 make_submission.py
```

This writes `evaluation/results/Team_MSN.csv`, runs the official validator and prints the
file's SHA-256. The pipeline is deterministic, so two runs give the same file. The tests
need no match data: `python3 -m unittest discover -s tests`.

To reproduce the validation, download Metrica's `Sample_Game_{1,2}_RawTrackingData_{Home,Away}_Team.csv`
and `Sample_Game_{1,2}_RawEventsData.csv` into `external/metrica/` (gitignored), then run
`python3 tools/external_check.py` and `python3 tools/dead_ball_study.py`.

## Tooling

The code and this document were written with the help of Claude Code, an AI coding
assistant. It worked from the repository's documentation, synthetic data and the public
Metrica sample matches, and it did not read the BAR-ATH match files. The team ran everything that touches the match data on our own
machines.

`web/` holds Barca Lab, a local web console we built alongside the pipeline: an experiment
registry, a submission pre-check, and a replay view that plays the estimator back on a pitch.
It is not part of the submission pipeline and never reads the match data.
