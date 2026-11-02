// What is known about the official match files, and how it is known. Mirrors
// docs/integration-plan.md. Every entry is a statement about public code or documentation, or an
// explicit "unknown": nothing here comes from reading a restricted file.

export type Basis = "code" | "doc" | "kloppy" | "screenshot" | "unknown";

export const BASIS_TEXT: Record<Basis, { label: string; description: string }> = {
  code: { label: "Verified · code", description: "Read in this repository's public source" },
  doc: { label: "Documented", description: "Stated in the repository's docs" },
  kloppy: { label: "Verified · kloppy", description: "Read in kloppy 3.18.0's public source (the pinned version)" },
  screenshot: { label: "Screenshot only", description: "Seen in a preview image; unverified" },
  unknown: { label: "Unknown", description: "Not established; check it locally" },
};

export interface Fact {
  topic: string;
  claim: string;
  basis: Basis;
  ref?: string;
}

export const facts: Fact[] = [
  { topic: "Submission index", claim: "Row i is frame i of the tactical video, 199,319 rows. Broadcast frames (164,488) fail the row check.", basis: "code", ref: "games.py" },
  { topic: "Broadcast alignment", claim: "The broadcast isn't synchronised to tactical, and no mapping is provided.", basis: "doc", ref: "DATA.md" },
  { topic: "ATD files", claim: "The ATD is a pair: _atd.xml (metadata) plus _atd.txt (raw tracking). kloppy and the baseline need both.", basis: "code", ref: "starter/load_atd.py" },
  { topic: "Baseline input", claim: "baseline.py reads the tactical _atd.xml and _atd.txt. A broadcast-only folder can't run it.", basis: "code", ref: "starter/baseline.py" },
  { topic: "Frame ids", claim: "Tactical ATD frame_id runs 1…199,319, so video_frame = frame_id − 1.", basis: "code", ref: "starter/load_atd.py" },
  { topic: "Other counter", claim: "games.py's ~1.7M offsets describe the ground truth's own counter, not the ATD.", basis: "code", ref: "starter/load_atd.py" },
  { topic: "Coordinates", claim: "ATD x and y are normalised 0–1, origin top-left, y top-to-bottom. Scale by 105.3 × 68.0 m for metres.", basis: "kloppy", ref: "MetricaCoordinateSystem" },
  { topic: "Homography", claim: "Maps normalised pitch (0–1) to image pixels, one row per frame of its own recording. NaN where valid is 0.", basis: "code", ref: "starter/load_homography.py" },
  { topic: "Period parameters", claim: "kloppy reads *_start / *_end as frame numbers: seconds = value / frame_rate.", basis: "kloppy", ref: "metrica_epts/metadata.py" },
  { topic: "Broadcast XML header", claim: "FIFA/EPTS, Optical/Tracking, Metrica Sports, 25.0 FPS, first_half_end = 16448.", basis: "screenshot" },
  { topic: "first_half_end = 16448", claim: "Under kloppy's reading that is 10:57.9 into the counter, far short of a ~46-minute half. Its meaning is unresolved.", basis: "unknown" },
  { topic: "Tactical files present", claim: "Whether your bundle has data/tactical/BAR-ATH_tactical_atd.{xml,txt}.", basis: "unknown" },
  { topic: "Full-match score", claim: "Only organisers hold the private ground truth. Participants can score the public 5 minutes only.", basis: "code", ref: "evaluation/run_evaluation.py" },
];

export const COMMANDS: { command: string; what: string }[] = [
  { command: "python tools/inspect_atd_metadata.py --source tactical", what: "Period parameters against raw frame ids. Read-only; keep the output local." },
  { command: "python starter/baseline.py", what: "Reads the tactical ATD and writes evaluation/results/baseline_*.csv." },
  { command: "python evaluation/validate_submission.py evaluation/results/<name>.csv", what: "The authoritative format check." },
  { command: "python evaluation/run_evaluation.py", what: "Scores on the public 5 minutes and writes evaluation/reports/<name>.json." },
];
