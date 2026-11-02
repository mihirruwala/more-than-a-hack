import type { PossessionSegment, PossessionState } from "../../types";
import s from "./charts.module.css";

export const STATE_NAME: Record<PossessionState, string> = {
  H: "Home possession",
  A: "Away possession",
  D: "Dead ball",
  X: "No answer",
};

const fmt = (frames: number, fps: number) => {
  const seconds = Math.round(frames / fps);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** A horizontal possession timeline. Static; the interactive version lives in the Match Centre. */
export function PossessionStrip({
  segments,
  fps,
  label,
  tall = false,
}: {
  segments: PossessionSegment[];
  fps: number;
  label: string;
  tall?: boolean;
}) {
  const total = segments.length ? segments[segments.length - 1]!.end : 0;
  const minutes = Math.floor(total / fps / 60);
  const ticks = Array.from({ length: Math.floor(minutes / 2) + 1 }, (_, i) => i * 2);

  return (
    <figure className={s.strip}>
      <div className={tall ? `${s.stripTrack} ${s.stripTall}` : s.stripTrack} role="img" aria-label={label}>
        {segments.map((segment) => (
          <span
            key={segment.start}
            className={s[`seg${segment.state}`]}
            style={{
              left: `${(segment.start / total) * 100}%`,
              width: `${((segment.end - segment.start) / total) * 100}%`,
            }}
            title={`${STATE_NAME[segment.state]} · ${fmt(segment.start, fps)}–${fmt(segment.end, fps)}`}
          />
        ))}
      </div>
      <div className={s.stripAxis} aria-hidden="true">
        {ticks.map((minute) => (
          <span key={minute} style={{ left: `${((minute * 60 * fps) / total) * 100}%` }}>
            {minute}′
          </span>
        ))}
      </div>
    </figure>
  );
}

export function StateLegend() {
  return (
    <ul className={s.legend}>
      {(Object.keys(STATE_NAME) as PossessionState[]).map((state) => (
        <li key={state}>
          <span className={s[`key${state}`]} aria-hidden="true" />
          <span className="mono">{state}</span> {STATE_NAME[state]}
        </li>
      ))}
    </ul>
  );
}
