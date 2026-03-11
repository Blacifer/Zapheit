/**
 * Check that PostgREST returns expected columns for api_keys (service role).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node check-schema-proper.js
 */

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

async function run() {
    try {
        if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
            console.error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY');
            process.exit(1);
        }

        const url = `${SUPABASE_URL}/rest/v1/api_keys?select=*&limit=1`;
        const res = await fetch(url, {
            headers: {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
            }
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : null;
        if (!res.ok) {
            console.error('Request failed:', res.status, text);
            process.exit(1);
        }
        if (data && data.length > 0) {
            console.log(Object.keys(data[0]));
        } else {
            console.log("No data returned", data);
        }
    } catch (err) {
        console.error(err);
    }
}
run();
