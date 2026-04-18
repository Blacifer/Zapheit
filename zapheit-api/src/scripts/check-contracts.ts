import { verifySchemaCompatibility } from '../lib/schema-compat';

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.log('[contracts] Skipping schema contract checks (missing SUPABASE_URL or SUPABASE_SERVICE_KEY).');
    process.exit(0);
  }

  const result = await verifySchemaCompatibility();
  const strictOptional = String(process.env.SCHEMA_COMPAT_STRICT_OPTIONAL || '').toLowerCase() === 'true';

  if (result.ok) {
    if (strictOptional && result.optionalMissing.length > 0) {
      console.error(`[contracts] Optional contracts failed in strict mode: ${result.optionalMissing.length}`);
      result.optionalMissing.forEach((item) => {
        console.error(`- ${item.table}${item.column ? `.${item.column}` : ''}: ${item.reason}`);
      });
      process.exit(1);
    }

    if (result.optionalMissing.length > 0) {
      console.log(`[contracts] Required contracts passed; optional mismatches: ${result.optionalMissing.length} (strict mode off).`);
    } else {
      console.log('[contracts] Schema contracts passed.');
    }
    process.exit(0);
  }

  console.error('[contracts] Schema contracts failed:');
  result.missing.forEach((item) => {
    console.error(`- ${item.table}${item.column ? `.${item.column}` : ''}: ${item.reason}`);
  });
  process.exit(1);
}

void main();
