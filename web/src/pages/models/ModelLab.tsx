import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState, SectionLabel } from "../../components/ui";
import { Button, LinkButton, PageHeader, TabPanel, Tabs, type TabDef } from "../../components/ui/controls";
import { ConfirmDialog } from "../../components/ui/Dialog";
import { useToast } from "../../components/ui/Toast";
import { useResearch, useResearchStore } from "../../lib/store/useResearch";
import { useTitle } from "../../lib/useTitle";
import { ModelDetail } from "./ModelDetail";
import { ModelCompare } from "./ModelCompare";
import { Dimensions } from "./Dimensions";
import { MODEL_STATUS_TEXT } from "./modelText";
import s from "./models.module.css";

type Tab = "models" | "compare" | "dimensions";

export function ModelLab() {
  useTitle("Model Lab");
  const { models, experiments } = useResearch();
  const store = useResearchStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const tab = (["models", "compare", "dimensions"].includes(params.get("tab") ?? "") ? params.get("tab") : "models") as Tab;
  const selectedId = models.some((m) => m.id === params.get("model")) ? params.get("model")! : models[0]?.id;
  const selected = models.find((m) => m.id === selectedId);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) value === null ? next.delete(key) : next.set(key, value);
    setParams(next, { replace: true });
  };

  const tabs: TabDef<Tab>[] = [
    { id: "models", label: "Model records", count: models.length },
    { id: "compare", label: "Compare" },
    { id: "dimensions", label: "Research dimensions" },
  ];

  const pending = models.find((m) => m.id === pendingDelete);
  const pendingUsers = pending ? experiments.filter((e) => e.modelId === pending.id) : [];

  return (
    <div className={s.page}>
      <PageHeader
        eyebrow={<SectionLabel rule>Lab · models</SectionLabel>}
        title={
          <>
            Model <em>Lab</em>
          </>
        }
        lede="The baseline and every candidate approach: what each does, how it's configured, and what has actually been measured. A candidate listed here hasn't beaten anything until a verified run says so."
        actions={
          <LinkButton to="/lab/models/new" variant="primary" icon={<Plus size={16} aria-hidden="true" />}>
            New model version
          </LinkButton>
        }
      />

      <Tabs tabs={tabs} value={tab} onChange={(id) => setParam({ tab: id === "models" ? null : id })} label="Model Lab views" idPrefix="modellab" />

      <TabPanel idPrefix="modellab" active={tab}>
        {tab === "models" &&
          (models.length === 0 ? (
            <EmptyState title="No model records" action={<LinkButton to="/lab/models/new" variant="primary">Add a model version</LinkButton>}>
              Reset the registry from the Experiments page to restore the baseline and candidates.
            </EmptyState>
          ) : (
            <div className={s.split}>
              <nav aria-label="Model versions" className={s.list}>
                <ul>
                  {models.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        className={s.listItem}
                        aria-current={m.id === selectedId ? "true" : undefined}
                        onClick={() => setParam({ model: m.id })}
                      >
                        <span className={s.listKind}>{m.kind}</span>
                        <span className={s.listName}>{m.name}</span>
                        <span className={`mono ${s.listVersion}`}>{m.version}</span>
                        <span className={s.listStatus} data-status={m.status}>
                          {MODEL_STATUS_TEXT[m.status].label}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
              {selected && (
                <div className={s.detailCol}>
                  <div className={s.detailActions}>
                    <LinkButton to={`/lab/experiments/new?model=${selected.id}`} size="sm" icon={<Plus size={15} aria-hidden="true" />}>
                      New experiment on this model
                    </LinkButton>
                    <LinkButton to={`/lab/models/${selected.id}/edit`} size="sm" icon={<Pencil size={15} aria-hidden="true" />}>
                      Edit
                    </LinkButton>
                    <Button size="sm" variant="danger" icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => setPendingDelete(selected.id)}>
                      Delete
                    </Button>
                  </div>
                  <ModelDetail model={selected} experiments={experiments.filter((e) => e.modelId === selected.id)} />
                </div>
              )}
            </div>
          ))}
        {tab === "compare" && <ModelCompare models={models} experiments={experiments} params={params} setParam={setParam} />}
        {tab === "dimensions" && <Dimensions />}
      </TabPanel>

      {pending && (
        <ConfirmDialog
          open
          title={pendingUsers.length ? `${pending.name} is still in use` : `Delete ${pending.name} ${pending.version}?`}
          confirmLabel={pendingUsers.length ? "Show its experiments" : "Delete model"}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            if (pendingUsers.length) {
              setPendingDelete(null);
              navigate(`/lab/experiments?model=${pending.id}`);
              return;
            }
            const result = store.deleteModel(pending.id);
            setPendingDelete(null);
            if (result.ok) {
              setParam({ model: null });
              toast(`${pending.name} ${pending.version} deleted.`, "info");
            } else toast(result.errors.form ?? "Could not delete.", "error");
          }}
        >
          {pendingUsers.length ? (
            <p>
              {pendingUsers.map((e) => e.id).join(", ")} still reference this model. Reassign or delete those experiments first, so no record loses
              its model.
            </p>
          ) : (
            <p>The model record and its attached metrics will be permanently removed from this browser.</p>
          )}
        </ConfirmDialog>
      )}

      <p className={s.footnote}>
        Model records are stored in this browser. See <Link to="/methodology">Methodology</Link> for how each stage fits the pipeline.
      </p>
    </div>
  );
}

