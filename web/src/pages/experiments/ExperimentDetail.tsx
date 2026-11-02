import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState, Panel, ProvenanceBadge, SectionLabel } from "../../components/ui";
import {
  Button,
  ExperimentStatusBadge,
  Field,
  Input,
  LinkButton,
  MetricCell,
  Notice,
  PageHeader,
  Select,
  Textarea,
  statusLabel,
  tableClasses as t,
} from "../../components/ui/controls";
import { ConfirmDialog, Dialog } from "../../components/ui/Dialog";
import { useToast } from "../../components/ui/Toast";
import { TRANSITIONS, emptyMetricDraft, readMetric, type FieldErrors, type MetricDraft } from "../../lib/research/experiments";
import { useResearch, useResearchStore } from "../../lib/store/useResearch";
import { useTitle } from "../../lib/useTitle";
import type { Experiment, ExperimentStatus, MetricScope } from "../../types";
import s from "./experiments.module.css";

const TRANSITION_VERB: Record<ExperimentStatus, string> = {
  planned: "Move back to planned",
  running: "Start running",
  completed: "Mark completed",
  failed: "Mark failed",
};

const when = (iso: string) => iso.replace("T", " ").slice(0, 16) + " UTC";

export function ExperimentDetail() {
  const { id = "" } = useParams();
  const { experiments, models } = useResearch();
  const experiment = experiments.find((e) => e.id === id);
  useTitle(experiment ? `${experiment.id} · ${experiment.name}` : "Experiment not found");

  if (!experiment) {
    return (
      <div className={s.page}>
        <EmptyState title={`No experiment ${id}`} action={<LinkButton to="/lab/experiments">Back to the registry</LinkButton>}>
          It may have been deleted, or the registry was reset.
        </EmptyState>
      </div>
    );
  }
  const model = models.find((m) => m.id === experiment.modelId);
  return <Detail experiment={experiment} modelLabel={model ? `${model.name} · ${model.version}` : `${experiment.modelId} (deleted)`} modelExists={!!model} />;
}

function Detail({ experiment: e, modelLabel, modelExists }: { experiment: Experiment; modelLabel: string; modelExists: boolean }) {
  const store = useResearchStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [metricOpen, setMetricOpen] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);

  const changeStatus = (next: ExperimentStatus) => {
    const result = store.setExperimentStatus(e.id, next);
    if (result.ok) toast(`${e.id} is now ${statusLabel(next).toLowerCase()}.`);
    else toast(result.errors.status ?? "Status could not change.", "error");
  };

  const spell = readMetric(e.metrics, "spellF1");
  const macro = readMetric(e.metrics, "macroF1");
  const params = Object.entries(e.params);

  return (
    <div className={s.page}>
      <PageHeader
        crumbs={[{ to: "/lab/experiments", label: "Experiments" }]}
        eyebrow={
          <span style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 8 }}>
            <SectionLabel>{e.id}</SectionLabel>
            <ExperimentStatusBadge status={e.status} />
          </span>
        }
        title={e.name}
        actions={
          <LinkButton to={`/lab/experiments/${e.id}/edit`} icon={<Pencil size={15} aria-hidden="true" />}>
            Edit
          </LinkButton>
        }
      />

      <div className={s.detail}>
        <div className={s.main}>
          <blockquote className={s.hypothesis}>{e.hypothesis}</blockquote>

          <Panel
            title="Results"
            labelledBy="results-title"
            aside={
              <Button size="sm" icon={<Plus size={15} aria-hidden="true" />} onClick={() => setMetricOpen(true)}>
                Record metric
              </Button>
            }
          >
            <div className={s.metricFormRow} style={{ marginBottom: 20 }}>
              <div>
                <SectionLabel>spellF1 · ranked</SectionLabel>
                <div style={{ marginTop: 8 }}>
                  <MetricCell reading={spell} large />
                </div>
              </div>
              <div>
                <SectionLabel>macroF1 · tie-break</SectionLabel>
                <div style={{ marginTop: 8 }}>
                  <MetricCell reading={macro} large />
                </div>
              </div>
            </div>
            {e.metrics.length === 0 ? (
              <EmptyState title="No metrics recorded">
                Record a value once you have one, and say where it came from. Hand-entered values are labelled manual or synthetic. Verified is reserved for imported scorer output, which isn't connected yet.
              </EmptyState>
            ) : (
              <div className={t.wrap}>
                <table className={`${t.table} ${s.metricsTable}`}>
                  <caption className="visually-hidden">All recorded metrics</caption>
                  <thead>
                    <tr>
                      <th scope="col">Metric</th>
                      <th scope="col" className={t.num}>Value</th>
                      <th scope="col">Provenance</th>
                      <th scope="col">Scope · source</th>
                      <th scope="col"><span className="visually-hidden">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...e.metrics].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map((m) => (
                      <tr key={m.id}>
                        <td className="mono">{m.key}</td>
                        <td className={t.num}>{m.value.toFixed(4)}</td>
                        <td><ProvenanceBadge provenance={m.provenance} /></td>
                        <td>
                          <span className="mono">{m.scope}</span>
                          <br />
                          <span style={{ color: "var(--text-quiet)" }}>{m.source}</span>
                        </td>
                        <td>
                          <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} label={`Remove ${m.key} = ${m.value}`} onClick={() => setPendingRemoval(m.id)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Configuration" labelledBy="config-title">
            <dl className={s.kv}>
              <dt>Model</dt>
              <dd>{modelExists ? <Link to={`/lab/models?model=${e.modelId}`}>{modelLabel}</Link> : modelLabel}</dd>
              <dt>Category</dt>
              <dd className="mono">{e.category}</dd>
              <dt>Revision</dt>
              <dd className="mono">{e.revision || <span className={s.muted}>not recorded</span>}</dd>
            </dl>
            {params.length > 0 ? (
              <div className={t.wrap} style={{ marginTop: 16 }}>
                <table className={`${t.table} ${s.paramTable}`}>
                  <caption className="visually-hidden">Parameters</caption>
                  <thead>
                    <tr>
                      <th scope="col">Parameter</th>
                      <th scope="col">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {params.map(([key, value]) => (
                      <tr key={key}>
                        <td>{key}</td>
                        <td className="mono">{String(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={s.muted} style={{ marginTop: 16 }}>No parameters recorded.</p>
            )}
          </Panel>

          <Panel title="Notes" labelledBy="notes-title">
            <div className={s.prose}>
              {(
                [
                  ["Expected outcome", e.expectedOutcome],
                  ["Known risks", e.risks],
                  ["Observations", e.observations],
                  ["Limitations", e.limitations],
                ] as const
              ).map(([label, text]) => (
                <div key={label}>
                  <h3>{label}</h3>
                  <p className={text ? undefined : s.muted}>{text || "Not written yet."}</p>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <aside className={s.side} aria-label="Status and record">
          <Panel title="Status" labelledBy="status-title">
            <div className={s.statusControls}>
              <ExperimentStatusBadge status={e.status} />
              <div className={s.statusButtons}>
                {TRANSITIONS[e.status].map((next) => (
                  <Button key={next} size="sm" variant={next === "completed" ? "primary" : next === "failed" ? "danger" : "default"} onClick={() => changeStatus(next)}>
                    {TRANSITION_VERB[next]}
                  </Button>
                ))}
              </div>
              {e.status === "completed" && e.metrics.length === 0 && (
                <Notice>Completed with no metric recorded. Record what was measured, or note why nothing was.</Notice>
              )}
            </div>
            <SectionLabel>History</SectionLabel>
            <ol className={s.history} style={{ marginTop: 8 }}>
              {[...e.statusHistory].reverse().map((h, i) => (
                <li key={`${h.at}-${i}`}>
                  <span>{statusLabel(h.status)}</span>
                  <time className="mono" dateTime={h.at}>{when(h.at)}</time>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Record" labelledBy="record-title">
            <dl className={s.kv}>
              <dt>Created</dt>
              <dd className="mono">{when(e.createdAt)}</dd>
              <dt>Updated</dt>
              <dd className="mono">{when(e.updatedAt)}</dd>
              <dt>Origin</dt>
              <dd>{e.origin === "seed" ? "Seed record" : "Created in this browser"}</dd>
            </dl>
          </Panel>

          <Panel title="Delete" labelledBy="delete-title">
            <div className={s.dangerZone}>
              <p>Deleting removes the experiment and its metrics from this browser. It can't be undone, except by resetting the registry.</p>
              <Button variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setConfirmDelete(true)}>
                Delete {e.id}
              </Button>
            </div>
          </Panel>
        </aside>
      </div>

      <MetricDialog open={metricOpen} onClose={() => setMetricOpen(false)} experimentId={e.id} />

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${e.id}?`}
        confirmLabel="Delete experiment"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          store.deleteExperiment(e.id);
          toast(`${e.id} deleted.`, "info");
          navigate("/lab/experiments");
        }}
      >
        <p>
          “{e.name}” and its {e.metrics.length} recorded metric{e.metrics.length === 1 ? "" : "s"} will be permanently removed from this browser.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Remove this metric?"
        confirmLabel="Remove metric"
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) store.removeExperimentMetric(e.id, pendingRemoval);
          setPendingRemoval(null);
          toast("Metric removed.", "info");
        }}
      >
        <p>The recorded value will be deleted from this experiment.</p>
      </ConfirmDialog>
    </div>
  );
}

const SCOPES: { value: MetricScope; label: string }[] = [
  { value: "synthetic", label: "Synthetic data" },
  { value: "public-window", label: "Public 5-minute window" },
  { value: "full-match", label: "Full match" },
];

function MetricDialog({ open, onClose, experimentId }: { open: boolean; onClose: () => void; experimentId: string }) {
  const store = useResearchStore();
  const toast = useToast();
  const [draft, setDraft] = useState<MetricDraft>(emptyMetricDraft);
  const [errors, setErrors] = useState<FieldErrors>({});

  const close = () => {
    setDraft(emptyMetricDraft());
    setErrors({});
    onClose();
  };
  const set = <K extends keyof MetricDraft>(key: K, value: MetricDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = store.addExperimentMetric(experimentId, draft);
    if (!result.ok) return setErrors(result.errors);
    toast(`${draft.key} recorded as ${draft.provenance}.`);
    close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Record a metric"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="metric-form">
            Record metric
          </Button>
        </>
      }
    >
      <form id="metric-form" className={s.metricForm} onSubmit={submit} noValidate>
        <div className={s.metricFormRow}>
          <Field label="Metric" required error={errors.key} hint="spellF1, macroF1, or a diagnostic name">
            {(p) => <Input {...p} mono list="metric-keys" value={draft.key} onChange={(ev) => set("key", ev.target.value)} />}
          </Field>
          <datalist id="metric-keys">
            <option value="spellF1" />
            <option value="macroF1" />
            <option value="n_pred_spells" />
            <option value="alive_dead_f1" />
          </datalist>
          <Field label="Value" required error={errors.value}>
            {(p) => <Input {...p} mono inputMode="decimal" value={draft.value} onChange={(ev) => set("value", ev.target.value)} placeholder="0.2433" />}
          </Field>
        </div>
        <div className={s.metricFormRow}>
          <Field label="Provenance" required error={errors.provenance} hint="Verified is reserved for imported scorer output">
            {(p) => (
              <Select {...p} value={draft.provenance} onChange={(ev) => set("provenance", ev.target.value as MetricDraft["provenance"])}>
                <option value="manual">Manual: typed in by hand</option>
                <option value="synthetic">Synthetic: from synthetic data</option>
                <option value="verified" disabled>
                  Verified: needs scorer integration
                </option>
              </Select>
            )}
          </Field>
          <Field label="Scope" required error={errors.scope}>
            {(p) => (
              <Select {...p} value={draft.scope} onChange={(ev) => set("scope", ev.target.value as MetricScope)}>
                {SCOPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Source" required error={errors.source} hint="The command, file or run this number came from">
          {(p) => <Textarea {...p} value={draft.source} onChange={(ev) => set("source", ev.target.value)} placeholder="python evaluation/run_evaluation.py, results/mine.csv" />}
        </Field>
        {draft.scope === "public-window" && (
          <Notice tone="info">The public 5 minutes check the pipeline. With 17 possessions they can't rank versions, and they mustn't be used for tuning.</Notice>
        )}
      </form>
    </Dialog>
  );
}
