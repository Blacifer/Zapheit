// ---------------------------------------------------------------------------
// GitHub Connector Adapter
//
// Full ConnectorAdapter implementation for GitHub (REST API v3).
// Reads: list_repos, list_pulls, list_issues, get_pull, get_issue, search_code
// Writes: create_issue, update_issue, create_comment, merge_pull, create_pull, close_issue
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
  const token = creds.token || creds.access_token || creds.pat;
  const baseUrl = (creds.baseUrl || creds.base_url || 'https://api.github.com').replace(/\/+$/, '');
  return { token, baseUrl };
}

const githubAdapter: ConnectorAdapter = {
  connectorId: 'github',
  displayName: 'GitHub',
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
      return { healthy: false, error: 'Missing required credential: token (personal access token)' };
    }

    const start = Date.now();
    try {
      const headers = bearerHeaders(token);
      const r = await jsonFetch(`${baseUrl}/user`, { headers });
      const latencyMs = Date.now() - start;

      if (!r.ok) {
        return { healthy: false, latencyMs, error: r.data?.message || `HTTP ${r.status}` };
      }
      return {
        healthy: true,
        latencyMs,
        accountLabel: `${r.data.login} (${r.data.name || r.data.login})`,
        details: { login: r.data.login, id: r.data.id },
      };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { token, baseUrl } = resolveAuth(creds);
    if (!token) {
      return { success: false, error: 'GitHub credentials missing: token required' };
    }

    const headers = bearerHeaders(token);

    switch (action) {
      case 'list_repos': {
        const owner = params.owner || params.org;
        const url = owner
          ? `${baseUrl}/orgs/${encodeURIComponent(owner)}/repos?per_page=${params.limit || 30}&sort=updated`
          : `${baseUrl}/user/repos?per_page=${params.limit || 30}&sort=updated`;
        const r = await jsonFetch(url, { headers });
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return {
          success: true,
          data: (r.data as any[]).map((repo: any) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            description: repo.description,
            private: repo.private,
            language: repo.language,
            stargazers_count: repo.stargazers_count,
            open_issues_count: repo.open_issues_count,
            updated_at: repo.updated_at,
            html_url: repo.html_url,
            default_branch: repo.default_branch,
          })),
        };
      }

      case 'list_pulls': {
        if (!params.owner || !params.repo) return { success: false, error: 'list_pulls requires: owner, repo' };
        const state = params.state || 'open';
        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/pulls?state=${state}&per_page=${params.limit || 30}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return {
          success: true,
          data: (r.data as any[]).map((pr: any) => ({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            user: pr.user?.login,
            created_at: pr.created_at,
            updated_at: pr.updated_at,
            draft: pr.draft,
            mergeable_state: pr.mergeable_state,
            head_ref: pr.head?.ref,
            base_ref: pr.base?.ref,
            additions: pr.additions,
            deletions: pr.deletions,
            changed_files: pr.changed_files,
            html_url: pr.html_url,
            labels: pr.labels?.map((l: any) => l.name) || [],
            reviewers: pr.requested_reviewers?.map((r: any) => r.login) || [],
          })),
        };
      }

      case 'get_pull': {
        if (!params.owner || !params.repo || !params.pull_number) {
          return { success: false, error: 'get_pull requires: owner, repo, pull_number' };
        }
        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/pulls/${params.pull_number}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return {
          success: true,
          data: {
            number: r.data.number,
            title: r.data.title,
            body: r.data.body,
            state: r.data.state,
            merged: r.data.merged,
            user: r.data.user?.login,
            created_at: r.data.created_at,
            updated_at: r.data.updated_at,
            head_ref: r.data.head?.ref,
            base_ref: r.data.base?.ref,
            additions: r.data.additions,
            deletions: r.data.deletions,
            changed_files: r.data.changed_files,
            mergeable: r.data.mergeable,
            labels: r.data.labels?.map((l: any) => l.name) || [],
          },
        };
      }

      case 'list_issues': {
        if (!params.owner || !params.repo) return { success: false, error: 'list_issues requires: owner, repo' };
        const state = params.state || 'open';
        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues?state=${state}&per_page=${params.limit || 30}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        // Filter out pull requests (GitHub includes PRs in issues endpoint)
        const issues = (r.data as any[]).filter((i: any) => !i.pull_request);
        return {
          success: true,
          data: issues.map((i: any) => ({
            number: i.number,
            title: i.title,
            state: i.state,
            user: i.user?.login,
            assignee: i.assignee?.login,
            labels: i.labels?.map((l: any) => ({ name: l.name, color: l.color })) || [],
            created_at: i.created_at,
            updated_at: i.updated_at,
            comments: i.comments,
            html_url: i.html_url,
          })),
        };
      }

      case 'get_issue': {
        if (!params.owner || !params.repo || !params.issue_number) {
          return { success: false, error: 'get_issue requires: owner, repo, issue_number' };
        }
        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues/${params.issue_number}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return {
          success: true,
          data: {
            number: r.data.number,
            title: r.data.title,
            body: r.data.body,
            state: r.data.state,
            user: r.data.user?.login,
            assignee: r.data.assignee?.login,
            labels: r.data.labels?.map((l: any) => ({ name: l.name, color: l.color })) || [],
            created_at: r.data.created_at,
            updated_at: r.data.updated_at,
            comments: r.data.comments,
          },
        };
      }

      case 'search_code': {
        if (!params.query) return { success: false, error: 'search_code requires: query' };
        const q = params.repo ? `${params.query} repo:${params.repo}` : params.query;
        const r = await jsonFetch(
          `${baseUrl}/search/code?q=${encodeURIComponent(q)}&per_page=${params.limit || 20}`,
          { headers },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return {
          success: true,
          data: r.data.items?.map((item: any) => ({
            name: item.name,
            path: item.path,
            repository: item.repository?.full_name,
            html_url: item.html_url,
            score: item.score,
          })),
        };
      }

      default:
        return { success: false, error: `Unknown GitHub read action: ${action}`, statusCode: 400 };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { token, baseUrl } = resolveAuth(creds);
    if (!token) {
      return { success: false, error: 'GitHub credentials missing: token required' };
    }

    const headers = bearerHeaders(token);

    switch (action) {
      case 'create_issue': {
        if (!params.owner || !params.repo || !params.title) {
          return { success: false, error: 'create_issue requires: owner, repo, title' };
        }
        const body: Record<string, any> = { title: params.title };
        if (params.body) body.body = params.body;
        if (params.labels) body.labels = Array.isArray(params.labels) ? params.labels : [params.labels];
        if (params.assignees) body.assignees = Array.isArray(params.assignees) ? params.assignees : [params.assignees];

        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues`,
          { method: 'POST', headers, body: JSON.stringify(body) },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { number: r.data.number, html_url: r.data.html_url } };
      }

      case 'update_issue': {
        if (!params.owner || !params.repo || !params.issue_number) {
          return { success: false, error: 'update_issue requires: owner, repo, issue_number' };
        }
        const body: Record<string, any> = {};
        if (params.title) body.title = params.title;
        if (params.body) body.body = params.body;
        if (params.state) body.state = params.state;
        if (params.labels) body.labels = params.labels;
        if (params.assignees) body.assignees = params.assignees;

        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues/${params.issue_number}`,
          { method: 'PATCH', headers, body: JSON.stringify(body) },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { number: r.data.number, state: r.data.state } };
      }

      case 'close_issue': {
        if (!params.owner || !params.repo || !params.issue_number) {
          return { success: false, error: 'close_issue requires: owner, repo, issue_number' };
        }
        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues/${params.issue_number}`,
          { method: 'PATCH', headers, body: JSON.stringify({ state: 'closed' }) },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { number: r.data.number, state: 'closed' } };
      }

      case 'create_comment': {
        if (!params.owner || !params.repo || !params.issue_number || !params.body) {
          return { success: false, error: 'create_comment requires: owner, repo, issue_number, body' };
        }
        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/issues/${params.issue_number}/comments`,
          { method: 'POST', headers, body: JSON.stringify({ body: params.body }) },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { id: r.data.id, html_url: r.data.html_url } };
      }

      case 'create_pull': {
        if (!params.owner || !params.repo || !params.title || !params.head || !params.base) {
          return { success: false, error: 'create_pull requires: owner, repo, title, head, base' };
        }
        const body: Record<string, any> = { title: params.title, head: params.head, base: params.base };
        if (params.body) body.body = params.body;
        if (params.draft != null) body.draft = params.draft;

        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/pulls`,
          { method: 'POST', headers, body: JSON.stringify(body) },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { number: r.data.number, html_url: r.data.html_url } };
      }

      case 'merge_pull': {
        if (!params.owner || !params.repo || !params.pull_number) {
          return { success: false, error: 'merge_pull requires: owner, repo, pull_number' };
        }
        const body: Record<string, any> = {};
        if (params.commit_title) body.commit_title = params.commit_title;
        if (params.merge_method) body.merge_method = params.merge_method; // merge | squash | rebase

        const r = await jsonFetch(
          `${baseUrl}/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.repo)}/pulls/${params.pull_number}/merge`,
          { method: 'PUT', headers, body: JSON.stringify(body) },
        );
        if (!r.ok) return { success: false, error: r.data?.message || `HTTP ${r.status}`, statusCode: r.status };
        return { success: true, data: { merged: r.data.merged, sha: r.data.sha } };
      }

      default:
        return { success: false, error: `Unknown GitHub write action: ${action}`, statusCode: 400 };
    }
  },
};

registerAdapter(githubAdapter);
