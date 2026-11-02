import { ArrowRight, BookOpen, Activity, ListChecks, FlaskConical } from "lucide-react";
import { Link } from "react-router";
import { BaselineSweep } from "../components/charts/BaselineSweep";
import { EmptyState, Panel, ProvenanceBadge, SectionLabel, Stat, StatusPill, score } from "../components/ui";
import { ExperimentStatusBadge, Notice } from "../components/ui/controls";
import { useLoad } from "../lib/useData";
import { useResearch, useResearchStore } from "../lib/store/useResearch";
import { useTitle } from "../lib/useTitle";
import type { DataSource } from "../data/adapter";
import s from "./Overview.module.css";

const loadOverview = async (source: DataSource) => {
  const [project, milestones, sweep] = await Promise.all([source.project(), source.milestones(), source.baselineSweep()]);
  return { project, milestones, sweep };
};

/** Whole days from today to an ISO date, computed in local time. */
function daysUntil(iso: string) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

const SHORTCUTS = [
  { to: "/lab/experiments", label: "Experiments", hint: "Registry of runs", icon: ListChecks },
  { to: "/lab/models", label: "Model Lab", hint: "Compare candidate models", icon: FlaskConical },
  { to: "/match", label: "Match Centre", hint: "Public demo", icon: Activity },
  { to: "/methodology", label: "Methodology", hint: "How it works", icon: BookOpen },
];

export function Overview() {
  useTitle("Overview");
  const data = useLoad("overview", loadOverview);
  const research = useResearch();
  const storeStatus = useResearchStore().getStatus();

  if (data.state === "loading") return <p className={s.loading}>Loading workspace…</p>;
  if (data.state === "error") {
    return (
      <EmptyState title="The workspace could not load">
        <span className="mono">{data.error}</span>
      </EmptyState>
    );
  }

  const { project, milestones, sweep } = data.data;
  const { models, experiments } = research;
  const log = [...research.log].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 4);
  const current = models.find((m) => m.id === project.currentModelId) ?? models[0];
  const floor = sweep.find((row) => row.window === 50)!;
  const allMetrics = experiments.flatMap((e) => e.metrics.map((m) => ({ ...m, experiment: e })));
  const verified = allMetrics.filter((m) => m.provenance === "verified");
  const completed = experiments.filter((e) => e.status === "completed").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const lastCompleted = completed[0];
  const days = daysUntil(project.deadline);
  const recent = [...experiments].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);

  return (
    <div className={s.page}>
      <header className={s.hero}>
        <div className={s.heroText}>
          <SectionLabel rule>{project.phase}</SectionLabel>
          <h1 className={`display ${s.title}`}>
            Research <em>command</em> centre
          </h1>
          <p className={s.lede}>
            Label every frame of the match with H, A or dead ball, and recover the real possessions
            whole. This page tracks the work and keeps every number with its source.
          </p>
        </div>
        <aside className={s.countdown} aria-label="Submission deadline">
          <span className={s.countdownValue}>{Math.max(days, 0)}</span>
          <span className={s.countdownUnit}>{days === 1 ? "day" : "days"} to submission</span>
          <span className="mono">{project.deadline} · Google Form</span>
        </aside>
      </header>

      {storeStatus.issues.length > 0 && <Notice>{storeStatus.issues.join(" ")}</Notice>}
      {storeStatus.saveError && <Notice>Changes could not be saved in this browser: {storeStatus.saveError}</Notice>}

      <section className={s.stats} aria-label="Status">
        <Stat
          label="Current model"
          value={current ? current.name : "None"}
          note={current ? `${current.version} · ${current.source || "no source yet"}` : "No model records. Reset the registry to restore them."}
          foot={<span className={s.chip}>Not yet scored on the match</span>}
          className={s.statWide}
        />
        <Stat
          label="Baseline floor · spellF1"
          value={score(floor.result.metrics.spellF1)}
          note="nearest player, ±50 frame vote · full match"
          foot={<ProvenanceBadge provenance="published" />}
        />
        <Stat
          label="Experiments"
          value={experiments.length}
          note={`${completed.length} completed · ${experiments.filter((e) => e.status === "running").length} running · ${experiments.filter((e) => e.status === "planned").length} planned`}
          foot={<Link to="/lab/experiments" className={s.statLink}>Open the registry</Link>}
        />
        <Stat
          label="Last completed"
          value={lastCompleted ? lastCompleted.id : "—"}
          note={lastCompleted ? lastCompleted.name : "Nothing completed yet"}
          foot={lastCompleted && <ExperimentStatusBadge status="completed" />}
        />
      </section>

      <div className={s.gridMain}>
        <Panel
          title="Same algorithm, four windows"
          labelledBy="sweep-title"
          aside={<ProvenanceBadge provenance="published" />}
          className={s.sweepPanel}
        >
          <p className={s.panelLede}>
            The four shipped baselines differ only in the width of the smoothing window. macroF1
            barely moves across them, while spellF1 changes about fivefold. That gap is why the
            board ranks on whole possessions.
          </p>
          <BaselineSweep rows={sweep} highlight={50} />
          <p className={s.source}>Source: EVALUATION.md, full-match scores. These are quoted, not re-run here.</p>
        </Panel>

        <Panel title="Verified results" labelledBy="verified-title">
          {verified.length ? (
            <ul className={s.list}>
              {verified.map((m) => (
                <li key={m.id}>
                  <span className="mono">{m.key} {score(m.value)}</span> · <span className="mono">{m.scope}</span> ·{" "}
                  <Link to={`/lab/experiments/${m.experiment.id}`}>{m.experiment.id}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No verified run yet">
              <p>
                A result shows up here only after <span className="mono">evaluation/run_evaluation.py</span>{" "}
                has scored a submission and its report has been imported on{" "}
                <Link to="/lab/runs">Runs &amp; imports</Link>. The match data stays on this
                machine, and the browser never reads it.
              </p>
            </EmptyState>
          )}
          <div className={s.provKey}>
            <SectionLabel>Reading the badges</SectionLabel>
            <ul>
              <li><ProvenanceBadge provenance="verified" /> official scorer, run recorded</li>
              <li><ProvenanceBadge provenance="published" /> quoted from competition docs</li>
              <li><ProvenanceBadge provenance="synthetic" /> unit-test data, not the match</li>
              <li><ProvenanceBadge provenance="manual" /> typed by hand, unverified</li>
              <li><ProvenanceBadge provenance="demo" /> illustrative only</li>
            </ul>
          </div>
        </Panel>
      </div>

      <Panel title="Recently updated experiments" labelledBy="recent-exp-title" aside={<Link to="/lab/experiments/new" className={s.statLink}>New experiment</Link>}>
        {recent.length ? (
          <ul className={s.recent}>
            {recent.map((e) => (
              <li key={e.id}>
                <Link to={`/lab/experiments/${e.id}`}>
                  <span className="mono">{e.id}</span>
                  <span>{e.name}</span>
                </Link>
                <ExperimentStatusBadge status={e.status} />
                <time className="mono" dateTime={e.updatedAt}>{e.updatedAt.slice(0, 10)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No experiments recorded">Create one from the Experiments page. Start with the hypothesis.</EmptyState>
        )}
      </Panel>

      <div className={s.gridLower}>
        <Panel title="Milestones" labelledBy="milestones-title">
          <ol className={s.milestones}>
            {milestones.map((m) => (
              <li key={m.id} data-status={m.status}>
                <div className={s.milestoneHead}>
                  <span className={s.milestoneTitle}>{m.title}</span>
                  <StatusPill status={m.status} />
                </div>
                <p>{m.detail}</p>
                {m.due && <span className="mono">due {m.due}</span>}
              </li>
            ))}
          </ol>
        </Panel>

        <Panel
          title="Recent activity"
          labelledBy="activity-title"
          aside={<Link to="/lab/log" className={s.statLink}>Full log</Link>}
        >
          <ul className={s.activity}>
            {log.map((entry) => (
              <li key={entry.id}>
                <span className={s.kind} data-kind={entry.kind}>{entry.kind}</span>
                <div>
                  <span className={s.activityTitle}>{entry.title}</span>
                  <p>{entry.body}</p>
                </div>
                <time className="mono" dateTime={entry.date}>{entry.date.slice(5)}</time>
              </li>
            ))}
          </ul>
          <p className={s.source}>
            Entries are recorded by hand. Nothing here is collected automatically from git or
            Claude Code.
          </p>
        </Panel>

        <nav className={s.shortcuts} aria-label="Shortcuts">
          <SectionLabel rule>Go to</SectionLabel>
          {SHORTCUTS.map(({ to, label, hint, icon: Icon }) => (
            <Link key={to} to={to} className={s.shortcut}>
              <Icon size={18} strokeWidth={1.6} aria-hidden="true" />
              <span>
                <span className={s.shortcutLabel}>{label}</span>
                <span className={s.shortcutHint}>{hint}</span>
              </span>
              <ArrowRight size={16} aria-hidden="true" className={s.shortcutArrow} />
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
