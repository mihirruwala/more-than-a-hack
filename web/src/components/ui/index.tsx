import type { ReactNode } from "react";
import { Link } from "react-router";
import type { MilestoneStatus, Provenance } from "../../types";
import s from "./ui.module.css";

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

export function SectionLabel({ children, rule = false }: { children: ReactNode; rule?: boolean }) {
  return <span className={cx(s.label, rule && s.labelRule)}>{children}</span>;
}

export function Panel({
  title,
  aside,
  children,
  className,
  bodyClassName,
  labelledBy,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  labelledBy?: string;
}) {
  return (
    <section className={cx(s.panel, className)} aria-labelledby={labelledBy}>
      {(title || aside) && (
        <header className={s.panelHead}>
          {title && (
            <h2 className={s.panelTitle} id={labelledBy}>
              {title}
            </h2>
          )}
          {aside}
        </header>
      )}
      <div className={cx(s.panelBody, bodyClassName)}>{children}</div>
    </section>
  );
}

const PROVENANCE_TEXT: Record<Provenance, { label: string; title: string }> = {
  verified: { label: "Verified run", title: "Produced by the official scorer, and the run is recorded" },
  published: { label: "Published", title: "Quoted from the competition's own documentation" },
  manual: { label: "Manual", title: "Entered by hand and not independently verified" },
  synthetic: { label: "Synthetic", title: "Computed on synthetic test data, not on the match" },
  demo: { label: "Demo data", title: "Illustrative only and meaningless as a result" },
};

export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  const text = PROVENANCE_TEXT[provenance];
  return (
    <span className={cx(s.badge, s[`prov-${provenance}`])} title={text.title}>
      {text.label}
    </span>
  );
}

const STATUS_TEXT: Record<MilestoneStatus, string> = {
  done: "Done",
  active: "In progress",
  blocked: "Blocked",
  todo: "To do",
};

export function StatusPill({ status }: { status: MilestoneStatus }) {
  return (
    <span className={cx(s.status, s[`st-${status}`])}>
      <span className={s.statusDot} aria-hidden="true" />
      {STATUS_TEXT[status]}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  note,
  foot,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  foot?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx(s.stat, className)}>
      <SectionLabel>{label}</SectionLabel>
      <div className={s.statValue}>
        {value}
        {unit && <span className={s.statUnit}>{unit}</span>}
      </div>
      {note && <p className={s.statNote}>{note}</p>}
      {foot && <div className={s.statFoot}>{foot}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <span className={s.emptyTitle}>{title}</span>
      <div>{children}</div>
      {action}
    </div>
  );
}

type Tone = "default" | "primary" | "onCream";

export function ButtonLink({
  to,
  children,
  tone = "default",
}: {
  to: string;
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <Link to={to} className={cx(s.button, tone === "primary" && s.primary, tone === "onCream" && s.onCream)}>
      {children}
    </Link>
  );
}

/** Format a 0–1 score to four places, the precision the scorer prints. */
export const score = (value: number | undefined) => (value === undefined ? "—" : value.toFixed(4));
