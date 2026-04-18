import { useEffect } from 'react';

function LoadingSpinner() {
  return (
    <div className="min-h-screen app-bg flex items-center justify-center text-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-2 border-white/20 border-t-blue-400" />
    </div>
  );
}

export default function OAuthCallbackPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status') ?? 'error';
    const service = params.get('service') ?? '';
    const message = params.get('message') ?? '';

    const payload = { type: 'OAUTH_COMPLETE', status, service, message };
    const qs = new URLSearchParams({ status, ...(service ? { service } : {}), ...(message ? { message } : {}) });
    const fallbackUrl = `/dashboard/integrations?${qs.toString()}`;

    // Write to localStorage — the storage event fires on ALL other tabs reliably
    // and is the most compatible cross-tab signal across every browser.
    try {
      localStorage.setItem('synthetic_hr_oauth_result', JSON.stringify({ ...payload, ts: Date.now() }));
    } catch { /* storage unavailable */ }

    // BroadcastChannel as a secondary channel (works for true popup windows).
    try {
      const bc = new BroadcastChannel('synthetic_hr_oauth');
      bc.postMessage(payload);
      // Don't close immediately — give the message time to deliver before page navigates.
      setTimeout(() => bc.close(), 500);
    } catch { /* BroadcastChannel not supported */ }

    if (window.opener && !window.opener.closed) {
      // Popup flow: send result back to the parent window, then close.
      window.opener.postMessage(payload, window.location.origin);
      window.close();
      // Some browsers open popups as tabs and ignore window.close().
      // Fall back to a redirect after a short delay so the user is never stuck.
      setTimeout(() => {
        window.location.replace(fallbackUrl);
      }, 1500);
    } else {
      // New-tab flow: short delay so localStorage/BroadcastChannel signals have
      // time to reach the original tab before this tab navigates away.
      setTimeout(() => {
        window.location.replace(fallbackUrl);
      }, 300);
    }
  }, []);

  return <LoadingSpinner />;
}
