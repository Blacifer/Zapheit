// ---------------------------------------------------------------------------
// Adapter Index
// Import this file to register all available connector adapters.
// Each adapter auto-registers via registerAdapter() on import.
// ---------------------------------------------------------------------------

import './slack';
import './jira';
import './github';

export { getRegisteredAdapter, listRegisteredAdapters } from '../adapter';
export type { ConnectorAdapter, HealthResult } from '../adapter';
