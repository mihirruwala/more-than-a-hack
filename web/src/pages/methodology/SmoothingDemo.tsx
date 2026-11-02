import { useId, useMemo, useState } from "react";
import { SectionLabel } from "../../components/ui";
import { TOY_NOISY, TOY_TRUTH, agreement, countSpells, majority, runs, type Toy } from "../../lib/toySmoothing";
import s from "./methodology.module.css";

function Strip({ labels, label }: { labels: Toy[]; label: string }) {
  return (
    <div className={s.toyRow}>
      <span className={s.toyLabel}>{label}</span>
      <div className={s.toyTrack} role="img" aria-label={`${label}: ${countSpells(labels)} possessions`}>
        {runs(labels).map((r) => (
          <span
            key={r.start}
            className={r.state === "H" ? s.toyH : s.toyA}
            style={{ left: `${(r.start / labels.length) * 100}%`, width: `${((r.end - r.start) / labels.length) * 100}%` }}
          />
        ))}
      </div>
      <span className={`mono ${s.toyCount}`}>{countSpells(labels)}</span>
    </div>
  );
}

/**
 * The smoothing trade-off on a toy signal. The radius is the one knob the baseline sweep turns, and
 * the same two failure modes appear: too little smoothing invents possessions, too much erases a
 * short real one.
 */
export function SmoothingDemo() {
  const [radius, setRadius] = useState(12);
  const id = useId();
  const smoothed = useMemo(() => majority(TOY_NOISY, radius), [radius]);
  const truthSpells = countSpells(TOY_TRUTH);
  const spells = countSpells(smoothed);
  const frameAgreement = agreement(smoothed, TOY_TRUTH);
  const shortKept = smoothed.slice(230, 256).filter((l) => l === "H").length > 13;

  const verdict =
    spells > truthSpells * 2
      ? "Under-smoothed: per-frame agreement looks high, but flicker invents many possessions that never happened."
      : !shortKept
        ? "Over-smoothed: the short real possession has been voted away, and two of the opponent's possessions have merged into one."
        : spells === truthSpells
          ? "This window recovers the true possession count here. On a real match there is no single right window, which is the case for a structural model."
          : "Close. A few extra fragments remain.";

  return (
    <section className={s.demo} aria-labelledby={`${id}-title`}>
      <div className={s.demoHead}>
        <div>
          <SectionLabel>Interactive illustration</SectionLabel>
          <h3 id={`${id}-title`} className={`display ${s.demoTitle}`}>
            How much smoothing?
          </h3>
        </div>
        <span className={s.toyTag}>Toy signal · synthetic · not the model</span>
      </div>

      <div className={s.slider}>
        <label htmlFor={`${id}-window`}>
          Majority-vote window <span className="mono">±{radius} frames</span>
        </label>
        <input id={`${id}-window`} type="range" min={0} max={60} step={1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
      </div>

      <div className={s.toy}>
        <div className={s.toyHeadRow} aria-hidden="true">
          <span />
          <span />
          <span className={s.toyCountHead}>possessions</span>
        </div>
        <Strip labels={TOY_TRUTH} label="Truth" />
        <Strip labels={TOY_NOISY} label="Per-frame guess" />
        <Strip labels={smoothed} label={`Smoothed ±${radius}`} />
      </div>

      <dl className={s.toyStats}>
        <div>
          <dt>Frames that agree with the truth</dt>
          <dd className="mono">{(frameAgreement * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Possessions, against {truthSpells} true</dt>
          <dd className="mono">{spells}</dd>
        </div>
        <div>
          <dt>Short real possession</dt>
          <dd>{shortKept ? "kept" : "erased"}</dd>
        </div>
      </dl>
      <p className={s.demoVerdict} aria-live="polite">
        {verdict}
      </p>
      <p className={s.demoFoot}>
        Frame agreement and possession count can disagree sharply. That disagreement is why the competition ranks on spellF1 (whole possessions)
        rather than per-frame accuracy.
      </p>
    </section>
  );
}
