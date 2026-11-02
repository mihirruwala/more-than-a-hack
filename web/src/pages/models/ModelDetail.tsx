import { Link } from "react-router";
import { EmptyState, Panel, ProvenanceBadge, SectionLabel } from "../../components/ui";
import { ExperimentStatusBadge, MetricCell, tableClasses as t } from "../../components/ui/controls";
import { readMetric } from "../../lib/research/experiments";
import { lastEvaluated } from "../../lib/research/models";
import { FEATURE_CATEGORIES, type Experiment, type ModelVersion } from "../../types";
import { FEATURE_TEXT, MODEL_STATUS_TEXT } from "./modelText";
import s from "./models.module.css";

export function ModelDetail({ model, experiments }: { model: ModelVersion; experiments: Experiment[] }) {
  const evaluated = lastEvaluated(model, experiments.flatMap((e) => e.metrics));
  const params = Object.entries(model.params);

  return (
    <article className={s.detail} aria-labelledby="model-title">
      <header className={s.detailHead}>
        <SectionLabel>
          {model.kind} · {model.category}
        </SectionLabel>
        <h2 id="model-title" className={`display ${s.detailTitle}`}>
          {model.name} <span className="mono">{model.version}</span>
        </h2>
        <p className={s.summary}>{model.summary}</p>
      </header>

      <dl className={s.facts}>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={s.listStatus} data-status={model.status}>
              {MODEL_STATUS_TEXT[model.status].label}
            </span>
            <span className={s.factNote}>{MODEL_STATUS_TEXT[model.status].description}</span>
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd className="mono">{model.source || <span className={s.muted}>not written yet</span>}</dd>
        </div>
        <div>
          <dt>Last evaluated</dt>
          <dd className="mono">{evaluated ? evaluated.slice(0, 10) : <span className={s.muted}>never</span>}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd className="mono">{model.runtime || <span className={s.muted}>not measured</span>}</dd>
        </div>
      </dl>

      <div className={s.twoCol}>
        <Panel title="Intended behaviour" labelledBy="intent-title">
          <p className={s.body}>{model.intendedBehaviour || <span className={s.muted}>Not described.</span>}</p>
        </Panel>
        <Panel title="Evidence used" labelledBy="features-title">
          <ul className={s.features}>
            {FEATURE_CATEGORIES.map((f) => {
              const on = model.features.includes(f);
              return (
                <li key={f} data-on={on}>
                  <span aria-hidden="true">{on ? "●" : "○"}</span>
                  {FEATURE_TEXT[f]}
                  <span className="visually-hidden">{on ? " (used)" : " (not used)"}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <Panel title="Configuration" labelledBy="model-config-title">
        {params.length ? (
          <div className={t.wrap}>
            <table className={t.table}>
              <caption className="visually-hidden">Model parameters</caption>
              <thead>
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                {params.map(([key, value]) => (
                  <tr key={key}>
                    <td className="mono">{key}</td>
                    <td className="mono">{String(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={s.muted}>No parameters recorded.</p>
        )}
      </Panel>

      <Panel title="Recorded evaluation" labelledBy="model-eval-title">
        {model.metrics.length === 0 && experiments.every((e) => e.metrics.length === 0) ? (
          <EmptyState title="Nothing measured yet">
            Results appear here once an experiment on this model records a metric. Until a verified full-match run exists, there is no evidence
            about this model's competition performance either way.
          </EmptyState>
        ) : (
          <div className={s.evalGrid}>
            {model.metrics.length > 0 && (
              <div>
                <SectionLabel>Attached to the model</SectionLabel>
                <ul className={s.metricList}>
                  {model.metrics.map((m) => (
                    <li key={m.id}>
                      <span className="mono">{m.key}</span>
                      <span className="mono">{m.value.toFixed(4)}</span>
                      <ProvenanceBadge provenance={m.provenance} />
                      <span className={s.metricSource}>
                        {m.scope} · {m.source}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {experiments.length > 0 && (
              <div>
                <SectionLabel>From experiments</SectionLabel>
                <ul className={s.expList}>
                  {experiments.map((e) => (
                    <li key={e.id}>
                      <Link to={`/lab/experiments/${e.id}`}>
                        <span className="mono">{e.id}</span> {e.name}
                      </Link>
                      <ExperimentStatusBadge status={e.status} />
                      <MetricCell reading={readMetric(e.metrics, "spellF1")} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className={s.twoCol}>
        <Panel title="Known limitations" labelledBy="limits-title">
          <p className={s.body}>{model.limitations || <span className={s.muted}>None recorded. That doesn't mean there are none.</span>}</p>
        </Panel>
        <Panel title="Notes" labelledBy="model-notes-title">
          <p className={s.body}>{model.notes || <span className={s.muted}>No notes.</span>}</p>
        </Panel>
      </div>
    </article>
  );
}
