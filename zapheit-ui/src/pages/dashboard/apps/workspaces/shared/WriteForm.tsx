import { useState } from 'react';
import { Shield, ShieldAlert, Loader2, Send } from 'lucide-react';

export interface WriteFormField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'hidden';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: string;
}

export interface WriteFormProps {
  title: string;
  fields: WriteFormField[];
  onSubmit: (values: Record<string, string>) => Promise<void>;
  governanceStatus?: 'auto' | 'needs_approval' | 'blocked';
  submitLabel?: string;
  onCancel?: () => void;
  compact?: boolean;
}

export function WriteForm({
  title,
  fields,
  onSubmit,
  governanceStatus = 'auto',
  submitLabel,
  onCancel,
  compact = false,
}: WriteFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) {
      if (f.defaultValue) init[f.name] = f.defaultValue;
    }
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBlocked = governanceStatus === 'blocked';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBlocked) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(values);
      // Reset form on success
      const init: Record<string, string> = {};
      for (const f of fields) {
        if (f.defaultValue) init[f.name] = f.defaultValue;
      }
      setValues(init);
    } catch (err: any) {
      setError(err.message || 'Action failed');
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const resolvedSubmitLabel =
    submitLabel ||
    (governanceStatus === 'needs_approval' ? 'Submit for approval' : 'Submit');

  const padding = compact ? 'p-3' : 'p-4';

  return (
    <form onSubmit={handleSubmit} className={`rounded-lg border border-zinc-800 bg-zinc-900/50 ${padding}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-zinc-200">{title}</h4>
        {governanceStatus === 'needs_approval' && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-400">
            <ShieldAlert className="w-3 h-3" />
            Requires approval
          </span>
        )}
        {isBlocked && (
          <span className="inline-flex items-center gap-1 text-xs text-red-400">
            <Shield className="w-3 h-3" />
            Blocked by policy
          </span>
        )}
      </div>

      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        {fields
          .filter((f) => f.type !== 'hidden')
          .map((field) => (
            <div key={field.name}>
              <label className="block text-xs text-zinc-400 mb-1">
                {field.label}
                {field.required && <span className="text-red-400 ml-0.5">*</span>}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  value={values[field.name] || ''}
                  onChange={(e) => updateField(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={isBlocked}
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
                />
              ) : field.type === 'select' ? (
                <select
                  value={values[field.name] || ''}
                  onChange={(e) => updateField(field.name, e.target.value)}
                  required={field.required}
                  disabled={isBlocked}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
                >
                  <option value="">Select...</option>
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={values[field.name] || ''}
                  onChange={(e) => updateField(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  required={field.required}
                  disabled={isBlocked}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
                />
              )}
            </div>
          ))}
      </div>

      {error && (
        <p className="text-xs text-red-400 mt-2">{error}</p>
      )}

      <div className="flex items-center gap-2 mt-3">
        <button
          type="submit"
          disabled={submitting || isBlocked}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
          {resolvedSubmitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
