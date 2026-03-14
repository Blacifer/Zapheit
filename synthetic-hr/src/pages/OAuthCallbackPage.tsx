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

    if (window.opener && !window.opener.closed) {
      // Send result back to the parent window, then close this popup.
      // targetOrigin is always our own origin — never '*'.
      window.opener.postMessage(
        { type: 'OAUTH_COMPLETE', status, service, message },
        window.location.origin,
      );
      window.close();
    } else {
      // Opened in a regular tab (e.g. popup was blocked and we fell through to a redirect,
      // or the user pasted the URL directly). Pass the query params to the integrations page
      // so the existing parseOAuthToastFromQuery() handler can show the result.
      const qs = new URLSearchParams({ status, ...(service ? { service } : {}), ...(message ? { message } : {}) });
      window.location.replace(`/dashboard/integrations?${qs.toString()}`);
    }
  }, []);

  return <LoadingSpinner />;
}
