/**
 * Update a user's role by email using Supabase PostgREST (service role).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... TARGET_EMAIL=user@example.com ROLE=admin node update-role.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const TARGET_EMAIL = process.env.TARGET_EMAIL || '';
const ROLE = process.env.ROLE || 'admin';

async function run() {
    try {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TARGET_EMAIL) {
            console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, TARGET_EMAIL');
            process.exit(1);
        }

        const url = `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(TARGET_EMAIL)}`;
        const res = await fetch(url, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ role: ROLE })
        });

        if (res.ok) {
            console.log(`Successfully updated role to ${ROLE} for ${TARGET_EMAIL}`);
        } else {
            const errorText = await res.text();
            console.error('Failed to update:', errorText);
        }
    } catch (err) {
        console.error(err);
    }
}
run();
