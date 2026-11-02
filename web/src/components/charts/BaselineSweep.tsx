import type { MetricRecord } from "../../types";
import s from "./charts.module.css";

const MAX = 0.8; // axis ceiling; both metrics sit well inside it

interface Row {
  window: number;
  label: string;
  result: MetricRecord;
}

/**
 * Dumbbell chart: one row per smoothing window, macroF1 and spellF1 on a shared 0–0.8 axis.
 * Built from HTML rather than SVG so labels stay crisp and reflow at every width.
 */
export function BaselineSweep({ rows, highlight }: { rows: Row[]; highlight: number }) {
  const pct = (v: number) => `${(v / MAX) * 100}%`;

  return (
    <figure className={s.sweep}>
      <div className={s.sweepKey} aria-hidden="true">
        <span><i className={s.dotMacro} /> macroF1 · per frame</span>
        <span><i className={s.dotSpell} /> spellF1 · whole possessions (ranked)</span>
      </div>

      <table className={s.sweepTable}>
        <caption className="visually-hidden">
          Full-match scores of the four published baseline variants
        </caption>
        <thead className="visually-hidden">
          <tr>
            <th scope="col">Window</th>
            <th scope="col">Chart</th>
            <th scope="col">macroF1</th>
            <th scope="col">spellF1</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ window, label, result }) => {
            const macro = result.metrics.macroF1 ?? 0;
            const spell = result.metrics.spellF1 ?? 0;
            const isFloor = window === highlight;
            return (
              <tr key={window} className={isFloor ? s.sweepFloor : undefined}>
                <th scope="row" className={s.sweepLabel}>
                  <span className="mono">{label}</span>
                  {isFloor && <span className={s.floorTag}>floor</span>}
                </th>
                <td className={s.sweepTrackCell} aria-hidden="true">
                  <div className={s.sweepTrack}>
                    <span className={s.sweepBar} style={{ left: pct(spell), width: `calc(${pct(macro)} - ${pct(spell)})` }} />
                    <span className={s.dotSpell} style={{ left: pct(spell) }} />
                    <span className={s.dotMacro} style={{ left: pct(macro) }} />
                  </div>
                </td>
                <td className={`mono ${s.sweepValue}`}>{macro.toFixed(4)}</td>
                <td className={`mono ${s.sweepValue} ${s.sweepSpell}`}>{spell.toFixed(4)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className={s.sweepAxis} aria-hidden="true">
        {[0, 0.2, 0.4, 0.6, 0.8].map((tick) => (
          <span key={tick} style={{ left: pct(tick) }}>
            {tick.toFixed(1)}
          </span>
        ))}
      </div>
    </figure>
  );
}
