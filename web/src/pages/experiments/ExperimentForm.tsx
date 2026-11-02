import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { ParamEditor } from "../../components/forms/ParamEditor";
import { UnsavedDialog } from "../../components/forms/UnsavedDialog";
import { Button, Field, Input, Select, Textarea, statusLabel } from "../../components/ui/controls";
import { useToast } from "../../components/ui/Toast";
import { CREATABLE_STATUSES, type ExperimentDraft, type FieldErrors } from "../../lib/research/experiments";
import type { Result } from "../../lib/store/researchStore";
import { useResearch } from "../../lib/store/useResearch";
import { useUnsavedGuard } from "../../lib/useUnsavedGuard";
import { EXPERIMENT_CATEGORIES, type Experiment } from "../../types";
import f from "../../components/forms/forms.module.css";

export function ExperimentForm({
  initial,
  isNew,
  onSubmit,
  cancelTo,
}: {
  initial: ExperimentDraft;
  isNew: boolean;
  onSubmit: (draft: ExperimentDraft) => Result<Experiment>;
  cancelTo: string;
}) {
  const { models } = useResearch();
  const navigate = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const dirty = savedTo === null && JSON.stringify(draft) !== JSON.stringify(initial);
  const blocker = useUnsavedGuard(dirty);

  // Navigate only after the save has cleared the dirty flag, so the guard doesn't block it.
  useEffect(() => {
    if (savedTo) navigate(savedTo);
  }, [savedTo, navigate]);

  // After a failed submit, move focus to the first invalid control.
  useEffect(() => {
    if (!Object.keys(errors).length) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const set = <K extends keyof ExperimentDraft>(key: K, value: ExperimentDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([field]) => field !== key && !(key === "params" && field.startsWith("params.")))),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = onSubmit(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toast(isNew ? `${result.value.id} created as ${statusLabel(result.value.status).toLowerCase()}.` : `${result.value.id} saved.`);
    setSavedTo(`/lab/experiments/${result.value.id}`);
  };

  const errorCount = Object.keys(errors).length;

  return (
    <form ref={formRef} className={f.form} onSubmit={submit} noValidate>
      {errorCount > 0 && (
        <div className={f.summaryError} role="alert">
          <strong>
            {errorCount} {errorCount === 1 ? "field needs" : "fields need"} attention.
          </strong>
          {errors.form && <p>{errors.form}</p>}
        </div>
      )}

      <section className={f.section}>
        <div className={f.sectionIntro}>
          <h2>The question</h2>
          <p>What you are testing, and why you expect it to work.</p>
        </div>
        <div className={f.fields}>
          <Field label="Experiment name" required error={errors.name}>
            {(p) => <Input {...p} value={draft.name} maxLength={140} onChange={(e) => set("name", e.target.value)} placeholder="Shorter gap bridge on baseline_smooth50" />}
          </Field>
          <Field label="Hypothesis" required error={errors.hypothesis} hint="A falsifiable statement: if X, then Y, because Z.">
            {(p) => <Textarea {...p} value={draft.hypothesis} onChange={(e) => set("hypothesis", e.target.value)} />}
          </Field>
          <div className={f.two}>
            <Field label="Expected outcome" hint="What result would support the hypothesis?">
              {(p) => <Textarea {...p} value={draft.expectedOutcome} onChange={(e) => set("expectedOutcome", e.target.value)} />}
            </Field>
            <Field label="Known risks" hint="What could make the result misleading?">
              {(p) => <Textarea {...p} value={draft.risks} onChange={(e) => set("risks", e.target.value)} />}
            </Field>
          </div>
        </div>
      </section>

      <section className={f.section}>
        <div className={f.sectionIntro}>
          <h2>Setup</h2>
          <p>The model version, the code revision and the exact parameters, so the run can be repeated.</p>
        </div>
        <div className={f.fields}>
          <div className={f.two}>
            <Field label="Model version" required error={errors.modelId}>
              {(p) => (
                <Select {...p} value={draft.modelId} onChange={(e) => set("modelId", e.target.value)}>
                  <option value="">Choose a model…</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.version}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Category" required error={errors.category}>
              {(p) => (
                <Select {...p} value={draft.category} onChange={(e) => set("category", e.target.value as ExperimentDraft["category"])}>
                  <option value="">Choose a category…</option>
                  {EXPERIMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className={f.two}>
            <Field label="Code revision" hint="A commit, tag or file note. Free text.">
              {(p) => <Input {...p} mono value={draft.revision} onChange={(e) => set("revision", e.target.value)} placeholder="starter/postprocess.py @ 2026-10-26" />}
            </Field>
            {isNew ? (
              <Field label="Starting status" error={errors.status} hint="Completed and failed are reached by doing the work.">
                {(p) => (
                  <Select {...p} value={draft.status} onChange={(e) => set("status", e.target.value as ExperimentDraft["status"])}>
                    {CREATABLE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <Field label="Status" hint="Change the status from the experiment page, where the change is recorded.">
                {(p) => <Input {...p} value={statusLabel(draft.status)} readOnly disabled />}
              </Field>
            )}
          </div>
          <ParamEditor rows={draft.params} onChange={(rows) => set("params", rows)} errors={errors} />
        </div>
      </section>

      <section className={f.section}>
        <div className={f.sectionIntro}>
          <h2>Findings</h2>
          <p>Fill these in as you learn. Metrics are recorded separately, each with its provenance.</p>
        </div>
        <div className={f.fields}>
          <Field label="Observations">
            {(p) => <Textarea {...p} value={draft.observations} onChange={(e) => set("observations", e.target.value)} />}
          </Field>
          <Field label="Limitations">
            {(p) => <Textarea {...p} value={draft.limitations} onChange={(e) => set("limitations", e.target.value)} />}
          </Field>
        </div>
      </section>

      <div className={f.actions}>
        {dirty && <span className={f.dirty}>Unsaved changes</span>}
        <div className={f.actionsRight}>
          <Button onClick={() => navigate(cancelTo)}>Cancel</Button>
          <Button type="submit" variant="primary">
            {isNew ? "Create experiment" : "Save changes"}
          </Button>
        </div>
      </div>
      <UnsavedDialog blocker={blocker} />
    </form>
  );
}
