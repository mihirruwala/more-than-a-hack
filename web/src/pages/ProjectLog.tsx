import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { EmptyState, SectionLabel } from "../components/ui";
import { Button, Chip, Field, Input, PageHeader, SearchInput, Select, Textarea } from "../components/ui/controls";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { useToast } from "../components/ui/Toast";
import type { FieldErrors } from "../lib/research/experiments";
import type { LogDraft } from "../lib/store/researchStore";
import { useResearch, useResearchStore } from "../lib/store/useResearch";
import { useTitle } from "../lib/useTitle";
import { LOG_KINDS, type LogKind } from "../types";
import s from "./ProjectLog.module.css";

const KIND_LABEL: Record<LogKind, string> = {
  milestone: "Milestone",
  decision: "Decision",
  bug: "Bug",
  experiment: "Experiment",
  limitation: "Limitation",
  next: "Next step",
};

const today = () => new Date().toISOString().slice(0, 10);

export function ProjectLog() {
  useTitle("Project Log");
  const { log } = useResearch();
  const store = useResearchStore();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [kinds, setKinds] = useState<Set<LogKind>>(() => new Set(LOG_KINDS));
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const entries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return log
      .filter((e) => kinds.has(e.kind) && (!needle || `${e.title} ${e.body}`.toLowerCase().includes(needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  }, [log, search, kinds]);

  const toggleKind = (kind: LogKind) =>
    setKinds((set) => {
      const next = new Set(set);
      next.has(kind) ? next.delete(kind) : next.add(kind);
      return next;
    });

  const grouped = entries.reduce<Record<string, typeof entries>>((acc, entry) => {
    (acc[entry.date] ??= []).push(entry);
    return acc;
  }, {});
  const target = log.find((e) => e.id === pendingDelete);

  return (
    <div className={s.page}>
      <PageHeader
        eyebrow={<SectionLabel rule>Lab · log</SectionLabel>}
        title={
          <>
            Project <em>log</em>
          </>
        }
        lede="Milestones, decisions, bugs, limitations and next steps. Every entry is written by hand; nothing here is collected automatically from git or from Claude Code."
        actions={
          <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setAdding(true)}>
            Add entry
          </Button>
        }
      />

      <div className={s.toolbar}>
        <div className={s.search}>
          <SearchInput label="Search the log" placeholder="Search titles and notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className={s.chips} role="group" aria-label="Filter by kind">
          {LOG_KINDS.map((kind) => (
            <Chip key={kind} pressed={kinds.has(kind)} onClick={() => toggleKind(kind)}>
              <span className={s.dot} data-kind={kind} aria-hidden="true" />
              {KIND_LABEL[kind]}
            </Chip>
          ))}
          {kinds.size < LOG_KINDS.length && (
            <Button size="sm" variant="ghost" onClick={() => setKinds(new Set(LOG_KINDS))}>
              Show all
            </Button>
          )}
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState title={log.length ? "No entries match" : "The log is empty"} action={log.length ? <Button onClick={() => { setSearch(""); setKinds(new Set(LOG_KINDS)); }}>Clear filters</Button> : undefined}>
          {log.length ? "Try a different search or kind." : "Record a decision or a milestone to start the log."}
        </EmptyState>
      ) : (
        <div className={s.timeline}>
          {Object.entries(grouped).map(([date, items]) => (
            <section key={date} className={s.day} aria-labelledby={`day-${date}`}>
              <h2 id={`day-${date}`} className={`mono ${s.date}`}>
                {date}
              </h2>
              <ul className={s.entries}>
                {items.map((entry) => (
                  <li key={entry.id} className={s.entry}>
                    <span className={s.kind} data-kind={entry.kind}>
                      {KIND_LABEL[entry.kind]}
                    </span>
                    <div className={s.entryBody}>
                      <h3>{entry.title}</h3>
                      {entry.body && <p>{entry.body}</p>}
                      <span className={s.meta}>
                        <span className="mono">{entry.id}</span> · entered by hand
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} label={`Delete “${entry.title}”`} onClick={() => setPendingDelete(entry.id)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <AddEntryDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSubmit={(draft) => {
          const result = store.addLogEntry(draft);
          if (result.ok) {
            toast("Log entry added.");
            setAdding(false);
          }
          return result.ok ? {} : result.errors;
        }}
      />

      <ConfirmDialog
        open={!!target}
        title="Delete this entry?"
        confirmLabel="Delete entry"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (target) store.deleteLogEntry(target.id);
          setPendingDelete(null);
          toast("Entry deleted.", "info");
        }}
      >
        <p>“{target?.title}” will be permanently removed from this browser's log.</p>
      </ConfirmDialog>
    </div>
  );
}

function AddEntryDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (d: LogDraft) => FieldErrors }) {
  const blank = (): LogDraft => ({ date: today(), kind: "decision", title: "", body: "" });
  const [draft, setDraft] = useState<LogDraft>(blank);
  const [errors, setErrors] = useState<FieldErrors>({});
  const close = () => {
    setDraft(blank());
    setErrors({});
    onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = onSubmit(draft);
    setErrors(result);
    if (!Object.keys(result).length) setDraft(blank());
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add a log entry"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" form="log-form" variant="primary">
            Add entry
          </Button>
        </>
      }
    >
      <form id="log-form" className={s.form} onSubmit={submit} noValidate>
        <div className={s.formRow}>
          <Field label="Date" required error={errors.date}>
            {(p) => <Input {...p} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />}
          </Field>
          <Field label="Kind">
            {(p) => (
              <Select {...p} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as LogKind })}>
                {LOG_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Title" required error={errors.title}>
          {(p) => <Input {...p} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />}
        </Field>
        <Field label="Notes">
          {(p) => <Textarea {...p} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />}
        </Field>
      </form>
    </Dialog>
  );
}
