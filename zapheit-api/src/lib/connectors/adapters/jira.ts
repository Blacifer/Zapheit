// ---------------------------------------------------------------------------
// Jira Connector Adapter
//
// Full ConnectorAdapter implementation for Jira Cloud / Server.
// ---------------------------------------------------------------------------

import type { ActionResult } from '../action-executor';
import {
  ConnectorAdapter,
  HealthResult,
  jsonFetch,
  basicAuthHeaders,
  registerAdapter,
} from '../adapter';

function resolveAuth(creds: Record<string, string>) {
  const baseUrl = (creds.baseUrl || creds.base_url || '').replace(/\/+$/, '');
  const email = creds.email;
  const apiToken = creds.apiToken || creds.api_token;
  return { baseUrl, email, apiToken };
}

const jiraAdapter: ConnectorAdapter = {
  connectorId: 'jira',
  displayName: 'Jira',
  requiredCredentials: ['baseUrl', 'email', 'apiToken'],

  validateCredentials(creds) {
    const { baseUrl, email, apiToken } = resolveAuth(creds);
    const missing: string[] = [];
    if (!baseUrl) missing.push('baseUrl');
    if (!email) missing.push('email');
    if (!apiToken) missing.push('apiToken');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const { baseUrl, email, apiToken } = resolveAuth(creds);
    if (!baseUrl || !email || !apiToken) {
      return { healthy: false, error: 'Missing required credentials: baseUrl, email, apiToken' };
    }

    const start = Date.now();
    try {
      const headers = basicAuthHeaders(`${email}`, apiToken);
      const r = await jsonFetch(`${baseUrl}/rest/api/3/myself`, { headers });
      const latencyMs = Date.now() - start;

      if (!r.ok) {
        return { healthy: false, latencyMs, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}` };
      }
      return {
        healthy: true,
        latencyMs,
        accountLabel: `${r.data.displayName} (${r.data.emailAddress || r.data.accountId})`,
        details: { accountId: r.data.accountId, serverTitle: r.data.displayName },
      };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { baseUrl, email, apiToken } = resolveAuth(creds);
    if (!baseUrl || !email || !apiToken) {
      return { success: false, error: 'Jira credentials missing: baseUrl, email, apiToken required' };
    }

    const headers = basicAuthHeaders(`${email}`, apiToken);
    const api = `${baseUrl}/rest/api/3`;

    switch (action) {
      case 'get_issue': {
        if (!params.issue_key) return { success: false, error: 'get_issue requires: issue_key' };
        const r = await jsonFetch(`${api}/issue/${params.issue_key}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return {
          success: true,
          data: {
            key: r.data.key,
            summary: r.data.fields?.summary,
            status: r.data.fields?.status?.name,
            priority: r.data.fields?.priority?.name,
            assignee: r.data.fields?.assignee?.displayName,
            reporter: r.data.fields?.reporter?.displayName,
            created: r.data.fields?.created,
            updated: r.data.fields?.updated,
            description: r.data.fields?.description,
            issuetype: r.data.fields?.issuetype?.name,
            labels: r.data.fields?.labels,
          },
        };
      }

      case 'search_issues': {
        const jql = params.jql || params.query || 'order by updated DESC';
        const maxResults = params.limit || 20;
        const r = await jsonFetch(`${api}/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ jql, maxResults, fields: ['summary', 'status', 'priority', 'assignee', 'created', 'updated', 'issuetype'] }),
        });
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return {
          success: true,
          data: r.data.issues?.map((i: any) => ({
            key: i.key,
            summary: i.fields?.summary,
            status: i.fields?.status?.name,
            priority: i.fields?.priority?.name,
            assignee: i.fields?.assignee?.displayName,
            issuetype: i.fields?.issuetype?.name,
            updated: i.fields?.updated,
          })),
        };
      }

      case 'list_projects': {
        const r = await jsonFetch(`${api}/project/search?maxResults=${params.limit || 20}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return {
          success: true,
          data: r.data.values?.map((p: any) => ({
            id: p.id,
            key: p.key,
            name: p.name,
            projectTypeKey: p.projectTypeKey,
            lead: p.lead?.displayName,
          })),
        };
      }

      case 'get_board': {
        if (!params.board_id) return { success: false, error: 'get_board requires: board_id' };
        const agileApi = `${baseUrl}/rest/agile/1.0`;
        const r = await jsonFetch(`${agileApi}/board/${params.board_id}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: r.data };
      }

      case 'list_sprints': {
        if (!params.board_id) return { success: false, error: 'list_sprints requires: board_id' };
        const agileApi = `${baseUrl}/rest/agile/1.0`;
        const r = await jsonFetch(
          `${agileApi}/board/${params.board_id}/sprint?state=${params.state || 'active,future'}&maxResults=${params.limit || 10}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: r.data.values };
      }

      case 'get_transitions': {
        if (!params.issue_key) return { success: false, error: 'get_transitions requires: issue_key' };
        const r = await jsonFetch(`${api}/issue/${params.issue_key}/transitions`, { headers });
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: r.data.transitions };
      }

      default:
        return { success: false, error: `Unknown Jira read action: ${action}`, statusCode: 400 };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { baseUrl, email, apiToken } = resolveAuth(creds);
    if (!baseUrl || !email || !apiToken) {
      return { success: false, error: 'Jira credentials missing: baseUrl, email, apiToken required' };
    }

    const headers = basicAuthHeaders(`${email}`, apiToken);
    const api = `${baseUrl}/rest/api/3`;

    switch (action) {
      case 'create_issue': {
        if (!params.project_key || !params.summary || !params.issue_type) {
          return { success: false, error: 'create_issue requires: project_key, summary, issue_type' };
        }
        const fields: Record<string, any> = {
          project: { key: params.project_key },
          summary: params.summary,
          issuetype: { name: params.issue_type },
        };
        if (params.description) {
          fields.description = {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }],
          };
        }
        if (params.priority) fields.priority = { name: params.priority };
        if (params.labels) fields.labels = Array.isArray(params.labels) ? params.labels : [params.labels];
        if (params.assignee_id) fields.assignee = { accountId: params.assignee_id };

        const r = await jsonFetch(`${api}/issue`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ fields }),
        });
        if (!r.ok) return { success: false, error: r.data?.errors ? JSON.stringify(r.data.errors) : `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { key: r.data.key, id: r.data.id, self: r.data.self } };
      }

      case 'update_issue': {
        if (!params.issue_key) return { success: false, error: 'update_issue requires: issue_key' };
        const fields: Record<string, any> = {};
        if (params.summary) fields.summary = params.summary;
        if (params.priority) fields.priority = { name: params.priority };
        if (params.labels) fields.labels = Array.isArray(params.labels) ? params.labels : [params.labels];
        if (params.assignee_id) fields.assignee = { accountId: params.assignee_id };
        if (params.description) {
          fields.description = {
            type: 'doc',
            version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }],
          };
        }

        const r = await jsonFetch(`${api}/issue/${params.issue_key}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ fields }),
        });
        if (!r.ok) return { success: false, error: r.data?.errors ? JSON.stringify(r.data.errors) : `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { key: params.issue_key, updated: true } };
      }

      case 'transition_issue': {
        if (!params.issue_key || !params.transition_id) {
          return { success: false, error: 'transition_issue requires: issue_key, transition_id' };
        }
        const body: Record<string, any> = {
          transition: { id: params.transition_id },
        };
        if (params.comment) {
          body.update = {
            comment: [{
              add: {
                body: {
                  type: 'doc',
                  version: 1,
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: params.comment }] }],
                },
              },
            }],
          };
        }
        const r = await jsonFetch(`${api}/issue/${params.issue_key}/transitions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { key: params.issue_key, transitioned: true } };
      }

      case 'add_comment': {
        if (!params.issue_key || !params.body) {
          return { success: false, error: 'add_comment requires: issue_key, body' };
        }
        const r = await jsonFetch(`${api}/issue/${params.issue_key}/comment`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            body: {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content: [{ type: 'text', text: params.body }] }],
            },
          }),
        });
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { id: r.data.id, created: r.data.created } };
      }

      case 'delete_issue': {
        if (!params.issue_key) return { success: false, error: 'delete_issue requires: issue_key' };
        const r = await jsonFetch(`${api}/issue/${params.issue_key}`, {
          method: 'DELETE',
          headers,
        });
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { key: params.issue_key, deleted: true } };
      }

      case 'assign_issue': {
        if (!params.issue_key) return { success: false, error: 'assign_issue requires: issue_key' };
        const r = await jsonFetch(`${api}/issue/${params.issue_key}/assignee`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ accountId: params.assignee_id || null }),
        });
        if (!r.ok) return { success: false, error: r.data?.errorMessages?.[0] || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { key: params.issue_key, assigned: true } };
      }

      default:
        return { success: false, error: `Unknown Jira write action: ${action}`, statusCode: 400 };
    }
  },
};

// Auto-register on import
registerAdapter(jiraAdapter);

export default jiraAdapter;
