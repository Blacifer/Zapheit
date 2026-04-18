import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { supabase, authHelpers } from '../lib/supabase-client';
import { getFrontendConfig } from '../lib/config';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('Completing sign in...');

  useEffect(() => {
    // Listen for Supabase to finish processing the OAuth code in the URL.
    // The JS client handles the PKCE exchange automatically; we just wait for the event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        subscription.unsubscribe();

        // Check if this user already has a provisioned workspace
        const { profile } = await authHelpers.getWorkspaceProfile(session.user.id);

        if (!profile?.organization_id) {
          setStatus('Setting up your workspace...');

          const config = getFrontendConfig();
          const apiBase = (config.apiUrl || 'http://localhost:3001/api').replace(/\/+$/, '');
          const provisionUrl = apiBase.endsWith('/api')
            ? `${apiBase.slice(0, -4)}/auth/provision`
            : `${apiBase}/auth/provision`;

          // Derive org name from email domain (e.g. "acme.com" → "Acme")
          const email = session.user.email || '';
          const domain = email.split('@')[1] || 'workspace';
          const domainName = domain.split('.')[0];
          const orgName = domainName.charAt(0).toUpperCase() + domainName.slice(1);
          const slug = domainName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || `workspace-${session.user.id.substring(0, 8)}`;

          await fetch(provisionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ name: orgName, orgName, slug }),
          }).catch(() => null); // best-effort
        }

        // Full page reload so App.tsx re-runs loadSession with the new session
        window.location.replace('/dashboard');
      } else if (event === 'SIGNED_OUT') {
        subscription.unsubscribe();
        navigate('/login?error=oauth_failed', { replace: true });
      }
    });

    // Fallback: if the auth state never fires (e.g. user arrived without a code),
    // check for an existing session after a short delay
    const fallbackTimer = setTimeout(async () => {
      const { user } = await authHelpers.getCurrentUser();
      if (user) {
        window.location.replace('/dashboard');
      } else {
        navigate('/login', { replace: true });
      }
    }, 5000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(fallbackTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen app-bg flex items-center justify-center text-slate-50">
      <div className="text-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto mb-4" />
        <p className="text-slate-400">{status}</p>
      </div>
    </div>
  );
}
