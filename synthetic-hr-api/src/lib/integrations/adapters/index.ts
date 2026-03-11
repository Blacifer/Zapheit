import type { IntegrationAdapter } from '../spec-types';
import { Phase1Adapters } from './phase1';
import { Phase2Adapters } from './phase2';
import { Phase3Adapters } from './phase3';
import { Phase4Adapters } from './phase4';

export const Adapters: Record<string, IntegrationAdapter> = {
  ...Phase1Adapters,
  ...Phase2Adapters,
  ...Phase3Adapters,
  ...Phase4Adapters,
};

export function getAdapter(serviceId: string): IntegrationAdapter | undefined {
  return Adapters[serviceId];
}
