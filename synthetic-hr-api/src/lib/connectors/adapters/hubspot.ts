// ---------------------------------------------------------------------------
// HubSpot Connector Adapter
//
// Full ConnectorAdapter implementation for HubSpot CRM (v3 API).
// Reads: list_contacts, get_contact, list_deals, get_deal, list_companies, search_contacts
// Writes: create_contact, update_contact, create_deal, update_deal, create_company, add_note
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  ConnectorAdapter,
  HealthResult,
  jsonFetch,
  bearerHeaders,
  registerAdapter,
} from '../adapter';

function resolveAuth(creds: Record<string, string>) {
  const token = creds.token || creds.access_token || creds.api_key;
  const baseUrl = (creds.baseUrl || creds.base_url || 'https://api.hubapi.com').replace(/\/+$/, '');
  return { token, baseUrl };
}

const hubspotAdapter: ConnectorAdapter = {
  connectorId: 'hubspot',
  displayName: 'HubSpot',
  requiredCredentials: ['token'],

  validateCredentials(creds) {
    const { token } = resolveAuth(creds);
    const missing: string[] = [];
    if (!token) missing.push('token');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const { token, baseUrl } = resolveAuth(creds);
    if (!token) {
      return { healthy: false, error: 'Missing required credential: token (private app token)' };
    }

    const start = Date.now();
    try {
      const headers = bearerHeaders(token);
      const r = await jsonFetch(`${baseUrl}/crm/v3/objects/contacts?limit=1`, { headers });
      const latencyMs = Date.now() - start;

      if (!r.ok) {
        return { healthy: false, latencyMs, error: r.data?.message || `HTTP ${r.status}` };
      }

      return {
        healthy: true,
        latencyMs,
        accountLabel: 'HubSpot CRM',
        details: { totalContacts: r.data?.total },
      };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  /* ----- READS ---------------------------------------------------- */

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { token, baseUrl } = resolveAuth(creds);
    const headers = bearerHeaders(token);

    switch (action) {
      /* -- Contacts ------------------------------------------------ */
      case 'list_contacts': {
        const limit = params.limit || 20;
        const after = params.after ? `&after=${params.after}` : '';
        const properties = 'firstname,lastname,email,phone,company,jobtitle,lifecyclestage,createdate,lastmodifieddate';
        const r = await jsonFetch(
          `${baseUrl}/crm/v3/objects/contacts?limit=${limit}${after}&properties=${properties}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: { results: r.data.results, paging: r.data.paging, total: r.data.total } };
      }

      case 'get_contact': {
        const id = params.contactId || params.id;
        if (!id) return { success: false, error: 'contactId is required' };
        const properties = 'firstname,lastname,email,phone,company,jobtitle,lifecyclestage,hs_lead_status,createdate,lastmodifieddate';
        const r = await jsonFetch(`${baseUrl}/crm/v3/objects/contacts/${id}?properties=${properties}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'search_contacts': {
        const query = params.query || params.q;
        if (!query) return { success: false, error: 'query is required' };
        const r = await jsonFetch(`${baseUrl}/crm/v3/objects/contacts/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            query,
            limit: params.limit || 20,
            properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'jobtitle'],
          }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: { results: r.data.results, total: r.data.total } };
      }

      /* -- Deals --------------------------------------------------- */
      case 'list_deals': {
        const limit = params.limit || 20;
        const after = params.after ? `&after=${params.after}` : '';
        const properties = 'dealname,amount,dealstage,pipeline,closedate,createdate,hs_lastmodifieddate';
        const r = await jsonFetch(
          `${baseUrl}/crm/v3/objects/deals?limit=${limit}${after}&properties=${properties}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: { results: r.data.results, paging: r.data.paging, total: r.data.total } };
      }

      case 'get_deal': {
        const id = params.dealId || params.id;
        if (!id) return { success: false, error: 'dealId is required' };
        const properties = 'dealname,amount,dealstage,pipeline,closedate,createdate,hs_lastmodifieddate,hubspot_owner_id';
        const r = await jsonFetch(`${baseUrl}/crm/v3/objects/deals/${id}?properties=${properties}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      /* -- Companies ----------------------------------------------- */
      case 'list_companies': {
        const limit = params.limit || 20;
        const after = params.after ? `&after=${params.after}` : '';
        const properties = 'name,domain,industry,city,state,country,numberofemployees,annualrevenue,createdate';
        const r = await jsonFetch(
          `${baseUrl}/crm/v3/objects/companies?limit=${limit}${after}&properties=${properties}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: { results: r.data.results, paging: r.data.paging, total: r.data.total } };
      }

      default:
        return { success: false, error: `Unknown read action: ${action}` };
    }
  },

  /* ----- WRITES --------------------------------------------------- */

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { token, baseUrl } = resolveAuth(creds);
    const headers = bearerHeaders(token);

    switch (action) {
      /* -- Contacts ------------------------------------------------ */
      case 'create_contact': {
        const properties: Record<string, string> = {};
        if (params.email) properties.email = params.email;
        if (params.firstname) properties.firstname = params.firstname;
        if (params.lastname) properties.lastname = params.lastname;
        if (params.phone) properties.phone = params.phone;
        if (params.company) properties.company = params.company;
        if (params.jobtitle) properties.jobtitle = params.jobtitle;
        if (!properties.email) return { success: false, error: 'email is required to create a contact' };

        const r = await jsonFetch(`${baseUrl}/crm/v3/objects/contacts`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ properties }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'update_contact': {
        const id = params.contactId || params.id;
        if (!id) return { success: false, error: 'contactId is required' };
        const { contactId: _cid, id: _id, ...properties } = params;
        const r = await jsonFetch(`${baseUrl}/crm/v3/objects/contacts/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ properties }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      /* -- Deals --------------------------------------------------- */
      case 'create_deal': {
        const properties: Record<string, string> = {};
        if (params.dealname) properties.dealname = params.dealname;
        if (params.amount) properties.amount = String(params.amount);
        if (params.dealstage) properties.dealstage = params.dealstage;
        if (params.pipeline) properties.pipeline = params.pipeline;
        if (params.closedate) properties.closedate = params.closedate;
        if (!properties.dealname) return { success: false, error: 'dealname is required to create a deal' };

        const r = await jsonFetch(`${baseUrl}/crm/v3/objects/deals`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ properties }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      case 'update_deal': {
        const id = params.dealId || params.id;
        if (!id) return { success: false, error: 'dealId is required' };
        const { dealId: _did, id: _id, ...properties } = params;
        const r = await jsonFetch(`${baseUrl}/crm/v3/objects/deals/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ properties }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      /* -- Companies ----------------------------------------------- */
      case 'create_company': {
        const properties: Record<string, string> = {};
        if (params.name) properties.name = params.name;
        if (params.domain) properties.domain = params.domain;
        if (params.industry) properties.industry = params.industry;
        if (params.city) properties.city = params.city;
        if (!properties.name) return { success: false, error: 'name is required to create a company' };

        const r = await jsonFetch(`${baseUrl}/crm/v3/objects/companies`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ properties }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      /* -- Engagements / Notes ------------------------------------- */
      case 'add_note': {
        const contactId = params.contactId;
        const body = params.body || params.note || params.content;
        if (!body) return { success: false, error: 'body is required' };

        const r = await jsonFetch(`${baseUrl}/crm/v3/objects/notes`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            properties: { hs_note_body: body, hs_timestamp: new Date().toISOString() },
            associations: contactId
              ? [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }]
              : [],
          }),
        });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }

      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(hubspotAdapter);
