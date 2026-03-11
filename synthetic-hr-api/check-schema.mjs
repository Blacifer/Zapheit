import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/patty/Downloads/RasiSyntheticHR/synthetic-hr-api/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function run() {
  const { data: keys, error } = await supabase.from('api_keys').select('*').limit(1);
  console.log('API Keys table columns:');
  if (keys && keys.length > 0) {
    console.log(Object.keys(keys[0]));
  } else {
    // If table is empty, we can try to insert a dummy row and catch the error, or query information_schema if we had access. Let's just print the error if it fails.
    console.log(error);
  }
}

run();
