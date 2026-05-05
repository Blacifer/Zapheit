import type { IntegrationAdapter } from '../spec-types';
import { Phase1Adapters } from './phase1';
import { Phase2Adapters } from './phase2';
import { Phase3Adapters } from './phase3';
import { Phase4Adapters } from './phase4';
import { Phase5Adapters } from './phase5';
import { Phase6Adapters } from './phase6';
import { Phase7Adapters } from './phase7';
import { Phase8Adapters } from './phase8';
import { NewOAuthAdapters } from './phase-new-oauth';

export const Adapters: Record<string, IntegrationAdapter> = {
  ...Phase1Adapters,
  ...Phase2Adapters,
  ...Phase3Adapters,
  ...Phase4Adapters,
  ...Phase5Adapters,
  ...Phase6Adapters,
  ...Phase7Adapters,
  ...Phase8Adapters,
  ...NewOAuthAdapters,
};

export function getAdapter(serviceId: string): IntegrationAdapter | undefined {
  return Adapters[serviceId];
}
