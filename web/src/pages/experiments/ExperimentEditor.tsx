import { useParams, useSearchParams } from "react-router";
import { EmptyState, SectionLabel } from "../../components/ui";
import { LinkButton, PageHeader } from "../../components/ui/controls";
import { draftFromExperiment, emptyExperimentDraft } from "../../lib/research/experiments";
import { useResearch, useResearchStore } from "../../lib/store/useResearch";
import { useTitle } from "../../lib/useTitle";
import { ExperimentForm } from "./ExperimentForm";
import s from "./experiments.module.css";

export function NewExperiment() {
  useTitle("New experiment");
  const store = useResearchStore();
  const [params] = useSearchParams();
  const { models } = useResearch();
  const preset = params.get("model");
  const initial = emptyExperimentDraft(preset && models.some((m) => m.id === preset) ? preset : "");

  return (
    <div className={s.page}>
      <PageHeader
        crumbs={[{ to: "/lab/experiments", label: "Experiments" }]}
        eyebrow={<SectionLabel rule>New record</SectionLabel>}
        title="New experiment"
        lede="Write the hypothesis before you run anything. A new record starts as planned or running. Results are added later, each with its provenance."
      />
      <ExperimentForm initial={initial} isNew onSubmit={(draft) => store.createExperiment(draft)} cancelTo="/lab/experiments" />
    </div>
  );
}

export function EditExperiment() {
  const { id = "" } = useParams();
  const store = useResearchStore();
  const { experiments } = useResearch();
  const experiment = experiments.find((e) => e.id === id);
  useTitle(experiment ? `Edit ${experiment.id}` : "Experiment not found");

  if (!experiment) {
    return (
      <div className={s.page}>
        <EmptyState title={`No experiment ${id}`} action={<LinkButton to="/lab/experiments">Back to the registry</LinkButton>}>
          It may have been deleted, or the registry was reset.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <PageHeader
        crumbs={[
          { to: "/lab/experiments", label: "Experiments" },
          { to: `/lab/experiments/${experiment.id}`, label: experiment.id },
        ]}
        eyebrow={<SectionLabel rule>Editing</SectionLabel>}
        title={experiment.name}
      />
      {/* Keyed by id, not updatedAt: a save must not remount the form before it navigates away. */}
      <ExperimentForm
        key={experiment.id}
        initial={draftFromExperiment(experiment)}
        isNew={false}
        onSubmit={(draft) => store.updateExperiment(experiment.id, draft)}
        cancelTo={`/lab/experiments/${experiment.id}`}
      />
    </div>
  );
}
