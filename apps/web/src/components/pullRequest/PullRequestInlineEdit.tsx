import { useId, useRef, useState, type ReactNode } from 'react';
import { Check, Pencil, X } from 'lucide-react';

// Interaction follows UI Arc's inline-edit (MIT), using the app's controls and typography.
export function PullRequestInlineEdit({
  value,
  version,
  label,
  variant = 'title',
  onSave,
  children,
}: {
  value: string;
  version: string;
  label: string;
  variant?: 'title' | 'description' | 'branch';
  onSave: (value: string, version: string) => Promise<void>;
  children?: ReactNode;
}) {
  const multiline = variant === 'description';
  const Label = variant === 'branch' ? 'code' : 'h2';
  const [edit, setEdit] = useState<{ draft: string; version: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const id = useId();
  const start = () => {
    setError('');
    setEdit({ draft: value, version });
  };
  const save = async () => {
    if (!edit || pending.current) return;
    const next = multiline ? edit.draft : edit.draft.trim();
    if (!multiline && !next) {
      setError(`${label} is required.`);
      return;
    }
    if (next === value) {
      setEdit(null);
      return;
    }
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(next, edit.version);
      setEdit(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <div className={`pr-inline-field pr-inline-${variant} min-w-0`}>
      {edit ? (
        <div
          className="pr-inline-editor"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) void save();
          }}
        >
          <textarea
            className={`block w-full resize-y rounded-[var(--control-radius)] border-0 bg-background px-2 py-1.5 text-inherit outline-none [field-sizing:content] enabled:hover:bg-muted focus-visible:bg-muted ${variant === 'title' ? 'text-base font-semibold leading-6' : 'text-xs leading-5'} ${variant === 'branch' ? '[font-family:var(--font-mono)]' : ''}`}
            autoFocus
            aria-label={label}
            aria-invalid={!!error}
            aria-describedby={error ? id : undefined}
            rows={multiline ? 4 : 1}
            disabled={saving}
            value={edit.draft}
            maxLength={multiline ? 65536 : 200}
            onChange={(event) => setEdit({ ...edit, draft: event.target.value })}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') {
                event.preventDefault();
                if (!pending.current) setEdit(null);
              }
              if (event.key === 'Enter' && (!multiline || !event.shiftKey)) {
                event.preventDefault();
                void save();
              }
            }}
          />
          <div className="pr-inline-actions mt-1 flex items-center justify-end gap-1 text-muted-foreground text-[length:var(--text-2xs)] font-normal">
            {saving && (
              <span className="mr-auto" role="status">
                Saving…
              </span>
            )}
            <button
              className="icon-button"
              aria-label={`Save ${label.toLowerCase()}`}
              disabled={saving}
              onClick={() => void save()}
            >
              <Check size={14} />
            </button>
            <button
              className="icon-button"
              aria-label={`Cancel ${label.toLowerCase()} edit`}
              disabled={saving}
              onClick={() => setEdit(null)}
            >
              <X size={14} />
            </button>
          </div>
          {error && (
            <p
              className="pr-inline-error text-xs text-[var(--error-foreground)]"
              id={id}
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      ) : multiline ? (
        <div className="pr-description flex items-start gap-1 rounded-[var(--control-radius)] hover:bg-muted">
          <div className="min-w-0 flex-1">{children}</div>
          <button
            className="icon-button"
            title={`Edit ${label.toLowerCase()}`}
            aria-label={`Edit ${label.toLowerCase()}`}
            onClick={start}
          >
            <Pencil size={14} />
          </button>
        </div>
      ) : (
        <Label
          className={
            variant === 'branch'
              ? 'block min-w-0 truncate text-xs leading-5 [font-family:var(--font-mono)]'
              : 'm-0 text-base font-semibold leading-6 [overflow-wrap:anywhere]'
          }
          aria-label={value}
        >
          <button
            className={`pr-inline-trigger group/inline block w-full rounded-[var(--control-radius)] text-left [font:inherit] [line-height:inherit] [overflow-wrap:anywhere] hover:bg-muted ${variant === 'branch' ? 'truncate' : ''}`}
            aria-label={`Edit ${label.toLowerCase()}`}
            onClick={start}
          >
            {value}
            {variant === 'title' && (
              <Pencil
                size={13}
                className="ml-2 inline text-muted-foreground opacity-0 group-hover/inline:opacity-100 group-focus-visible/inline:opacity-100"
                aria-hidden
              />
            )}
          </button>
        </Label>
      )}
    </div>
  );
}
