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

    // Broadcast to all tabs on this origin — handles the case where the browser
    // opened the OAuth flow as a new tab instead of a popup (window.opener is null).
    try {
      const bc = new BroadcastChannel('synthetic_hr_oauth');
      bc.postMessage(payload);
      bc.close();
    } catch { /* BroadcastChannel not supported in this environment */ }

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
      // New-tab flow: redirect this tab back to the integrations page.
      // The BroadcastChannel message above already notified the original tab.
      window.location.replace(fallbackUrl);
    }
  }, []);

  return <LoadingSpinner />;
}
