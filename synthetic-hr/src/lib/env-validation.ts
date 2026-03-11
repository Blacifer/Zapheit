const requiredInAllEnvs = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const requiredInProduction = ['VITE_API_URL'];

function missing(keys: string[]): string[] {
  return keys.filter((key) => {
    const value = import.meta.env[key];
    return typeof value !== 'string' || value.trim() === '';
  });
}

export function validateFrontendEnvironment(): void {
  const missingAll = missing(requiredInAllEnvs);
  if (missingAll.length > 0) {
    throw new Error(`Frontend environment validation failed. Missing: ${missingAll.join(', ')}`);
  }

  if (import.meta.env.PROD) {
    const missingProd = missing(requiredInProduction);
    if (missingProd.length > 0) {
      throw new Error(`Frontend production environment validation failed. Missing: ${missingProd.join(', ')}`);
    }
  }
}
