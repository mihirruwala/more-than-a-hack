import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { EmptyState, SectionLabel } from "../../components/ui";
import { ParamEditor } from "../../components/forms/ParamEditor";
import { UnsavedDialog } from "../../components/forms/UnsavedDialog";
import { Button, Checkbox, Field, Input, LinkButton, PageHeader, Select, Textarea } from "../../components/ui/controls";
import { useToast } from "../../components/ui/Toast";
import type { FieldErrors } from "../../lib/research/experiments";
import { draftFromModel, emptyModelDraft, type ModelDraft } from "../../lib/research/models";
import type { Result } from "../../lib/store/researchStore";
import { useResearch, useResearchStore } from "../../lib/store/useResearch";
import { useTitle } from "../../lib/useTitle";
import { useUnsavedGuard } from "../../lib/useUnsavedGuard";
import { ALGORITHM_CATEGORIES, FEATURE_CATEGORIES, MODEL_STATUSES, type ModelVersion } from "../../types";
import { FEATURE_TEXT, MODEL_STATUS_TEXT } from "./modelText";
import f from "../../components/forms/forms.module.css";
import s from "./models.module.css";

export function NewModel() {
  useTitle("New model version");
  const store = useResearchStore();
  return (
    <div className={s.page}>
      <PageHeader
        crumbs={[{ to: "/lab/models", label: "Model Lab" }]}
        eyebrow={<SectionLabel rule>New record</SectionLabel>}
        title="New model version"
        lede="Describe the approach and its configuration. Metrics come from experiments, so a new model starts with none."
      />
      <ModelForm initial={emptyModelDraft()} isNew onSubmit={(d) => store.createModel(d)} cancelTo="/lab/models" />
    </div>
  );
}

export function EditModel() {
  const { id = "" } = useParams();
  const store = useResearchStore();
  const { models } = useResearch();
  const model = models.find((m) => m.id === id);
  useTitle(model ? `Edit ${model.name}` : "Model not found");
  if (!model) {
    return (
      <div className={s.page}>
        <EmptyState title="Model not found" action={<LinkButton to="/lab/models">Back to Model Lab</LinkButton>}>
          It may have been deleted, or the registry was reset.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className={s.page}>
      <PageHeader crumbs={[{ to: "/lab/models", label: "Model Lab" }]} eyebrow={<SectionLabel rule>Editing</SectionLabel>} title={`${model.name} ${model.version}`} />
      <ModelForm key={model.id} initial={draftFromModel(model)} isNew={false} onSubmit={(d) => store.updateModel(model.id, d)} cancelTo={`/lab/models?model=${model.id}`} />
    </div>
  );
}

function ModelForm({ initial, isNew, onSubmit, cancelTo }: { initial: ModelDraft; isNew: boolean; onSubmit: (d: ModelDraft) => Result<ModelVersion>; cancelTo: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const dirty = savedTo === null && JSON.stringify(draft) !== JSON.stringify(initial);
  const blocker = useUnsavedGuard(dirty);

  useEffect(() => {
    if (savedTo) navigate(savedTo);
  }, [savedTo, navigate]);
  useEffect(() => {
    if (Object.keys(errors).length) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const set = <K extends keyof ModelDraft>(key: K, value: ModelDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([field]) => field !== key && !(key === "params" && field.startsWith("params.")))),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = onSubmit(draft);
    if (!result.ok) return setErrors(result.errors);
    toast(isNew ? `${result.value.name} ${result.value.version} added.` : `${result.value.name} ${result.value.version} saved.`);
    setSavedTo(`/lab/models?model=${result.value.id}`);
  };

  const errorCount = Object.keys(errors).length;

  return (
    <form ref={formRef} className={f.form} onSubmit={submit} noValidate>
      {errorCount > 0 && (
        <div className={f.summaryError} role="alert">
          <strong>{errorCount} {errorCount === 1 ? "field needs" : "fields need"} attention.</strong>
        </div>
      )}
      <section className={f.section}>
        <div className={f.sectionIntro}>
          <h2>Identity</h2>
          <p>A name and version pair must be unique. Bump the version instead of overwriting a measured model.</p>
        </div>
        <div className={f.fields}>
          <div className={f.two}>
            <Field label="Name" required error={errors.name}>
              {(p) => <Input {...p} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Segment cleanup" />}
            </Field>
            <Field label="Version" required error={errors.version}>
              {(p) => <Input {...p} mono value={draft.version} onChange={(e) => set("version", e.target.value)} placeholder="v0.2" />}
            </Field>
          </div>
          <div className={f.two}>
            <Field label="Algorithm category" required error={errors.category}>
              {(p) => (
                <Select {...p} value={draft.category} onChange={(e) => set("category", e.target.value as ModelDraft["category"])}>
                  <option value="">Choose…</option>
                  {ALGORITHM_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Status" required error={errors.status} hint={MODEL_STATUS_TEXT[draft.status].description}>
              {(p) => (
                <Select {...p} value={draft.status} onChange={(e) => set("status", e.target.value as ModelDraft["status"])}>
                  {MODEL_STATUSES.map((st) => (
                    <option key={st} value={st}>{MODEL_STATUS_TEXT[st].label}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Kind">
            {(p) => (
              <Select {...p} value={draft.kind} onChange={(e) => set("kind", e.target.value as ModelDraft["kind"])}>
                <option value="candidate">Candidate</option>
                <option value="baseline">Baseline</option>
              </Select>
            )}
          </Field>
        </div>
      </section>

      <section className={f.section}>
        <div className={f.sectionIntro}>
          <h2>Algorithm</h2>
          <p>What it does, what it should achieve, and where the code lives.</p>
        </div>
        <div className={f.fields}>
          <Field label="Description" required error={errors.summary}>
            {(p) => <Textarea {...p} value={draft.summary} onChange={(e) => set("summary", e.target.value)} />}
          </Field>
          <Field label="Intended behaviour">
            {(p) => <Textarea {...p} value={draft.intendedBehaviour} onChange={(e) => set("intendedBehaviour", e.target.value)} />}
          </Field>
          <div className={f.two}>
            <Field label="Source file" hint="Path in the repository, if it exists">
              {(p) => <Input {...p} mono value={draft.source} onChange={(e) => set("source", e.target.value)} placeholder="starter/postprocess.py" />}
            </Field>
            <Field label="Runtime" hint="Only if actually measured, e.g. 38 s on M2">
              {(p) => <Input {...p} mono value={draft.runtime} onChange={(e) => set("runtime", e.target.value)} />}
            </Field>
          </div>
          <fieldset className={f.featureGrid}>
            <legend>Evidence used</legend>
            {FEATURE_CATEGORIES.map((feat) => (
              <Checkbox
                key={feat}
                label={FEATURE_TEXT[feat]}
                checked={draft.features.includes(feat)}
                onChange={(e) => set("features", e.target.checked ? [...draft.features, feat] : draft.features.filter((x) => x !== feat))}
              />
            ))}
          </fieldset>
          <ParamEditor rows={draft.params} onChange={(rows) => set("params", rows)} errors={errors} />
        </div>
      </section>

      <section className={f.section}>
        <div className={f.sectionIntro}>
          <h2>Honesty</h2>
          <p>What it can't do, and anything a reader should know before trusting it.</p>
        </div>
        <div className={f.fields}>
          <Field label="Known limitations">
            {(p) => <Textarea {...p} value={draft.limitations} onChange={(e) => set("limitations", e.target.value)} />}
          </Field>
          <Field label="Notes">
            {(p) => <Textarea {...p} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />}
          </Field>
        </div>
      </section>

      <div className={f.actions}>
        {dirty && <span className={f.dirty}>Unsaved changes</span>}
        <div className={f.actionsRight}>
          <Button onClick={() => navigate(cancelTo)}>Cancel</Button>
          <Button type="submit" variant="primary">{isNew ? "Add model version" : "Save changes"}</Button>
        </div>
      </div>
      <UnsavedDialog blocker={blocker} />
    </form>
  );
}
