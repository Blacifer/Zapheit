const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  try {
    // Just force an error from the RPC to read the signature in the error message
    const { data, error } = await supabase.rpc('create_api_key_integration', { });
    console.log("TEST RESULT:", data, "TEST ERROR:", error);
  } catch (e) {
    console.error("EXCEPTION:", e);
  }
}
main();
