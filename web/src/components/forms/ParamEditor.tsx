import { Plus, Trash2 } from "lucide-react";
import type { ParamRow } from "../../lib/research/params";
import { Button, Input } from "../ui/controls";
import s from "./forms.module.css";

/** Key/value rows for a configuration. Values are parsed on save: 25 → number, true → boolean. */
export function ParamEditor({ rows, onChange, errors }: { rows: ParamRow[]; onChange: (rows: ParamRow[]) => void; errors: Record<string, string> }) {
  const set = (index: number, patch: Partial<ParamRow>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <fieldset className={s.params}>
      <legend className={s.legend}>Configuration parameters</legend>
      <p className={s.legendHint}>Numbers and true/false are stored as such. Leave a row empty to ignore it.</p>
      <div className={s.paramHead} aria-hidden="true">
        <span>Name</span>
        <span>Value</span>
      </div>
      {rows.map((row, index) => {
        const error = errors[`params.${index}`];
        return (
          <div key={index} className={s.paramRow}>
            <Input
              mono
              value={row.key}
              placeholder="max_gap"
              aria-label={`Parameter ${index + 1} name`}
              aria-invalid={!!error}
              className={error ? s.invalid : undefined}
              onChange={(event) => set(index, { key: event.target.value })}
            />
            <Input
              mono
              value={row.value}
              placeholder="75"
              aria-label={`Parameter ${index + 1} value`}
              onChange={(event) => set(index, { value: event.target.value })}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={15} aria-hidden="true" />}
              label={`Remove parameter ${row.key || index + 1}`}
              onClick={() => onChange(rows.length > 1 ? rows.filter((_, i) => i !== index) : [{ key: "", value: "" }])}
            />
            {error && (
              <span className={s.rowError} role="alert">
                {error}
              </span>
            )}
          </div>
        );
      })}
      <div>
        <Button size="sm" icon={<Plus size={15} aria-hidden="true" />} onClick={() => onChange([...rows, { key: "", value: "" }])}>
          Add parameter
        </Button>
      </div>
    </fieldset>
  );
}
