# Development guide

The repository has two independent parts:

| part | where | needs |
|---|---|---|
| research pipeline, scorer, validator | `evaluation/`, `starter/`, `games.py`, `tests/`, `tools/` | Python 3.8+, numpy, pandas |
| Barça Lab web app | `web/` | Node 20.19+ or 22.12+ |

The web app never reads the match data. Its dev server only serves files inside `web/` and
refuses paths that match competition assets. Results reach the UI only as typed records, each
tagged with where it came from.

## Web app

```bash
cd web
npm install        # once
npm run dev        # http://localhost:5173, with hot reload
```

| route | what |
|---|---|
| `/`, `/match`, `/methodology` | public site: landing page, Match Centre (demo data), methodology |
| `/lab`, `/lab/models`, `/lab/experiments`, `/lab/runs`, `/lab/live`, `/lab/log` | research console (local only, no login) |
| `/lab/console` | Match console: the estimator played back broadcast-style; can load any local replay |

The Match console in `web/src/pages/console/console.tsx` is also the project site's `/console`
page: the site (Figma Make) runs the same file, plus `consoleReplay.ts`, a packed copy of the
bundled synthetic replay. After changing either, rebuild the packed copy with
`python3 tools/pack_console_replay.py` and paste both files into the Figma Make project.
`siteTheme.css` is the site's stylesheet, scoped so the lab page looks the same.

`web/README.md` has the full route list and the code layout. To check a change, run
`npm test`, `npm run typecheck` and `npm run build`.

## Python

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v       # synthetic tests, no data needed
python evaluation/run_evaluation.py           # score evaluation/results/*.csv
python tools/inspect_atd_metadata.py --source tactical   # ATD period params vs raw ids (read-only, local)
python tools/tag_agreement.py                            # Smart Tagging vs public truth: % only (local)
python tools/external_check.py                           # our settings on Metrica sample games 1-2
python tools/dead_ball_study.py                          # dead-ball settings on Metrica + simulations
python starter/live_estimator.py --synthetic             # live estimator on a simulated match, no data
python starter/live_estimator.py --synthetic --replay web/src/data/fixtures/liveReplay.json
                                                         # rebuild the bundled demo replay (with goalkeepers)
python starter/live_estimator.py --lag 25                # real match: needs data/tactical/, writes
                                                         # evaluation/results/live_lag25.csv
```

`starter/live_estimator.py` answers frame by frame, the way a live system would. A Kalman
filter keeps the ball's position through occlusions, and a sticky H/A/D hidden Markov model
decides possession `--lag` frames late (0 is instant, 25 is one second of hindsight).
`starter/synthetic_match.py` is the simulated match it is tested on. Simulator scores check
the design, but they predict nothing about the real board.

The two `tools/` scripts that use Metrica data expect it in `external/metrica/`
(gitignored); `TECHNICAL.md` lists the files to download.

`docs/integration-plan.md` explains how real outputs reach the web app, and what we know and
don't know about the match files.
