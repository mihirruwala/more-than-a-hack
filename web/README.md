# Barça Lab (web)

```bash
npm install          # once
npm run dev          # http://localhost:5173, with hot reload
npm test             # vitest: logic, persistence and route-level tests
npm run typecheck    # tsc
npm run build        # production bundle in dist/
```

## Routes

| route | what |
|---|---|
| `/` | landing page (public) |
| `/match` | Match Centre: interactive timeline over the demo fixture (public) |
| `/methodology` | pipeline stages with real statuses, plus the smoothing illustration (public) |
| `/lab` | Overview (local only) |
| `/lab/models` | Model Lab: records · `?tab=compare` · `?tab=dimensions`; `/lab/models/new`, `/:id/edit` |
| `/lab/experiments` | registry; `/new`, `/:id`, `/:id/edit`, `/compare?ids=EXP-001,EXP-002` |
| `/lab/runs` | Runs & imports: submission pre-check (in memory) and scorer-report import |
| `/lab/live` | Live replay: the live estimator played back on a pitch (the built-in synthetic replay, or a local replay file you pick) |
| `/lab/log` | project log |

## Layout

```
src/
  styles/tokens.css        every colour, font, size, space and duration: start here to restyle
  types/                   domain types (Experiment, ExperimentMetric, Provenance, MatchFixture…)
  data/fixtures/           seed.ts (seed records) · demoMatch.ts (the one demo fixture)
                           methodology.ts (stages and dimensions) · project.ts (static facts)
  data/adapter.ts          read-only project facts, the seam for a future API
  lib/store/               persistence.ts (versioned localStorage) · schema.ts (validation)
                           researchStore.ts (all mutations) · useResearch.ts (React binding)
  lib/research/            experiments, models, params, compare: pure domain logic
  lib/match.ts             timeline filtering, navigation and every match statistic
  lib/timelineState.ts     Match Centre reducer (selection, filters, zoom, window)
  components/ui/           Panel, Stat, badges, Button, Field, Tabs, Dialog, Toast…
  components/forms/        ParamEditor, UnsavedDialog
  pages/                   one folder per area, each with its own .module.css
  test/                    route smoke tests and workflow tests
```

## Rules the code keeps

- Every metric carries a `Provenance`: verified, published, manual, synthetic or demo. Hand-entered values can only be manual
  or synthetic. Only imported scorer output can be verified, so the UI has no way to create a verified value by hand. A missing
  metric shows "Not recorded", never 0.
- A comparison names a leader only when every value is verified, on the same scope, and the gap is wider than the scorer's
  noise band (0.04 spellF1).
- The timeline, segment details, statistics and landing preview all come from one demo fixture, `demoMatch`, with fictional
  teams and a seeded generator.
- There is no match data anywhere in `web/`: not in `public/`, fixtures or storage. The dev server can't read the parent repo.
- `/lab` is a local tool with no login. It would need real authentication before any deployment, or should be left out of the
  build.

## Real outputs

See `../docs/integration-plan.md`. A picked submission CSV is checked in memory against the validator's rules
(`lib/submission.ts`) and never stored. A picked `evaluation/reports/<name>.json` is validated
(`lib/research/scorerReport.ts`), and only its aggregates are attached to an experiment as verified metrics,
with their scope (public window or full match) and the file's SHA-256. Public-window scores never rank versions.

## Live replay

`lib/replay.ts` reads the replay JSON that `starter/live_estimator.py --replay` writes, and validates it. The built-in replay,
`data/fixtures/liveReplay.json`, is a synthetic match from `starter/synthetic_match.py`, loaded lazily as its own chunk.
Only synthetic replays may carry ground truth. A replay of the real match is written to `evaluation/replays/` (git-ignored;
the Python side refuses to write one inside `web/`), and is opened with the page's file picker, parsed in the tab, never stored.
Regenerate the built-in one with
`python starter/live_estimator.py --synthetic --replay web/src/data/fixtures/liveReplay.json --replay-from 60 --replay-seconds 90`.

## Persistence

Models, experiments and the log live in `localStorage` under `barca-lab:research`, as a versioned envelope. On load, every record
is validated. A malformed record is skipped and reported. Unreadable data is copied to `barca-lab:research:backup` before the seed
records are restored, so nothing is lost without a trace. Export JSON (on the Experiments page) downloads everything, and Reset asks
before it clears anything.
