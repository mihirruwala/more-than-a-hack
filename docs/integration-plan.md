# Notes on the match files, and how real outputs reach Barça Lab

These notes explain how our model's outputs get into the web app without the browser, our AI
coding assistant or any hosted service handling restricted match data. They also record what
we know about the ATD files and their timelines.

Everything here comes from public sources: this repository's code and docs, and the public
source of kloppy 3.18.0 (the version pinned in `requirements-starter.txt`). Each claim is
tagged with where it comes from:

- [code]: checked in public source code
- [doc]: stated in this repository's documentation, not re-derived
- [kloppy]: checked in the kloppy 3.18.0 source on GitHub
- [screenshot]: only seen in a screenshot of an XML preview, so unverified
- [unknown]: not established

---

## 1. Is `BAR-ATH_broadcast_atd.xml` part of the official workflow?

Yes, it's an expected file. It belongs to the broadcast source, though, and it holds only
metadata, so it can't produce a submission on its own.

- `games.py` names exactly this file: source `broadcast`, stem `BAR-ATH_broadcast`, suffix
  `_atd.xml`, giving `data/broadcast/BAR-ATH_broadcast_atd.xml`. [code]
- The `.xml` is metadata. The tracking itself is in the companion `_atd.txt`. `load_atd.load()`
  passes both to `kloppy.metrica.load_tracking_epts(meta_data=…, raw_data=…)`, and `baseline.py`
  reads both. [code]
- Each line of the raw `.txt` is `<frame_id>:<player>;<player>;…:<ball>`, and each group is
  `x,y,speed`. [code] (`baseline.py`, `load_atd.py`)
- The submission is indexed to the tactical video, not the broadcast. Row *i* is frame *i* of
  `BAR-ATH_tactical.mp4`, which has 199,319 frames. A file built on broadcast frames (164,488)
  fails the row-count check. [code] `games.py`, [doc] DATA.md
- The broadcast recording isn't synchronised to the tactical one, and no mapping is provided.
  It has cuts, replays and zooms. [doc] DATA.md, FAQ.md

So broadcast video, homography and the broadcast ATD XML aren't enough to run the official
baseline. `baseline.py` calls `require(["atd_meta", "atd_raw"])` with the default source,
tactical, so it needs both `data/tactical/BAR-ATH_tactical_atd.xml` and
`data/tactical/BAR-ATH_tactical_atd.txt`. [code] Without the broadcast `_atd.txt`, the broadcast
ATD can't be loaded either, because kloppy needs both files. [code]

## 2. How ATD, homography and video relate

| | tactical | broadcast |
|---|---|---|
| role | the reference: submission row *i* = frame *i* [code] | optional extra input on its own timeline [doc] |
| video frames | 199,319 [code] | 164,488 [code] |
| ATD records | 199,319 [doc] | 164,488 [doc] |
| homography rows | 199,319, valid on 100% [doc] | 164,488, valid on 65.8% [doc] |
| Smart Tagging | yes, timed against tactical [code] | none [code] |

- The homography CSV is `frame,h00…h22,reprojection_error,valid`, one row per video frame of
  its own recording, with `frame` counting from 0. [code] `load_homography.py`
- The matrix maps normalised pitch coordinates (0–1) to image pixels. Those are the same 0–1
  coordinates the ATD uses, so tracking goes in with no conversion. Don't convert to metres
  before projecting. [code]
- Where `valid == 0` the matrix is NaN. Lower `reprojection_error` is better, and it has no upper
  bound (the broadcast reaches 304). [doc]
- Broadcast ATD, broadcast homography and broadcast video share one timeline, and tactical has
  its own. Nothing links the two. [doc]

## 3. Frame numbering and coordinates

Frame numbering:

- Tactical ATD `frame_id` runs from 1 to 199,319, one record per video frame, so
  `video_frame = frame_id − 1`. [code] `load_atd.py`, `baseline.py` (`out[int(parts[0]) - 1]`)
- `load_atd.check_alignment_raw(source=…)` checks this on any export: the record count equals
  the video length and the ids run exactly 1 to n. For the broadcast source it expects 164,488.
  [code]
- `games.py` also carries per-half offsets of about 1.7 million (`id_frame = video_frame +
  1702057/8`) and IdFrame half spans. According to `load_atd.py` these describe "the separate
  counter the ground truth was derived from, which you never see". They aren't for reading the
  ATD, and the two conventions must not be mixed. [code]
- The graded tactical frames are 11,185–90,651 and 110,808–190,197. Grading of the second half
  starts at 110,808, although kick-off is at 113,742. [code] `games.half_video_blocks`, [doc]
  FAQ.md
- The tactical video runs at 25 fps. [code] `games.py`. Smart Tagging times are seconds from the
  start of the tactical video, so `round(s × 25)` gives the frame. [doc]

Coordinates:

- ATD positions are normalised to 0–1. Multiply by the pitch size in metres to get distances.
  The metadata says 105 × 68, and `games.py` uses 105.3 × 68.0. [code]
- kloppy's Metrica coordinate system has its origin top-left, y running top to bottom, and x
  and y in [0, 1]. [kloppy] `MetricaCoordinateSystem` (inherits `KloppyCoordinateSystem`)
- Pitch dimensions are read only when the position sensor unit is `normalized`: length comes
  from `FieldSize/Width` and width from `FieldSize/Height`. [kloppy]
- Attacking direction comes from the home team's provider parameter
  `attack_direction_first_half`. Without it, the orientation is `NOT_SET` and kloppy warns.
  [kloppy]
- Track slots are tracklets, not people. There are 46 slots for 22 players, and `ShirtNumber`
  is the slot index. [code] `baseline.py`

## 4. What `first_half_end = 16448` means

A screenshot of the broadcast ATD XML preview shows that it declares the FIFA Data Transfer
Format (EPTS), Optical/Tracking, provider Metrica Sports, 25.0 FPS, and a provider parameter
`first_half_end` with the value 16448, among other period parameters. [screenshot]

This is how the official loader reads such a value: [kloppy]

```python
# metadata.py — _load_periods
start_timestamp = timedelta(seconds=float(provider_params[start_key]) / frame_rate)
end_timestamp   = timedelta(seconds=float(provider_params[end_key])   / frame_rate)

# reader.py — every raw row
timestamp = timedelta(seconds=frame_id / metadata.frame_rate)
if period.start_timestamp <= timestamp <= period.end_timestamp:
    row["period_id"] = period.id
    row["timestamp"] -= period.start_timestamp
```

So kloppy treats `first_half_end` as a frame number on the same counter as the raw
`frame_id`, not as a time in seconds. Frames whose `frame_id / fps` falls outside every period
are kept, with `period_id = None`. kloppy reads `<FrameRate>` with `int(...)`. [kloppy]

On that reading, 16448 frames at 25 fps is 657.92 s, so the first half would end 10 min 57.9 s
into the broadcast counter. A real first half lasts about 46 minutes (roughly 69,000 frames). If
the value is what it looks like, one of these is true:

1. the broadcast counter or recording doesn't start near kick-off, or covers only part of the half;
2. the parameter means something other than a full-half boundary in this export;
3. the preview cut off a longer number (the broadcast's total of 164,488 looks similar);
4. the export's period parameters are wrong for the broadcast.

Which one can't be settled without reading the file. [unknown] Since kloppy computes the period
from `frame_id / fps`, wrong parameters would make `period_id` wrong for every frame. That only
matters if you use kloppy's periods. The baseline doesn't.

To settle it, run `python tools/inspect_atd_metadata.py --source broadcast` on your own machine
(see section 5). It prints the declared frame rate and every period parameter, converted to
minutes. If `_atd.txt` is present, it also prints the raw frame-id range and says whether each
boundary falls inside it. Read the output yourself. The competition terms forbid making the
datasets, or extracts of them, available to a hosted LLM, and that includes pasting this output
or screenshots of the XML into a chat.

## 5. Local commands and their outputs

All of these run on your machine, against data you unpacked into `data/` (or `MTAH_DATA_DIR`).

```bash
pip install -r requirements.txt
python starter/baseline.py                                   # reads tactical ATD → evaluation/results/baseline_*.csv
python evaluation/validate_submission.py evaluation/results/<name>.csv
python evaluation/run_evaluation.py                          # public 5 min → evaluation/scoreboard.csv + reports/<name>.json
python tools/inspect_atd_metadata.py --source tactical       # metadata/period check (read-only)
```

`--gt private` exists only on the organisers' machines, so participants can only score the
public window (7,500 graded frames, 17 possessions), and only the organisers can produce a
full-match score. [code] [doc] The rules don't allow choosing between versions on the public
window; it's for checking the pipeline. [doc] RULES.md, EVALUATION.md

The submission format, from `possession_metrics.validate_submission` [code]: header columns
`frame` and `label` (case and surrounding whitespace don't matter), exactly 199,319 rows, a
`frame` integer column equal to 0…199318 in order, labels in H/A/D/X after stripping and
upper-casing, and no blank or NA cells (pandas' default NA strings count as blank). Your
repository must regenerate the file byte for byte.

The scorer report, from `run_evaluation.py` via `json_safe`, written to `reports/<name>.json`
[code], has the fields `submission`, `ground_truth` (basename), `spell_f1_mean`, `macro_f1`,
`n_frames`, `n_graded`, `n_gt_spells`, `n_pred_spells`, `spell_f1` per IoU, `per_class`,
`confusion`, `transitions` and more. We confirmed the field list by scoring an all-X dummy
file, which carries no match information, into a scratch folder, and looked only at the field
names and types.

## 6. Getting real outputs into the web app

```
 your machine only
 ┌──────────────────────────────────────────────────────────────────┐
 │ data/ ──► your model ──► results/<name>.csv ──► run_evaluation   │
 │                              │                        │          │
 │                              ▼                        ▼          │
 │              [browser] submission check   reports/<name>.json    │
 │              in memory, never stored              │              │
 │                                                   ▼              │
 │                       [browser] import scorer report → validated │
 │                       aggregates only → experiment metrics       │
 └──────────────────────────────────────────────────────────────────┘
          nothing leaves the machine; no hosted service is involved
```

This is implemented under Lab → Runs in `web/`:

1. Submission check. Pick a `frame,label` CSV and the browser applies the validator's rules,
   then shows the label counts and the predicted possession count, as `validate_submission.py`
   prints them. The file is read in memory only. It is never stored, uploaded or drawn as a
   timeline, and the Python validator remains the authority.
2. Scorer report import. Pick `evaluation/reports/<name>.json` and the browser checks its
   structure: field types, `n_frames = 199,319` and value ranges. It works out the scope from
   `ground_truth` and cross-checks it against `n_graded` and `n_gt_spells` (public: 7,500 / 17;
   full match: 158,857). Only aggregates (spellF1, macroF1, predicted spells, alive/dead F1)
   are attached to an experiment, marked verified, with the scope and a source line carrying
   the file's SHA-256.
   - The browser can check the structure but not whether the file is genuine, so a hand-edited
     report would pass. The UI says so. Re-running `run_evaluation.py` reproduces the report.
   - Comparisons on public-window values never name a winner, because 17 possessions can't
     rank anything. Methodology stages only become verified on full-match verified metrics.
3. Never stored or sent: per-frame labels, match data in `web/`, anything the dev server would
   have to read outside `web/`, or any upload.

## 7. Open questions only you can answer, locally

- Is `data/tactical/BAR-ATH_tactical_atd.{xml,txt}` in your bundle? The baseline needs both.
- Does `check_alignment_raw(source="broadcast")` report 164,488 records numbered 1 to n?
- What are the broadcast and tactical period parameters, and do they fall inside the raw
  frame-id range?
- Does the broadcast XML set `attack_direction_first_half`? If not, the orientation is `NOT_SET`.
- Do you need the broadcast at all? Nothing maps it to tactical, and building that mapping would
  be a research project of its own.
