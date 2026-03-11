/**
 * Quick DB check via Supabase PostgREST (service role).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node check-db.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

async function run() {
    try {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
            console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY');
            process.exit(1);
        }

        const url = `${SUPABASE_URL}/rest/v1/users?select=*`;
        const res = await fetch(url, {
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            }
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
            const errorText = typeof data === 'string' ? data : JSON.stringify(data);
            console.error('Request failed:', res.status, errorText);
            process.exit(1);
        }
        console.log(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(err);
    }
}
run();
