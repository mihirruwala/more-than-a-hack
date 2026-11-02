import { SectionLabel } from "../../components/ui";
import { dimensions, type DimensionStatus } from "../../data/fixtures/methodology";
import s from "./models.module.css";

const STATUS: Record<DimensionStatus, string> = {
  implemented: "Implemented",
  experimental: "Experimental",
  planned: "Planned",
};

/** The pipeline as a flow. Solid boxes exist in code; dashed boxes are planned. */
const FLOW: { label: string; status: DimensionStatus; note: string }[] = [
  { label: "Tracking", status: "implemented", note: "ATD, 25 fps" },
  { label: "Spatial", status: "implemented", note: "nearest player" },
  { label: "Motion", status: "planned", note: "ball flight" },
  { label: "Inference", status: "implemented", note: "majority vote" },
  { label: "Dead ball", status: "experimental", note: "gap rules" },
  { label: "Cleanup", status: "implemented", note: "segments" },
  { label: "Labels", status: "implemented", note: "H · A · D · X" },
];

export function Dimensions() {
  return (
    <div className={s.dimensions}>
      <figure className={s.flow} aria-labelledby="flow-caption">
        <figcaption id="flow-caption">
          <SectionLabel>The pipeline today</SectionLabel>
          <span className={s.flowKey}>
            <span data-status="implemented">Implemented</span>
            <span data-status="experimental">Experimental</span>
            <span data-status="planned">Planned</span>
          </span>
        </figcaption>
        <ol>
          {FLOW.map((step) => (
            <li key={step.label} data-status={step.status}>
              <span className={s.flowLabel}>{step.label}</span>
              <span className={s.flowNote}>{step.note}</span>
              <span className="visually-hidden"> ({STATUS[step.status]})</span>
            </li>
          ))}
        </ol>
      </figure>

      <ul className={s.dimGrid}>
        {dimensions.map((d) => (
          <li key={d.id} className={s.dimCard} data-status={d.status}>
            <div className={s.dimHead}>
              <h3>{d.title}</h3>
              <span className={s.dimStatus} data-status={d.status}>
                {STATUS[d.status]}
              </span>
            </div>
            <p className={s.dimQuestion}>{d.question}</p>
            <p className={s.dimCurrent}>
              <span>Today</span>
              {d.current}
            </p>
          </li>
        ))}
      </ul>
      <p className={s.footnote}>
        “Implemented” means the code exists in this repository. It isn't a claim that the dimension improves the score. Only a verified
        full-match experiment can show that.
      </p>
    </div>
  );
}
