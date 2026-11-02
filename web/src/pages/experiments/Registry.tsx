import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Download, GitCompare, Plus, RotateCcw } from "lucide-react";
import { EmptyState, SectionLabel } from "../../components/ui";
import {
  Button,
  Checkbox,
  ExperimentStatusBadge,
  LinkButton,
  MetricCell,
  PageHeader,
  SearchInput,
  Select,
  statusLabel,
  tableClasses as t,
} from "../../components/ui/controls";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { useToast } from "../../components/ui/Toast";
import { downloadText } from "../../lib/download";
import { defaultQuery, queryExperiments, readMetric, type ExperimentQuery, type SortKey } from "../../lib/research/experiments";
import { useResearch, useResearchStore } from "../../lib/store/useResearch";
import { useTitle } from "../../lib/useTitle";
import { EXPERIMENT_CATEGORIES, EXPERIMENT_STATUSES } from "../../types";
import s from "./experiments.module.css";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "created", label: "Created" },
  { value: "name", label: "Name" },
  { value: "spellF1", label: "spellF1" },
];

/** Query lives in the URL, so filters survive a refresh and the back button. */
function useQueryParams(): [ExperimentQuery, (patch: Partial<ExperimentQuery>) => void] {
  const [params, setParams] = useSearchParams();
  const query: ExperimentQuery = {
    search: params.get("q") ?? defaultQuery.search,
    status: (params.get("status") as ExperimentQuery["status"]) ?? defaultQuery.status,
    modelId: params.get("model") ?? defaultQuery.modelId,
    category: (params.get("category") as ExperimentQuery["category"]) ?? defaultQuery.category,
    sort: (params.get("sort") as SortKey) ?? defaultQuery.sort,
    direction: (params.get("dir") as ExperimentQuery["direction"]) ?? defaultQuery.direction,
  };
  const keys: Record<keyof ExperimentQuery, string> = { search: "q", status: "status", modelId: "model", category: "category", sort: "sort", direction: "dir" };
  const update = (patch: Partial<ExperimentQuery>) => {
    const next = new URLSearchParams(params);
    for (const [field, value] of Object.entries(patch) as [keyof ExperimentQuery, string][]) {
      if (value === defaultQuery[field]) next.delete(keys[field]);
      else next.set(keys[field], value);
    }
    setParams(next, { replace: true });
  };
  return [query, update];
}

export function Registry() {
  useTitle("Experiments");
  const { experiments, models } = useResearch();
  const store = useResearchStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [query, update] = useQueryParams();
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  const rows = useMemo(() => queryExperiments(experiments, query), [experiments, query]);
  const modelName = (id: string) => {
    const m = models.find((model) => model.id === id);
    return m ? `${m.name} · ${m.version}` : `${id} (deleted)`;
  };
  const filtered = query.search || query.status !== "all" || query.modelId !== "all" || query.category !== "all";
  const counts = Object.fromEntries(EXPERIMENT_STATUSES.map((st) => [st, experiments.filter((e) => e.status === st).length]));

  const toggle = (id: string) => setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const liveSelection = selected.filter((id) => experiments.some((e) => e.id === id));

  const exportAll = () => {
    const ok = downloadText(`barca-lab-research-${new Date().toISOString().slice(0, 10)}.json`, store.exportJson());
    toast(ok ? "Exported models, experiments and log as JSON." : "This browser can't download files.", ok ? "success" : "error");
  };

  return (
    <div className={s.page}>
      <PageHeader
        eyebrow={<SectionLabel rule>Lab · registry</SectionLabel>}
        title={
          <>
            Experiments<em>.</em>
          </>
        }
        lede="Each experiment records a hypothesis, a configuration and its results. Every metric keeps its provenance, so a number entered by hand is never mistaken for a verified run."
        actions={
          <>
            <Button icon={<Download size={16} aria-hidden="true" />} onClick={exportAll}>
              Export JSON
            </Button>
            <Button variant="ghost" icon={<RotateCcw size={16} aria-hidden="true" />} onClick={() => setConfirmReset(true)}>
              Reset
            </Button>
            <LinkButton to="/lab/experiments/new" variant="primary" icon={<Plus size={16} aria-hidden="true" />}>
              New experiment
            </LinkButton>
          </>
        }
      />

      <dl className={s.statusStrip}>
        {EXPERIMENT_STATUSES.map((st) => (
          <div key={st}>
            <dt>
              <ExperimentStatusBadge status={st} />
            </dt>
            <dd className="mono">{counts[st]}</dd>
          </div>
        ))}
      </dl>

      <div className={s.toolbar} role="search">
        <div className={s.searchBox}>
          <SearchInput label="Search experiments" placeholder="Search name, id, hypothesis…" value={query.search} onChange={(e) => update({ search: e.target.value })} />
        </div>
        <Select aria-label="Filter by status" value={query.status} onChange={(e) => update({ status: e.target.value as ExperimentQuery["status"] })}>
          <option value="all">All statuses</option>
          {EXPERIMENT_STATUSES.map((st) => (
            <option key={st} value={st}>
              {statusLabel(st)}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by model" value={query.modelId} onChange={(e) => update({ modelId: e.target.value })}>
          <option value="all">All models</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.version}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter by category" value={query.category} onChange={(e) => update({ category: e.target.value as ExperimentQuery["category"] })}>
          <option value="all">All categories</option>
          {EXPERIMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <div className={s.sortGroup}>
          <Select aria-label="Sort by" value={query.sort} onChange={(e) => update({ sort: e.target.value as SortKey })}>
            {SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                Sort: {o.label}
              </option>
            ))}
          </Select>
          <Button
            icon={query.direction === "desc" ? <ArrowDownWideNarrow size={16} aria-hidden="true" /> : <ArrowUpNarrowWide size={16} aria-hidden="true" />}
            label={query.direction === "desc" ? "Descending: switch to ascending" : "Ascending: switch to descending"}
            onClick={() => update({ direction: query.direction === "desc" ? "asc" : "desc" })}
          />
        </div>
      </div>

      <div className={s.selectionBar} aria-live="polite">
        <span>
          {rows.length} of {experiments.length} shown
          {liveSelection.length > 0 && ` · ${liveSelection.length} selected`}
        </span>
        <div className={s.selectionActions}>
          {liveSelection.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear selection
            </Button>
          )}
          <Button
            size="sm"
            icon={<GitCompare size={15} aria-hidden="true" />}
            disabled={liveSelection.length < 2}
            title={liveSelection.length < 2 ? "Select two or more experiments to compare" : undefined}
            onClick={() => navigate(`/lab/experiments/compare?ids=${liveSelection.join(",")}`)}
          >
            Compare {liveSelection.length >= 2 ? liveSelection.length : ""}
          </Button>
        </div>
      </div>

      {experiments.length === 0 ? (
        <EmptyState title="No experiments yet" action={<LinkButton to="/lab/experiments/new" variant="primary">Create the first experiment</LinkButton>}>
          Every experiment starts with a hypothesis. Record one before you run anything, so the result can be checked against what you expected.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing matches these filters"
          action={
            <Button onClick={() => update({ search: "", status: "all", modelId: "all", category: "all" })}>Clear filters</Button>
          }
        >
          {filtered ? "Try a broader search, or clear the filters." : null}
        </EmptyState>
      ) : (
        <div className={t.wrap}>
          <table className={`${t.table} ${s.registry}`}>
            <caption className="visually-hidden">Experiments, {SORTS.find((o) => o.value === query.sort)!.label}, {query.direction === "desc" ? "descending" : "ascending"}</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Select for comparison</span>
                </th>
                <th scope="col">Experiment</th>
                <th scope="col">Model</th>
                <th scope="col">Status</th>
                <th scope="col">spellF1</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} data-selected={liveSelection.includes(e.id) || undefined}>
                  <td className={s.selectCell}>
                    <Checkbox label={<span className="visually-hidden">Select {e.id} for comparison</span>} checked={liveSelection.includes(e.id)} onChange={() => toggle(e.id)} />
                  </td>
                  <td className={s.nameCell}>
                    <Link to={`/lab/experiments/${e.id}`} className={s.expLink}>
                      <span className={`mono ${s.expId}`}>{e.id}</span>
                      <span className={s.expName}>{e.name}</span>
                    </Link>
                    <p className={s.expHypothesis}>{e.hypothesis}</p>
                    <span className={s.category}>{e.category}</span>
                  </td>
                  <td className={s.modelCell} data-label="Model">{modelName(e.modelId)}</td>
                  <td data-label="Status">
                    <ExperimentStatusBadge status={e.status} />
                  </td>
                  <td data-label="spellF1">
                    <MetricCell reading={readMetric(e.metrics, "spellF1")} />
                  </td>
                  <td data-label="Updated" className="mono">
                    <time dateTime={e.updatedAt}>{e.updatedAt.slice(0, 10)}</time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmReset}
        title="Reset the registry?"
        confirmLabel="Reset to seed records"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          store.reset();
          setSelected([]);
          setConfirmReset(false);
          toast("Registry reset to the seed records.", "info");
        }}
      >
        <p>
          This replaces every model, experiment and log entry in this browser with the original seed records.
          Anything you created or edited will be lost. Export JSON first if you want a copy.
        </p>
      </ConfirmDialog>
    </div>
  );
}
