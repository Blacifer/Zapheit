// ---------------------------------------------------------------------------
// Zoho People Connector Adapter
//
// Full ConnectorAdapter for Zoho People (HR suite).
// Reads: list_employees, get_employee, list_leave_requests, list_attendance, list_departments
// Writes: create_employee, update_employee, approve_leave, reject_leave, mark_attendance, add_note
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
  const token = creds.token || creds.access_token;
  const baseUrl = (creds.baseUrl || creds.base_url || 'https://people.zoho.com').replace(/\/+$/, '');
  return { token, baseUrl };
}

const zohoAdapter: ConnectorAdapter = {
  connectorId: 'zoho-people',
  displayName: 'Zoho People',
  requiredCredentials: ['token'],

  validateCredentials(creds) {
    const { token } = resolveAuth(creds);
    const missing: string[] = [];
    if (!token) missing.push('token');
    return { valid: missing.length === 0, missing };
  },

  async testConnection(creds): Promise<HealthResult> {
    const { token, baseUrl } = resolveAuth(creds);
    if (!token) return { healthy: false, error: 'Missing required credential: token' };
    const start = Date.now();
    try {
      const headers = bearerHeaders(token);
      const r = await jsonFetch(`${baseUrl}/people/api/forms`, { headers });
      const latencyMs = Date.now() - start;
      if (!r.ok) return { healthy: false, latencyMs, error: r.data?.errors?.message || `HTTP ${r.status}` };
      return { healthy: true, latencyMs, accountLabel: 'Zoho People' };
    } catch (err: any) {
      return { healthy: false, latencyMs: Date.now() - start, error: err.message };
    }
  },

  async executeRead(action, params, creds): Promise<ActionResult> {
    const { token, baseUrl } = resolveAuth(creds);
    const headers = bearerHeaders(token);

    switch (action) {
      case 'list_employees': {
        const limit = params.limit || 50;
        const r = await jsonFetch(`${baseUrl}/people/api/forms/employee/getRecords?sIndex=1&limit=${limit}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.response?.result || [] };
      }
      case 'get_employee': {
        const id = params.employeeId || params.id;
        if (!id) return { success: false, error: 'employeeId is required' };
        const r = await jsonFetch(`${baseUrl}/people/api/forms/employee/getDataByID?recordId=${id}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.response?.result || r.data };
      }
      case 'list_leave_requests': {
        const r = await jsonFetch(`${baseUrl}/people/api/leave/getLeaveRecords?sIndex=1&limit=${params.limit || 50}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.response?.result || [] };
      }
      case 'list_attendance': {
        const date = params.date || new Date().toISOString().split('T')[0];
        const r = await jsonFetch(`${baseUrl}/people/api/attendance/getAttendanceEntries?date=${date}&sIndex=1&limit=${params.limit || 100}`, { headers });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.response?.result || [] };
      }
      case 'list_departments': {
        const r = await jsonFetch(`${baseUrl}/people/api/forms/department/getRecords?sIndex=1&limit=100`, { headers });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.response?.result || [] };
      }
      default:
        return { success: false, error: `Unknown read action: ${action}` };
    }
  },

  async executeWrite(action, params, creds): Promise<ActionResult> {
    const { token, baseUrl } = resolveAuth(creds);
    const headers = bearerHeaders(token);

    switch (action) {
      case 'create_employee': {
        if (!params.firstName || !params.lastName || !params.email) {
          return { success: false, error: 'firstName, lastName, email are required' };
        }
        const inputData = JSON.stringify({
          First_Name: params.firstName,
          Last_Name: params.lastName,
          EmailID: params.email,
          Department: params.department || '',
          Designation: params.designation || '',
          Date_of_joining: params.joinDate || new Date().toISOString().split('T')[0],
        });
        const r = await jsonFetch(`${baseUrl}/people/api/forms/employee/insertRecord?inputData=${encodeURIComponent(inputData)}`, {
          method: 'POST', headers,
        });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.response?.result || r.data };
      }
      case 'update_employee': {
        const id = params.employeeId || params.id;
        if (!id) return { success: false, error: 'employeeId is required' };
        const { employeeId: _eid, id: _id, ...fields } = params;
        const inputData = JSON.stringify(fields);
        const r = await jsonFetch(`${baseUrl}/people/api/forms/employee/updateRecord?recordId=${id}&inputData=${encodeURIComponent(inputData)}`, {
          method: 'POST', headers,
        });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data?.response?.result || r.data };
      }
      case 'approve_leave': {
        const id = params.leaveId || params.id;
        if (!id) return { success: false, error: 'leaveId is required' };
        const r = await jsonFetch(`${baseUrl}/people/api/leave/approveLeave?recordId=${id}`, { method: 'POST', headers });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'reject_leave': {
        const id = params.leaveId || params.id;
        if (!id) return { success: false, error: 'leaveId is required' };
        const r = await jsonFetch(`${baseUrl}/people/api/leave/rejectLeave?recordId=${id}`, { method: 'POST', headers });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'mark_attendance': {
        const empId = params.employeeId;
        const checkIn = params.checkIn;
        if (!empId || !checkIn) return { success: false, error: 'employeeId and checkIn are required' };
        const r = await jsonFetch(`${baseUrl}/people/api/attendance/checkin?empId=${empId}&checkIn=${encodeURIComponent(checkIn)}${params.checkOut ? `&checkOut=${encodeURIComponent(params.checkOut)}` : ''}`, {
          method: 'POST', headers,
        });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      case 'add_note': {
        const empId = params.employeeId || params.id;
        const note = params.note || params.body || params.content;
        if (!empId || !note) return { success: false, error: 'employeeId and note are required' };
        const inputData = JSON.stringify({ Note: note, Employee_ID: empId });
        const r = await jsonFetch(`${baseUrl}/people/api/forms/employee/insertRecord?inputData=${encodeURIComponent(inputData)}`, {
          method: 'POST', headers,
        });
        if (!r.ok) return { success: false, error: r.data?.errors?.message || `HTTP ${r.status}` };
        return { success: true, data: r.data };
      }
      default:
        return { success: false, error: `Unknown write action: ${action}` };
    }
  },
};

registerAdapter(zohoAdapter);
