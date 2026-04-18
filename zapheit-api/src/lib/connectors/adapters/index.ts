// ---------------------------------------------------------------------------
// Adapter Index
// Import this file to register all available connector adapters.
// Each adapter auto-registers via registerAdapter() on import.
// ---------------------------------------------------------------------------

import './slack';
import './jira';
import './github';
import './hubspot';
import './quickbooks';
import './google-workspace';
import './zoho-people';
import './notion';
import './whatsapp';

export { getRegisteredAdapter, listRegisteredAdapters } from '../adapter';
export type { ConnectorAdapter, HealthResult } from '../adapter';
