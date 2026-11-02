# Development guide

Two independent parts live in this repository:

| part | where | needs |
|---|---|---|
| research pipeline, scorer, validator | `evaluation/`, `starter/`, `games.py`, `tests/` | Python 3.8+, numpy, pandas |
| Barça Lab web app | `web/` | Node 20.19+ or 22.12+ |

The web app never reads the match data. Its dev server can only serve files inside `web/`, and
patterns that match competition assets are denied. Results reach the UI only as typed records,
each tagged with its provenance.

## Web app

```bash
cd web
npm install        # once
npm run dev        # http://localhost:5173, with hot reload
```

| route | what |
|---|---|
| `/`, `/match`, `/methodology` | public site: landing, Match Centre (demo data), Methodology |
| `/lab`, `/lab/models`, `/lab/experiments`, `/lab/runs`, `/lab/live`, `/lab/log` | research console (local only, no authentication) |

The full route list and the code layout are in `web/README.md`.

Checks: `npm test`, `npm run typecheck` and `npm run build`.

## Python

```bash
pip install -r requirements.txt
python -m unittest discover -s tests -v       # synthetic tests, no data needed
python evaluation/run_evaluation.py           # score evaluation/results/*.csv
python tools/inspect_atd_metadata.py --source tactical   # ATD period params vs raw ids (read-only, local)
python tools/tag_agreement.py                            # Smart Tagging vs public truth: % only (local)
python starter/live_estimator.py --synthetic             # live estimator on a simulated match, no data
python starter/live_estimator.py --lag 25                # real match: needs data/tactical/, writes
                                                         # evaluation/results/live_lag25.csv
```

`starter/live_estimator.py` answers frame by frame, as a live system would: a Kalman filter keeps
the ball's position through occlusions, and a sticky H/A/D hidden Markov model decides
possession, `--lag` frames late (0 = instant, 25 = one second of hindsight).
`starter/synthetic_match.py` is the simulated match it is tested on. Scores from the simulator
check the design; they predict nothing about the real board.

How real outputs reach the web app, and what is and isn't known about the match files:
`docs/integration-plan.md`.
