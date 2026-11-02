import { SectionLabel, EmptyState } from "../../components/ui";
import { Field, MetricCell, Select, tableClasses as t } from "../../components/ui/controls";
import { compareMetric, compareParams, summarise, type Comparable } from "../../lib/research/compare";
import { FEATURE_CATEGORIES, type Experiment, type ModelVersion } from "../../types";
import { FEATURE_TEXT, MODEL_STATUS_TEXT } from "./modelText";
import s from "./models.module.css";
import e from "../experiments/experiments.module.css";

/**
 * Two model versions, side by side. Metrics come from the model itself plus full-match results of
 * its experiments; the verdict logic in lib/research/compare decides whether any claim can be made.
 */
export function ModelCompare({
  models,
  experiments,
  params,
  setParam,
}: {
  models: ModelVersion[];
  experiments: Experiment[];
  params: URLSearchParams;
  setParam: (patch: Record<string, string | null>) => void;
}) {
  if (models.length < 2) {
    return (
      <EmptyState title="Two model versions are needed">
        Add another model version to compare it with the baseline.
      </EmptyState>
    );
  }

  const pick = (key: string, fallback: number) => (models.some((m) => m.id === params.get(key)) ? params.get(key)! : models[fallback]!.id);
  const aId = pick("a", 0);
  const bId = pick("b", models.findIndex((m) => m.id !== aId));
  const a = models.find((m) => m.id === aId)!;
  const b = models.find((m) => m.id === bId)!;

  const comparable = (m: ModelVersion): Comparable => ({
    id: m.id,
    label: `${m.name} ${m.version}`,
    // Only full-match measurements can say anything about competition performance.
    metrics: [...m.metrics, ...experiments.filter((x) => x.modelId === m.id).flatMap((x) => x.metrics)].filter((x) => x.scope === "full-match"),
    params: m.params,
  });
  const items = [comparable(a), comparable(b)];
  const spell = compareMetric(items, "spellF1");
  const macro = compareMetric(items, "macroF1");
  const { keys, differing } = compareParams(items);
  const expsOf = (m: ModelVersion) => experiments.filter((x) => x.modelId === m.id);
  const nothingMeasured = items.every((i) => i.metrics.length === 0);

  return (
    <div className={s.compare}>
      <div className={s.pickers}>
        <Field label="Model A">
          {(p) => (
            <Select {...p} value={aId} onChange={(ev) => setParam({ a: ev.target.value })}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.version}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <span className={s.vs} aria-hidden="true">
          vs
        </span>
        <Field label="Model B">
          {(p) => (
            <Select {...p} value={bId} onChange={(ev) => setParam({ b: ev.target.value })}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.version}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {aId === bId ? (
        <EmptyState title="Pick two different versions">The same model is selected on both sides.</EmptyState>
      ) : (
        <>
          <section className={e.verdict} data-kind={spell.verdict.kind} aria-label="Summary">
            <SectionLabel>Summary · full-match evidence only</SectionLabel>
            <p>{summarise(items, spell)}</p>
            {nothingMeasured && (
              <ul>
                <li>Before this comparison means anything, each model needs a full-match spellF1, ideally imported from the official scorer.</li>
                <li>Synthetic and public-window results are left out here on purpose. See each experiment for those.</li>
              </ul>
            )}
          </section>

          <div className={t.wrap}>
            <table className={`${t.table} ${e.compareTable}`}>
              <caption className="visually-hidden">Model comparison</caption>
              <thead>
                <tr>
                  <th scope="col"><span className="visually-hidden">Field</span></th>
                  <th scope="col">{a.name} · <span className="mono">{a.version}</span></th>
                  <th scope="col">{b.name} · <span className="mono">{b.version}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr className={a.category !== b.category ? e.diff : undefined}>
                  <th scope="row">Category</th>
                  <td>{a.category}</td>
                  <td>{b.category}</td>
                </tr>
                <tr>
                  <th scope="row">Status</th>
                  <td>{MODEL_STATUS_TEXT[a.status].label}</td>
                  <td>{MODEL_STATUS_TEXT[b.status].label}</td>
                </tr>
                <tr>
                  <th scope="row">Algorithm</th>
                  <td style={{ color: "var(--text-muted)" }}>{a.summary}</td>
                  <td style={{ color: "var(--text-muted)" }}>{b.summary}</td>
                </tr>
                <tr>
                  <th scope="row">spellF1</th>
                  {spell.readings.map(({ id, reading }) => (
                    <td key={id}><MetricCell reading={reading} showSource /></td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">macroF1</th>
                  {macro.readings.map(({ id, reading }) => (
                    <td key={id}><MetricCell reading={reading} showSource /></td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Runtime</th>
                  <td className="mono">{a.runtime || <span className={e.absent}>not measured</span>}</td>
                  <td className="mono">{b.runtime || <span className={e.absent}>not measured</span>}</td>
                </tr>
                <tr>
                  <th scope="row">Evidence</th>
                  {[a, b].map((m) => (
                    <td key={m.id}>
                      {FEATURE_CATEGORIES.filter((f) => m.features.includes(f)).map((f) => FEATURE_TEXT[f]).join(", ") || <span className={e.absent}>none</span>}
                    </td>
                  ))}
                </tr>
                {keys.map((key) => (
                  <tr key={key} className={differing.has(key) ? e.diff : undefined}>
                    <th scope="row" className="mono">
                      {key}
                      {differing.has(key) && <span className={e.diffMark}>differs</span>}
                    </th>
                    {[a, b].map((m) => (
                      <td key={m.id} className="mono">{key in m.params ? String(m.params[key]) : <span className={e.absent}>not set</span>}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row">Experiments</th>
                  {[a, b].map((m) => (
                    <td key={m.id}>{expsOf(m).map((x) => x.id).join(", ") || <span className={e.absent}>none</span>}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Limitations</th>
                  <td style={{ color: "var(--text-muted)" }}>{a.limitations || <span className={e.absent}>none recorded</span>}</td>
                  <td style={{ color: "var(--text-muted)" }}>{b.limitations || <span className={e.absent}>none recorded</span>}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
