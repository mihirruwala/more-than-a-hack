import { useId, useState, type ChangeEvent } from "react";
import { Link } from "react-router";
import { FileCheck2, FileJson, ShieldCheck } from "lucide-react";
import { Panel, ProvenanceBadge, SectionLabel } from "../../components/ui";
import { Button, Field, Notice, PageHeader, Select, tableClasses as t } from "../../components/ui/controls";
import { useToast } from "../../components/ui/Toast";
import { BASIS_TEXT, COMMANDS, facts } from "../../data/fixtures/integration";
import { parseScorerReport, sha256Hex, type ScorerReport } from "../../lib/research/scorerReport";
import { useResearch, useResearchStore } from "../../lib/store/useResearch";
import { checkSubmission, type SubmissionCheck } from "../../lib/submission";
import { useTitle } from "../../lib/useTitle";
import s from "./runs.module.css";

/** Reads a picked file's text. The text stays in this component's memory and is never stored. */
async function readPicked(event: ChangeEvent<HTMLInputElement>): Promise<{ name: string; text: string } | null> {
  const file = event.target.files?.[0];
  event.target.value = ""; // allow picking the same file again
  if (!file) return null;
  return { name: file.name, text: await file.text() };
}

export function Runs() {
  useTitle("Runs & imports");
  return (
    <div className={s.page}>
      <PageHeader
        eyebrow={<SectionLabel rule>Lab · runs</SectionLabel>}
        title={
          <>
            Runs <em>&amp;</em> imports
          </>
        }
        lede="Where real outputs meet the lab. Everything runs on this machine. The match data stays in data/ and is never read by this app, and a picked file is processed in this tab without being uploaded or stored."
      />

      <div className={s.grid}>
        <SubmissionCheckPanel />
        <ReportImportPanel />
      </div>

      <Panel title="The official workflow" labelledBy="workflow-title" aside={<span className={s.localTag}>run in your terminal</span>}>
        <ol className={s.commands}>
          {COMMANDS.map((c) => (
            <li key={c.command}>
              <code>{c.command}</code>
              <span>{c.what}</span>
            </li>
          ))}
        </ol>
        <p className={s.fine}>
          Full reasoning, with sources, is in <code>docs/integration-plan.md</code>. Read the inspector's output yourself: the competition terms
          forbid sharing the datasets, or extracts of them, with a hosted LLM.
        </p>
      </Panel>

      <Panel title="What is known about the match files" labelledBy="facts-title">
        <div className={t.wrap}>
          <table className={t.table}>
            <caption className="visually-hidden">Facts about the official files and how each is known</caption>
            <thead>
              <tr>
                <th scope="col">Topic</th>
                <th scope="col">Claim</th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              {facts.map((f) => (
                <tr key={f.topic}>
                  <th scope="row" className={s.topic}>{f.topic}</th>
                  <td className={s.claim}>
                    {f.claim}
                    {f.ref && <code className={s.ref}>{f.ref}</code>}
                  </td>
                  <td>
                    <span className={s.basis} data-basis={f.basis} title={BASIS_TEXT[f.basis].description}>
                      {BASIS_TEXT[f.basis].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function SubmissionCheckPanel() {
  const id = useId();
  const [state, setState] = useState<{ status: "idle" } | { status: "reading"; name: string } | { status: "done"; name: string; result: SubmissionCheck }>({ status: "idle" });

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const name = event.target.files?.[0]?.name ?? "";
    setState({ status: "reading", name });
    const picked = await readPicked(event);
    if (!picked) return setState({ status: "idle" });
    // Yield a frame so the "Checking…" state paints before the synchronous parse.
    await new Promise((resolve) => setTimeout(resolve, 0));
    setState({ status: "done", name: picked.name, result: checkSubmission(picked.text) });
  };

  return (
    <Panel title="Check a submission file" labelledBy={`${id}-title`} aside={<FileCheck2 size={18} aria-hidden="true" className={s.icon} />}>
      <p className={s.lede}>
        A <code>frame,label</code> CSV: the same rules as <code>validate_submission.py</code>, checked in this tab. Nothing is stored.
      </p>
      <label className={s.picker}>
        <input type="file" accept=".csv,text/csv" onChange={onPick} aria-describedby={`${id}-hint`} />
        <span>Choose CSV…</span>
      </label>
      <p id={`${id}-hint`} className={s.fine}>
        The Python validator is authoritative. Run it on the exact file you upload.
      </p>

      <div aria-live="polite">
        {state.status === "reading" && <p className={s.fine}>Checking {state.name}…</p>}
        {state.status === "done" &&
          (state.result.ok ? (
            <div className={s.result} data-ok="true">
              <p className={s.verdict}>
                <ShieldCheck size={16} aria-hidden="true" /> {state.name} passes the format rules
              </p>
              <dl className={s.counts}>
                {(["H", "A", "D", "X"] as const).map((l) => (
                  <div key={l}>
                    <dt className="mono">{l}</dt>
                    <dd className="mono">
                      {state.result.ok && state.result.summary.counts[l].toLocaleString("en")}
                      <small>{state.result.ok && ((state.result.summary.counts[l] / state.result.summary.rows) * 100).toFixed(1)}%</small>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className={s.fine}>
                Reports {state.result.summary.possessions.toLocaleString("en")} possessions, mean {state.result.summary.meanPossessionSeconds.toFixed(1)} s.
                {state.result.summary.hasAbstentions && " X is counted as a gap here. The scorer fills it with the previous label, so its count can be lower."}
              </p>
              <Button size="sm" variant="ghost" onClick={() => setState({ status: "idle" })}>
                Clear
              </Button>
            </div>
          ) : (
            <div className={s.result} data-ok="false" role="alert">
              <p className={s.verdict}>{state.name} fails</p>
              <p className="mono">{state.result.reason}</p>
              <p className={s.fine}>The usual causes are an off-by-one at the start or end, a missing header, or blank cells. Write X to abstain.</p>
            </div>
          ))}
      </div>
    </Panel>
  );
}

function ReportImportPanel() {
  const id = useId();
  const { experiments } = useResearch();
  const store = useResearchStore();
  const toast = useToast();
  const [parsed, setParsed] = useState<{ name: string; report: ScorerReport; sha: string | null } | { name: string; errors: string[] } | null>(null);
  const [target, setTarget] = useState("");
  const [imported, setImported] = useState<string | null>(null);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = await readPicked(event);
    setImported(null);
    if (!picked) return setParsed(null);
    const result = parseScorerReport(picked.text);
    setParsed(result.ok ? { name: picked.name, report: result.report, sha: await sha256Hex(picked.text) } : { name: picked.name, errors: result.errors });
  };

  const doImport = () => {
    if (!parsed || !("report" in parsed) || !target) return;
    const result = store.importScorerReport(target, parsed.report, parsed.sha);
    if (!result.ok) return toast(result.errors.form ?? "Import failed.", "error");
    setImported(target);
    toast(`Scorer report attached to ${target} as verified ${parsed.report.scope} metrics.`);
  };

  return (
    <Panel title="Import a scorer report" labelledBy={`${id}-title`} aside={<FileJson size={18} aria-hidden="true" className={s.icon} />}>
      <p className={s.lede}>
        <code>evaluation/reports/&lt;name&gt;.json</code>, written by <code>run_evaluation.py</code>. Only aggregates are kept: spellF1, macroF1,
        predicted spells and alive/dead F1.
      </p>
      <label className={s.picker}>
        <input type="file" accept=".json,application/json" onChange={onPick} />
        <span>Choose report…</span>
      </label>

      {parsed && "errors" in parsed && (
        <div className={s.result} data-ok="false" role="alert">
          <p className={s.verdict}>{parsed.name} can't be imported</p>
          <ul className={s.errors}>
            {parsed.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {parsed && "report" in parsed && (
        <div className={s.result} data-ok="true">
          <dl className={s.kv}>
            <dt>Submission</dt>
            <dd className="mono">{parsed.report.submission}</dd>
            <dt>Ground truth</dt>
            <dd>
              <span className="mono">{parsed.report.groundTruth}</span> · {parsed.report.scopeLabel}
            </dd>
            <dt>spellF1</dt>
            <dd className="mono">{parsed.report.spellF1.toFixed(4)}</dd>
            <dt>macroF1</dt>
            <dd className="mono">{parsed.report.macroF1.toFixed(4)}</dd>
            <dt>Possessions</dt>
            <dd className="mono">
              {parsed.report.nPredSpells} predicted · {parsed.report.nGtSpells} in truth
            </dd>
            <dt>SHA-256</dt>
            <dd className="mono">{parsed.sha ? `${parsed.sha.slice(0, 16)}…` : "unavailable in this browser"}</dd>
          </dl>
          <p className={s.provRow}>
            Will be recorded as <ProvenanceBadge provenance="verified" /> with scope <span className="mono">{parsed.report.scope}</span>.
          </p>
          {parsed.report.scope === "public-window" && (
            <Notice tone="info">Public window: this checks the pipeline. It never ranks versions here, and isn't evidence of full-match performance.</Notice>
          )}
          <Notice>The browser checks the report's structure, not that the official scorer wrote it. Re-run run_evaluation.py to reproduce it.</Notice>
          <div className={s.importRow}>
            <Field label="Attach to experiment" required>
              {(p) => (
                <Select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Choose…</option>
                  {experiments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.id} · {e.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button variant="primary" disabled={!target} onClick={doImport}>
              Import metrics
            </Button>
          </div>
          {imported && (
            <p className={s.fine}>
              Imported. <Link to={`/lab/experiments/${imported}`}>Open {imported}</Link>
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
