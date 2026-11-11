# Team MSN: technical document

More than a Hack 2027, Phase 1 (ball possession). Submission file: `Team_MSN.csv`.

Team members: Mihir Ruwala, Sneha Jakhotiya, Umika Sood, Shashwat Goel.

## Summary

We label every frame with a small probabilistic model built on the provided ATD tracking. A
Kalman filter estimates where the ball is, including on the 41% of graded frames where the
tracking can't see it. A three-state hidden Markov model (home, away, dead ball) turns
per-frame evidence about who controls the ball into a label, with a whole half of hindsight.
A final pass removes possessions too short to be real. There is no machine learning, and the
submission reads only the tactical ATD files.

We chose the settings away from the competition game, on simulated matches and on two real
matches from Metrica Sports' open sample data, with labels rebuilt from their event logs. On
those two matches the submitted pipeline scores spellF1 0.474, or 0.435 when we hide the ball
more often. The nearest-player baseline scores 0.408 and 0.329. We used the public five
minutes of BAR-ATH only to check that the pipeline runs. With 17 possessions and a noise band
of about 0.33 spellF1, that window can't rank anything.

## Approach

### 1. Ball position (`starter/live_estimator.py`, `BallFilter`)

A constant-velocity Kalman filter tracks the ball in pitch metres, with 0.3 m measurement
noise and 12 m/s² acceleration noise. A sighting more than 6 standard deviations from the
prediction counts as a tracking error. Three of those in a row mean the ball really did move,
and the filter restarts there.

When the ball disappears, the filter has to guess why. We compare the ball's velocity with
that of the player it was last seen with (within 1.6 m). If the two were moving together, at
a relative speed under 4 m/s, the ball is at that player's feet: the player's position
becomes a weak measurement (1.2 m noise) and the ball moves with them. Otherwise the ball was
struck. It coasts on its own velocity until it comes within 1.2 m of a player other than the
passer, who then takes it. A ball unseen for more than 5 frames slows down a little each
frame. The filter's uncertainty grows while the ball is unseen, and that uncertainty widens
the control test below.

### 2. Evidence per frame

Each frame gets three likelihoods: home, away and dead ball.

*Team evidence.* A player's control score is `exp(-d² / 2s²)`, where `d` is their distance to
the estimated ball and `s² = 1.6² + σ²`, with σ the ball's uncertainty. When the ball is seen,
the score is also multiplied by how well the player's velocity matches the ball's,
`0.25 + 0.75·exp(-Δv² / 2·2.5²)`, with player velocity differenced over 5 frames. That
second factor matters more than anything else in the model. A defender pressing the carrier
is often as close to the ball as the carrier, but runs at the ball instead of with it.
Without the velocity test, possession kept flipping to whoever was pressing. A team's
likelihood is `0.08 +` the best control score among its players.

While the ball is unseen, each player's control score is capped at 0.25. The ball's position
is then our own guess, usually pinned to the last player near it, and without the cap that
guess outvoted almost every stoppage.

*Dead-ball evidence.* A base of 0.03, plus 3.0 if the ball is more than 0.5 m outside the
pitch and its position is known to within 3 m, plus `1.0 · sigmoid((2.0 − v90) / 0.4)`, where
`v90` is the speed of the fastest tenth of players. If `v90` is under 2 m/s, we add 0.6 more
when the ball is also still with nobody on it, and 0.4 when it has been unseen for over 2 s.
On the two Metrica matches, `v90` has a median of 1.5 m/s while the ball is dead and 3.4 m/s
in play, whether or not the ball is visible. The median player speed doesn't work here,
because most players walk or jog in open play too.

*Correlated frames.* Consecutive frames are close to the same observation, so treating each
as independent evidence overstates it badly. We raise each likelihood to the power 0.25
before the HMM sees it. A team switch then needs evidence that persists for a while, and 25
frames of one defender standing close aren't enough.

### 3. Possession model

A three-state HMM with sticky transitions: per frame, a 0.4% chance of a team switch, 0.2% of
play stopping and 0.4% of a restart. For the submission we smooth it forwards and backwards
over each half separately (`--offline`), and each frame takes its most probable state. The
estimator restarts at each half, so nothing carries over halftime. The same model can also
answer live, a fixed number of frames late (`--lag`). That mode drives the replay view
described under Tooling.

### 4. Cleanup (`starter/postprocess.py`)

`clean_segments` works inside each half and repeats two repairs until neither changes
anything. A D or X gap of up to 3 s with the same team on both sides becomes that team. A
spell under 1 s is folded into its neighbours, and a cluster of such blips is treated as one
stretch, so flicker can't add up to an invented possession.

### Why this design

The ranking metric scores whole possessions, so most of the problem is about time: deciding
when possession really changed. Which player is nearest on a given frame matters less. The
nearest-player baseline gets most frames right and still ranks poorly, because it breaks
possessions apart. A sticky state model is the simplest thing that treats a possession as
something that lasts.

We kept a handful of hand-set parameters with physical meaning instead of training a model.
The provided game's labels can't be used for training, and the open labelled data we found
(two Metrica matches) is enough to compare a few settings but not to train on.

## Assets used and dropped

| asset | used? | notes |
|---|---|---|
| Tactical ATD tracking (`_atd.txt`) | yes | players and ball; the only input to the labels |
| Tactical ATD metadata (`_atd.xml`) | yes | which track slot belongs to which team |
| Smart Tagging | tried, left out | see below |
| Homography | no | the ATD is already in pitch coordinates, so we never needed pixels |
| Tactical and broadcast video | no | |
| Broadcast ATD | no | on a different timeline from the submission (164,488 vs 199,319 frames) |
| Metrica Sports sample data, games 1 and 2 ([github.com/metrica-sports/sample-data](https://github.com/metrica-sports/sample-data)) | validation only | two anonymised real matches with tracking and events. We used them to choose settings; `make_submission.py` never reads them. See "Validation on other matches" |

**Smart Tagging.** `starter/tag_prior.py` (behind `--tags`, off in the submission) turns tags
into small per-frame nudges: attacking phases toward the tagged team, defending phases toward
the other team, a goal toward a dead-ball restart. On simulated matches with noisy fake tags,
a gentle nudge gained about 0.02 spellF1 when the tags were mostly right and lost about the
same when they were often wrong. Anything stronger lost either way. We then measured once,
with `tools/tag_agreement.py`, how often the real tags name the team in possession on the
public window: 68% overall. The simulator put that in the range where tags hurt, so we left
them out. A breakdown by tag kind suggested set pieces are far more reliable than phases, but
choosing a component from the public window is the kind of tuning RULES.md rules out, so we
didn't act on it.

## Training data

There is no learned component, so nothing was trained. We used labelled data from other
matches (Metrica, below) only to compare a small number of hand-set settings, which RULES.md
allows.

To choose settings without touching the match labels, we wrote a simulator,
`starter/synthetic_match.py`. It plays out an invented match with 22 players: carries, passes,
interceptions, tackles, balls kicked out and restarts. It records its own ground truth, then
damages the tracking the way automatic tracking gets damaged, with noise, track dropouts and
a ball hidden in bursts about 40% of the time. All of it is generated by code; nothing comes
from the provided game. We picked the first version's settings on simulated matches, using
seeds we hadn't used while building the model. Averaged over five 15-minute simulated matches,
before the dead-ball change described below:

| version | spellF1 | possessions (truth ≈ 73) |
|---|---|---|
| nearest player, 50-frame vote (the baseline) | 0.385 | 110 |
| our model, 1 s late, no evidence discount | 0.425 | 135 |
| same, evidence power 0.25 | 0.567 | 89 |
| same, plus cleanup | 0.604 | 72 |

The simulator is crude. These numbers show the design works on invented data and say nothing
about the real leaderboard.

## Validation on other matches

`tools/external_check.py` runs the pipeline on Metrica's sample games 1 and 2. Each is about
95 minutes at 25 fps, anonymised, and neither is BAR-ATH. Metrica ships events, not possession
labels, so we rebuild frame labels from the event log following CHALLENGE.md. A frame is `D`
from the last live action before a restart (a set piece or goal kick, or the foul itself
after a foul) until the restart. Otherwise it belongs to the team of the last on-ball action.
Challenges don't move possession, so a loose ball stays with the last team. That gives 376 and
354 possessions, about 3.9 a minute against 3.4 in the public window. These labels approximate
the competition's tracking-derived ground truth, so we compare settings with them and don't
read much into the absolute scores.

We also run each game with the ball hidden in extra bursts on about 40% of frames, the way
BAR-ATH loses it. One thing in Metrica's data could mislead us: its tracking loses the ball on
84% of dead-ball frames but only 12% of live ones, so there "no ball" almost means "dead".
BAR-ATH loses the ball mostly in live play (DATA.md). A setting that only wins through "the
ball is unseen" wouldn't carry over, so we checked every candidate with that evidence
switched off.

The first run caught only 8-14% of dead-ball frames. The team evidence from a hidden ball,
pinned to a nearby player, outvoted almost every stoppage. `tools/dead_ball_study.py` then
searched the graded player-speed term and the hidden-ball cap from section 2, on the four
Metrica runs and three new simulated matches (seeds 101-103). The best settings sat on a broad
plateau, all within about 0.02 spellF1 of each other. We took the cautious end, with the
larger cap. A smaller cap throws away more team evidence whenever the ball is hidden, which
costs little on Metrica but would cost more on BAR-ATH. Switching off the "unseen for 2 s"
bonus changed the chosen setting's score by less than 0.001.

spellF1 / macroF1, mean of the two Metrica games, with the submitted pipeline (power 0.25 and
cleanup):

| version | as tracked | extra ball dropouts |
|---|---|---|
| nearest player, 50-frame vote (the baseline) | 0.408 / 0.767 | 0.329 / 0.751 |
| first version | 0.392 / 0.474 | 0.347 / 0.458 |
| **submitted** | **0.474 / 0.766** | **0.435 / 0.758** |

Dead-ball recall went from 8% to 84%. On the original 20-minute simulated match (seed 11), the
offline pipeline went from 0.659 to 0.825 spellF1. The same runs also backed up the evidence
power: 0.25 beat 0.1, 0.5 and 1.0 in both Metrica runs.

## Possession rules we implemented

A player controls the ball when they are near it and moving with it. One frame of that isn't
enough: the HMM needs it to persist, and the cleanup removes any spell shorter than a second.

While the ball travels between players nobody controls it, so the team evidence is flat and
the sticky model keeps the last team. Possession changes only when an opponent takes control.
This follows the challenge's rule that a contested or loose ball stays with the last team in
possession.

A defender close to the carrier but running at them doesn't take possession. A successful
tackle shows up as the defender moving with the ball afterwards, and possession switches once
that persists.

The ball is dead when it is out of the pitch, or when play has visibly stopped: even the
fastest players have slowed to a walk, more so if the ball is also still. Short gaps inside
one team's possession are bridged, because a ball lost behind a crowd for two seconds is
almost always an occlusion.

We don't model restarts. After a stoppage, the first team to control the ball gets it.
Frames outside both halves are `X`.

## How we used the public five minutes

Only to check that the pipeline works: that files are aligned and valid, and that each change
moved the scores the way the simulator predicted. Our first full run gave 36 possessions where
the public window has 17. The simulator had already shown the same fragmentation, and we chose
the fix (the evidence power) and its value on simulated matches. We also used the public window
once for the Smart Tagging check above, which led us to leave tags out. We chose the dead-ball
change on Metrica and simulated matches only, and scored it on the public window once,
afterwards. No threshold was fitted to the public window.

| on the public window | macroF1 | spellF1 | possessions (truth 17) |
|---|---|---|---|
| `baseline_smooth50` (published floor) | 0.621 | 0.326 | 26 |
| `baseline_smooth125` | 0.581 | 0.424 | 16 |
| ours, first version (no evidence discount) | 0.709 | 0.317 | 36 |
| ours, power 0.25 and cleanup, before the dead-ball change | 0.737 | 0.463 | 21 |
| **ours, submitted** | **0.823** | **0.491** | **18** |

Dead-ball recall on the public window rose from 0.38 to 0.80, close to the 84% we measured on
Metrica. Transition F1 stayed at 0.18.

## Limitations

- Dead balls are still the hardest call. A stoppage where players keep jogging, like a quick
  throw-in or a restart taken at pace, looks like play.
- Our validation labels are approximate. The Metrica labels come from event logs, not from
  corrected tracking, and we only had two matches.
- The dead-ball change helps the offline pipeline but makes the zero-lag live estimator more
  fragmented on simulated matches (spellF1 0.485 to 0.411). The submission is offline and the
  Barca Lab replay view uses a lag, so neither is affected.
- We detect few of the real changes of possession: transition F1 is 0.18 on the public window.
  Cutting fragmentation is what traded those away.
- The radii, speeds and switch rates are football priors, checked on a simulator and two real
  matches. Real tracking is messier than either. BAR-ATH has 46 track slots for 22 players
  because of identity switches, though we only use each slot's team, so that matters little.
- Without a restart model, the first seconds after many stoppages go to whichever team touches
  the ball first, not the team taking the throw-in or goal kick.

With more time we would add more open matches to validate on (the seven Bundesliga matches of
the IDSSE dataset, for example), model restarts explicitly from players walking to set-piece
positions and the ball standing on a restart spot, and, given enough labelled matches, replace
the hand-set evidence model with a learned one.

## Reproduction

```bash
pip install -r requirements-submission.txt      # numpy 2.2.6, pandas 2.3.1 (Python 3.13)
# put BAR-ATH_tactical_atd.xml and BAR-ATH_tactical_atd.txt in data/tactical/
python3 make_submission.py
```

This writes `evaluation/results/Team_MSN.csv`, runs the official validator on it and prints the
file's SHA-256. The pipeline is deterministic, so every run gives the same file; ours is
`42cc1f8a069a0aaa8692512c8075257c51db329ba7b7534d91f95a94041aeb9e`. The tests need no match
data: `python3 -m unittest discover -s tests`.

To reproduce the validation, download Metrica's
`Sample_Game_{1,2}_RawTrackingData_{Home,Away}_Team.csv` and `Sample_Game_{1,2}_RawEventsData.csv`
into `external/metrica/` (gitignored), then run `python3 tools/external_check.py` and
`python3 tools/dead_ball_study.py`.

## Tooling

We wrote the code and this document with help from Claude Code, an AI coding assistant. It
worked from the repository's documentation, synthetic data and the public Metrica sample
matches. It never read the BAR-ATH match files. We ran everything that touches the match data
on our own machines.

`web/` holds Barca Lab, a local web console we built alongside the pipeline. It has an
experiment registry, a submission pre-check, and a replay view that plays the estimator back on
a pitch. It isn't part of the submission pipeline and never reads the match data.
