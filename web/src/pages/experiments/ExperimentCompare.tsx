import { Link, useSearchParams } from "react-router";
import { EmptyState, SectionLabel } from "../../components/ui";
import { ExperimentStatusBadge, LinkButton, MetricCell, PageHeader, tableClasses as t } from "../../components/ui/controls";
import { compareMetric, compareParams, metricKeys, summarise, type Comparable } from "../../lib/research/compare";
import { useResearch } from "../../lib/store/useResearch";
import { useTitle } from "../../lib/useTitle";
import s from "./experiments.module.css";

export function ExperimentCompare() {
  useTitle("Compare experiments");
  const [params] = useSearchParams();
  const { experiments, models } = useResearch();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const chosen = ids.map((id) => experiments.find((e) => e.id === id)).filter((e) => e !== undefined);
  const missing = ids.filter((id) => !experiments.some((e) => e.id === id));

  if (chosen.length < 2) {
    return (
      <div className={s.page}>
        <PageHeader crumbs={[{ to: "/lab/experiments", label: "Experiments" }]} title="Compare experiments" />
        <EmptyState title="Choose at least two experiments" action={<LinkButton to="/lab/experiments">Select in the registry</LinkButton>}>
          {missing.length ? `Not found: ${missing.join(", ")}. ` : ""}Tick two or more rows in the registry, then press Compare.
        </EmptyState>
      </div>
    );
  }

  const items: Comparable[] = chosen.map((e) => ({ id: e.id, label: e.id, metrics: e.metrics, params: e.params }));
  const keys = metricKeys(items);
  const comparisons = keys.map((key) => compareMetric(items, key));
  const primary = comparisons[0]!;
  const { keys: paramKeys, differing } = compareParams(items);
  const modelName = (id: string) => {
    const m = models.find((model) => model.id === id);
    return m ? `${m.name} · ${m.version}` : `${id} (deleted)`;
  };

  return (
    <div className={s.page}>
      <PageHeader
        crumbs={[{ to: "/lab/experiments", label: "Experiments" }]}
        eyebrow={<SectionLabel rule>Comparison · {chosen.length} experiments</SectionLabel>}
        title="Side by side"
      />

      <section className={s.verdict} data-kind={primary.verdict.kind} aria-label="Summary">
        <SectionLabel>Summary · built only from recorded values</SectionLabel>
        <p>{summarise(items, primary)}</p>
        {primary.verdict.kind === "insufficient" && primary.verdict.reasons.length > 1 && (
          <ul>
            {primary.verdict.reasons.slice(1).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {missing.length > 0 && <p style={{ fontSize: 14 }}>Not found and left out: {missing.join(", ")}.</p>}
      </section>

      <div className={t.wrap}>
        <table className={`${t.table} ${s.compareTable}`}>
          <caption className="visually-hidden">Experiments compared side by side</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Field</span>
              </th>
              {chosen.map((e) => (
                <th key={e.id} scope="col">
                  <Link to={`/lab/experiments/${e.id}`}>{e.id}</Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Name</th>
              {chosen.map((e) => <td key={e.id}>{e.name}</td>)}
            </tr>
            <tr>
              <th scope="row">Hypothesis</th>
              {chosen.map((e) => <td key={e.id} style={{ color: "var(--text-muted)" }}>{e.hypothesis}</td>)}
            </tr>
            <tr>
              <th scope="row">Status</th>
              {chosen.map((e) => <td key={e.id}><ExperimentStatusBadge status={e.status} /></td>)}
            </tr>
            <tr className={new Set(chosen.map((e) => e.modelId)).size > 1 ? s.diff : undefined}>
              <th scope="row">Model</th>
              {chosen.map((e) => <td key={e.id}>{modelName(e.modelId)}</td>)}
            </tr>
            {comparisons.map((cmp) => (
              <tr key={cmp.key}>
                <th scope="row" className="mono">{cmp.key}</th>
                {cmp.readings.map(({ id, reading }) => (
                  <td key={id}>
                    <MetricCell reading={reading} showSource />
                  </td>
                ))}
              </tr>
            ))}
            {paramKeys.map((key) => (
              <tr key={key} className={differing.has(key) ? s.diff : undefined}>
                <th scope="row" className="mono">
                  {key}
                  {differing.has(key) && <span className={s.diffMark}>differs</span>}
                </th>
                {chosen.map((e) => (
                  <td key={e.id} className="mono">
                    {key in e.params ? String(e.params[key]) : <span className={s.absent}>not set</span>}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row">Observations</th>
              {chosen.map((e) => <td key={e.id} style={{ color: "var(--text-muted)" }}>{e.observations || <span className={s.absent}>none</span>}</td>)}
            </tr>
            <tr>
              <th scope="row">Limitations</th>
              {chosen.map((e) => <td key={e.id} style={{ color: "var(--text-muted)" }}>{e.limitations || <span className={s.absent}>none</span>}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
