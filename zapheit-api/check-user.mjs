import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/patty/Downloads/RasiZapheit/zapheit-api/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function run() {
  const { data: users, error } = await supabase.from('users').select('*');
  console.log('Users in DB:');
  console.log(JSON.stringify(users, null, 2));
}

run();
