import { useEffect, useState } from 'react';
import { Shield, X } from 'lucide-react';
import { supabase } from '../lib/supabase-client';
import { loadFromStorage, saveToStorage } from '../utils/storage';
import type { AuthUser } from '../context/AppContext';

const DISMISS_KEY = 'mfa_nudge_dismissed_at';
const RESHOW_DAYS = 7;

export function MfaNudgeBanner({
  onNavigateToSecurity,
  user,
}: {
  onNavigateToSecurity: () => void;
  user?: AuthUser | null;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Check if MFA is already enrolled
        const { data } = await supabase.auth.mfa.listFactors();
        const hasVerified = data?.totp?.some((f) => f.status === 'verified');
        if (hasVerified || cancelled) return;
        if (user?.role === 'super_admin' || user?.role === 'admin') return;

        // Check if dismissed recently
        const dismissedAt = loadFromStorage<number | null>(DISMISS_KEY, null);
        if (dismissedAt && Date.now() - dismissedAt < RESHOW_DAYS * 86_400_000) return;

        if (!cancelled) setVisible(true);
      } catch {
        // Silently fail — don't block the app
      }
    })();
    return () => { cancelled = true; };
  }, [user?.role]);

  if (!visible) return null;

  const dismiss = () => {
    saveToStorage(DISMISS_KEY, Date.now());
    setVisible(false);
  };

  return (
    <div className="mx-8 mt-4 flex items-center justify-between gap-4 rounded-2xl border border-amber-500/15 bg-amber-500/[0.04] px-5 py-3.5">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
          <Shield className="h-4 w-4 text-amber-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-200">
            Protect your account with two-factor authentication
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Add an extra layer of security to prevent unauthorized access. Admin operators are required to enable it.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onNavigateToSecurity}
          className="rounded-lg bg-white/[0.08] px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
        >
          Set up now
        </button>
        <button
          onClick={dismiss}
          className="rounded-lg p-1.5 text-slate-500 transition-colors hover:text-slate-300"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
