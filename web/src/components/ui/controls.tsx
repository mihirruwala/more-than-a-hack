import {
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router";
import { AlertCircle, AlertTriangle, ChevronRight, Info, Search } from "lucide-react";
import type { ExperimentStatus, MetricReading } from "../../types";
import { ProvenanceBadge } from "./index";
import c from "./controls.module.css";

const cx = (...names: (string | false | undefined | null)[]) => names.filter(Boolean).join(" ");

// -- buttons --------------------------------------------------------------------------------

type Variant = "default" | "primary" | "ghost" | "danger" | "dangerSolid";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "sm";
  icon?: ReactNode;
  /** Icon-only buttons must still have an accessible name; it is passed here. */
  label?: string;
}

export function Button({ variant = "default", size = "md", icon, label, children, className, type = "button", ...rest }: ButtonProps) {
  const iconOnly = !children && !!icon;
  return (
    <button
      type={type}
      className={cx(c.btn, variant !== "default" && c[variant], size === "sm" && c.sm, iconOnly && c.iconOnly, className)}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function LinkButton({ to, variant = "default", size = "md", icon, children }: { to: string; variant?: Variant; size?: "md" | "sm"; icon?: ReactNode; children: ReactNode }) {
  return (
    <Link to={to} className={cx(c.btn, variant !== "default" && c[variant], size === "sm" && c.sm)}>
      {icon}
      {children}
    </Link>
  );
}

// -- fields ---------------------------------------------------------------------------------

/**
 * Label, control, hint and error wired together: the control gets the id, aria-invalid and
 * aria-describedby, so screen readers announce the error with the field.
 */
export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  children: (props: { id: string; "aria-invalid": boolean; "aria-describedby"?: string; className: string }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx(c.field, className)}>
      <label htmlFor={id} className={c.fieldLabel}>
        {label}
        {required && (
          <span className={c.required} aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="visually-hidden"> (required)</span>}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": describedBy, className: error ? c.invalid! : "" })}
      {hint && (
        <span id={hintId} className={c.hint}>
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className={c.error} role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          {error}
        </span>
      )}
    </div>
  );
}

export function Input({ className, mono, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input className={cx(c.input, mono && c.monoInput, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(c.select, className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(c.textarea, className)} {...rest} />;
}

export function SearchInput({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className={c.search}>
      <Search size={16} aria-hidden="true" />
      <input type="search" className={c.input} aria-label={label} {...rest} />
    </div>
  );
}

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={c.checkboxRow}>
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}

// -- tabs -----------------------------------------------------------------------------------

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/** WAI-ARIA tabs: arrow keys move between tabs, and only the active tab is in the tab order. */
export function Tabs<T extends string>({ tabs, value, onChange, label, idPrefix }: { tabs: TabDef<T>[]; value: T; onChange: (id: T) => void; label: string; idPrefix: string }) {
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + delta + tabs.length) % tabs.length;
    const next = tabs[nextIndex]!;
    onChange(next.id);
    document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={c.tabs}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.id}`}
          aria-selected={tab.id === value}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={tab.id === value ? 0 : -1}
          className={c.tab}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => onKey(event, index)}
        >
          {tab.label}
          {tab.count !== undefined && <span className={c.tabCount}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, active, children }: { idPrefix: string; active: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${active}`}>
      {children}
    </div>
  );
}

// -- chips & segmented ----------------------------------------------------------------------

export function Chip({ pressed, onClick, children, label }: { pressed: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button type="button" className={c.chip} aria-pressed={pressed} onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div className={c.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// -- page header ----------------------------------------------------------------------------

export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  crumbs,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  crumbs?: { to: string; label: string }[];
}) {
  return (
    <header className={c.pageHeader}>
      <div>
        {crumbs && (
          <nav aria-label="Breadcrumb" className={c.crumbs}>
            {crumbs.map((crumb) => (
              <span key={crumb.to} className={c.crumbs}>
                <Link to={crumb.to}>{crumb.label}</Link>
                <ChevronRight size={14} aria-hidden="true" />
              </span>
            ))}
          </nav>
        )}
        {eyebrow}
        <h1 className={c.pageTitle}>{title}</h1>
        {lede && <p className={c.pageLede}>{lede}</p>}
      </div>
      {actions && <div className={c.pageActions}>{actions}</div>}
    </header>
  );
}

// -- metric & status ------------------------------------------------------------------------

/** A metric reading with its provenance. A missing metric says so and is never shown as 0. */
export function MetricCell({ reading, large = false, showSource = false }: { reading: MetricReading; large?: boolean; showSource?: boolean }) {
  if (reading.kind === "unavailable") return <span className={c.metricNone}>Not recorded</span>;
  const { metric } = reading;
  return (
    <span className={cx(c.metric, large && c.metricLarge)}>
      <span className={c.metricValue}>{metric.value.toFixed(4)}</span>
      <ProvenanceBadge provenance={metric.provenance} />
      {showSource && <span className={c.hint}>{metric.scope} · {metric.source}</span>}
    </span>
  );
}

const STATUS_LABEL: Record<ExperimentStatus, string> = {
  planned: "Planned",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_GLYPH: Record<ExperimentStatus, string> = { planned: "○", running: "◐", completed: "●", failed: "✕" };

/** The glyph and text carry the status as well as the colour does, so colour is never the only cue. */
export function ExperimentStatusBadge({ status }: { status: ExperimentStatus }) {
  return (
    <span className={c.expStatus} data-status={status}>
      <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export const statusLabel = (status: ExperimentStatus) => STATUS_LABEL[status];

export function Notice({ tone = "warning", children }: { tone?: "warning" | "info"; children: ReactNode }) {
  return (
    <div className={c.notice} data-tone={tone} role={tone === "warning" ? "status" : undefined}>
      {tone === "warning" ? <AlertTriangle size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}

export const tableClasses = { wrap: c.tableWrap, table: c.table, num: c.num };
