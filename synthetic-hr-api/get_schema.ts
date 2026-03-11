import { supabaseAdmin } from './src/lib/supabase';
async function main() {
  const { data, error } = await supabaseAdmin.rpc('create_api_key_integration', { });
  console.log(error);
}
main();
