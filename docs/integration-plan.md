# Official-match integration plan

How real model outputs reach Barça Lab without the agent, the browser or any hosted service
touching restricted match data.

Everything here was established from **public** sources: this repository's code and docs, and the
public source of kloppy 3.18.0 (the version pinned in `requirements-starter.txt`). No restricted
file was opened. Each claim is tagged:

- **[code]** verified from public source code
- **[doc]** stated in this repository's documentation (not re-derived)
- **[kloppy]** verified from kloppy 3.18.0 source on GitHub
- **[screenshot]** only seen in a screenshot of an XML preview. Unverified.
- **[unknown]** not established

---

## 1. Does the official workflow support `BAR-ATH_broadcast_atd.xml`?

**Yes. It is an expected file, but it is the wrong half of the wrong source for a submission.**

- `games.py` names exactly this file: source `broadcast`, stem `BAR-ATH_broadcast`, suffix
  `_atd.xml` → `data/broadcast/BAR-ATH_broadcast_atd.xml`. **[code]**
- The `.xml` is **metadata only**. The tracking itself is the companion `_atd.txt`. `load_atd.load()`
  passes both to `kloppy.metrica.load_tracking_epts(meta_data=…, raw_data=…)`, and
  `baseline.py` reads both. **[code]**
- Each line of the raw `.txt` is `<frame_id>:<player>;<player>;…:<ball>`, each group `x,y,speed`.
  **[code]** (`baseline.py`, `load_atd.py`)
- **The submission is indexed to the tactical video, not the broadcast.** Row *i* is frame *i* of
  `BAR-ATH_tactical.mp4`, which has 199,319 frames. A file built on broadcast frames (164,488) fails the
  row-count check. **[code]** `games.py` · **[doc]** DATA.md
- The broadcast recording is **not synchronised** to tactical, and **no mapping is provided**. It has
  cuts, replays and zooms. **[doc]** DATA.md, FAQ.md

**Consequence.** As described, the Drive folder holds broadcast video, homography and the broadcast
ATD XML. That is not enough to run the official baseline. `baseline.py` calls
`require(["atd_meta", "atd_raw"])` with the default source **tactical**, so it needs
`data/tactical/BAR-ATH_tactical_atd.xml` **and** `data/tactical/BAR-ATH_tactical_atd.txt`. **[code]**
If the broadcast `_atd.txt` is also missing, the broadcast ATD can't be loaded either. kloppy needs
both files. **[code]** Whether those files exist elsewhere in the bundle is **[unknown]** to the agent.

## 2. How ATD, homography and broadcast video relate

| | tactical | broadcast |
|---|---|---|
| role | the reference; submission row *i* = frame *i* **[code]** | optional extra input, own timeline **[doc]** |
| video frames | 199,319 **[code]** | 164,488 **[code]** |
| ATD records | 199,319 **[doc]** | 164,488 **[doc]** |
| homography rows | 199,319, valid on 100% **[doc]** | 164,488, valid on 65.8% **[doc]** |
| Smart Tagging | yes, timed against tactical **[code]** | none **[code]** |

- Homography CSV: `frame,h00…h22,reprojection_error,valid`, one row per video frame of **its own
  recording**, `frame` counting from 0. **[code]** `load_homography.py`
- The matrix maps **normalised pitch coordinates (0–1)** to **image pixels**. Those are the same 0–1
  coordinates the ATD reports, so tracking goes in with no conversion. Don't multiply by metres
  before projecting. **[code]**
- Where `valid == 0` the matrix is NaN. `reprojection_error` is lower-is-better and unbounded (the
  broadcast reaches 304). **[doc]**
- So broadcast ATD, broadcast homography and broadcast video share **one timeline**, and tactical has its
  own. Nothing links the two. **[doc]**

## 3. Temporal alignment and coordinates

**Frame numbering**

- Tactical ATD `frame_id` runs **1 … 199,319**, one record per video frame:
  `video_frame = frame_id − 1`. **[code]** `load_atd.py`, `baseline.py` (`out[int(parts[0]) - 1]`)
- `load_atd.check_alignment_raw(source=…)` verifies this on any export (record count = video length,
  ids exactly 1…n). **[code]** For the broadcast source it expects 164,488. **[code]**
- `games.py` also carries per-half offsets of about 1.7 million (`id_frame = video_frame + 1702057/8`) and
  IdFrame half spans. `load_atd.py` states these describe **"the separate counter the ground truth
  was derived from, which you never see"**. They aren't for reading the ATD. **[code]** (These two
  conventions must not be mixed.)
- Graded tactical video frames: 11,185–90,651 and 110,808–190,197. The second half is graded from
  110,808, but kick-off is at 113,742. **[code]** `games.half_video_blocks` · **[doc]** FAQ.md
- Frame rate: 25 fps for tactical. **[code]** `games.py`. Smart Tagging times are seconds from the start
  of the tactical video, so `round(s × 25)` gives the frame. **[doc]**

**Coordinates**

- ATD positions are **normalised 0–1**. Multiply by pitch metres for distances. The metadata says
  105 × 68, and `games.py` uses 105.3 × 68.0. **[code]**
- kloppy's Metrica coordinate system: origin **top-left**, y **top-to-bottom**, x and y in [0, 1].
  **[kloppy]** `MetricaCoordinateSystem` (inherits `KloppyCoordinateSystem`)
- Pitch dimensions are read only when the position sensor unit is `normalized`: length comes from
  `FieldSize/Width` and width from `FieldSize/Height`. **[kloppy]**
- Attacking direction comes from the home team's provider parameter `attack_direction_first_half`.
  Without it, the orientation is `NOT_SET` and kloppy warns. **[kloppy]**
- Track slots are tracklets, not people. There are 46 slots for 22 players, and `ShirtNumber` is the slot
  index. **[code]** `baseline.py`

## 4. What `first_half_end = 16448` means

**What the screenshot shows [screenshot]:** the broadcast ATD XML declares FIFA Data Transfer Format
(EPTS), Optical/Tracking, provider Metrica Sports, 25.0 FPS, and a provider parameter
`first_half_end` with the value 16448, among other period parameters.

**How the official loader interprets such a value [kloppy]:**

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

So **kloppy treats `first_half_end` as a frame number on the same counter as the raw `frame_id`**.
It is not a timestamp in seconds. Frames whose `frame_id / fps` falls outside every period are kept,
with `period_id = None`. kloppy reads `<FrameRate>` with `int(...)`. **[kloppy]**

**What that would imply, not verified:** under kloppy's reading, 16448 frames ÷ 25 fps = 657.92 s, so
the first half would end **10 min 57.9 s** into the broadcast counter. A real first half lasts about
46 minutes (about 69,000 frames), so if the value is what it looks like, either:

1. the broadcast counter or recording doesn't start near kick-off, or covers only part of the half,
2. the parameter means something other than a full-half boundary in this export,
3. the preview truncated a longer number (the broadcast's total of 164,488 is suggestively similar), or
4. the export's period parameters are simply wrong for the broadcast.

**[unknown]** None of these can be decided without reading the file, and the agent will not read it.
Note also that kloppy computes the period from `frame_id / fps`, so if the parameters are wrong,
`period_id` is wrong for every frame. That matters only if you use kloppy's periods; the baseline
doesn't.

**How to settle it locally:** run `python tools/inspect_atd_metadata.py --source broadcast` on
your own machine (see §5). It prints the declared frame rate and every period parameter, each
converted to minutes. If `_atd.txt` is present, it also prints the raw frame-id range, then states
whether each boundary falls inside that range. **Read the output yourself.** The competition terms
forbid making the datasets, or extracts of them, available to a hosted LLM. That includes pasting
this output, or screenshots of the XML, into a chat.

## 5. Permitted local commands and the output contract

All of these run on your machine, against data you unpacked into `data/` (or `MTAH_DATA_DIR`).

```bash
pip install -r requirements.txt
python starter/baseline.py                                   # reads tactical ATD → evaluation/results/baseline_*.csv
python evaluation/validate_submission.py evaluation/results/<name>.csv
python evaluation/run_evaluation.py                          # public 5 min → evaluation/scoreboard.csv + reports/<name>.json
python tools/inspect_atd_metadata.py --source tactical       # metadata/period check (new, read-only)
```

- `--gt private` exists only on organisers' machines. **Participants can only score the public
  window** (7,500 graded frames, 17 possessions). **[code]** **[doc]** A *full-match* verified score
  can therefore only come from the organisers.
- Using the public window to choose between versions is against the rules. It's for checking the
  pipeline. **[doc]** RULES.md, EVALUATION.md

**Submission contract [code]** (`possession_metrics.validate_submission`):
header columns `frame` and `label` (case and whitespace tolerated), exactly 199,319 rows, `frame` an
integer column equal to 0…199318 in order, labels in H/A/D/X after strip and upper-casing, and no blank or
NA cells (pandas' default NA strings count as blank). Your repository must regenerate the file
byte for byte.

**Scorer report contract [code]** (`run_evaluation.py` → `reports/<name>.json`, via `json_safe`):
`submission`, `ground_truth` (basename), `spell_f1_mean`, `macro_f1`, `n_frames`, `n_graded`,
`n_gt_spells`, `n_pred_spells`, `spell_f1` per IoU, `per_class`, `confusion`, `transitions`, and
more. The field list was confirmed by scoring an all-X dummy (no match information) into a
scratch folder; only field names and types were inspected.

## 6. The adapter: real outputs into the web app

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

Implemented in `web/` (Lab → **Runs**):

1. **Submission check:** pick a `frame,label` CSV. The browser applies the validator's rules and
   shows label counts and the predicted possession count, as `validate_submission.py` prints them.
   The file is read **in memory only**. It is never stored, uploaded or rendered as a timeline. The
   Python validator stays authoritative.
2. **Scorer report import:** pick `evaluation/reports/<name>.json`. The browser checks its structure:
   field types, `n_frames = 199,319`, and ranges. It derives the scope from `ground_truth` and
   cross-checks it against `n_graded` and `n_gt_spells` (public: 7,500 / 17; full match: 158,857). Only
   aggregates (spellF1, macroF1, predicted spells, alive/dead F1) are attached to an experiment, with
   provenance **verified**, the scope, and a source line carrying the file's SHA-256.
   - The browser can check the structure, but **not authenticity**: a hand-edited report would pass.
     The UI says so. Re-running `run_evaluation.py` reproduces it.
   - Comparisons on **public-window** values never name a winner, because 17 possessions can't rank.
     Methodology stages still only become *verified* on **full-match** verified metrics.
3. **Never:** per-frame labels in storage, match data in `web/`, the dev server reading outside `web/`,
   or any upload.

## 7. Open questions, resolved only by you, locally

- Is `data/tactical/BAR-ATH_tactical_atd.{xml,txt}` in your bundle? The baseline needs both.
- Does `check_alignment_raw(source="broadcast")` report 164,488 records numbered 1…n?
- What are the broadcast and tactical period parameters, and do they lie inside the raw frame-id range?
- Does the broadcast XML set `attack_direction_first_half`? Otherwise the orientation is `NOT_SET`.
- Do you need the broadcast at all? Nothing maps it to tactical, and building that mapping is a
  research project in itself.
