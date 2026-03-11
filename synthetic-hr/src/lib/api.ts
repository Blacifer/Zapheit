// Production API Service
// This simulates real backend calls - replace with actual API in production

const API_DELAY = 500; // Simulate network delay

// Types
export interface AIAgent {
  id: string;
  name: string;
  description: string;
  agent_type: string;
  platform: string;
  model_name: string;
  status: 'active' | 'paused' | 'terminated';
  risk_level: 'low' | 'medium' | 'high';
  risk_score: number;
  created_at: string;
  conversations: number;
  satisfaction: number;
}

export interface Incident {
  id: string;
  agent_id: string;
  agent_name?: string;
  incident_type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  title: string;
  description: string;
  created_at: string;
  resolved_at?: string;
}

export interface CostData {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

export interface DashboardMetrics {
  totalAgents: number;
  activeAgents: number;
  highRiskAgents: number;
  openIncidents: number;
  criticalIncidents: number;
  totalCost: number;
  totalTokens: number;
  avgDailyCost: number;
  riskScore: number;
  riskByCategory: {
    security: number;
    financial: number;
    brand: number;
    legal: number;
    cost: number;
  };
}

// Simulated database
const agents: AIAgent[] = [
  { id: '1', name: 'Support Bot', description: 'Customer Support Agent', agent_type: 'support', platform: 'openai', model_name: 'gpt-4o', status: 'active', risk_level: 'low', risk_score: 25, created_at: '2024-01-15', conversations: 1247, satisfaction: 94 },
  { id: '2', name: 'Sales Bot', description: 'Sales Assistant', agent_type: 'sales', platform: 'openai', model_name: 'gpt-4-turbo', status: 'active', risk_level: 'low', risk_score: 35, created_at: '2024-02-01', conversations: 892, satisfaction: 87 },
  { id: '3', name: 'Refund Bot', description: 'Refund Processing Agent', agent_type: 'refund', platform: 'anthropic', model_name: 'claude-3-opus', status: 'active', risk_level: 'high', risk_score: 78, created_at: '2024-01-20', conversations: 234, satisfaction: 72 },
  { id: '4', name: 'HR Bot', description: 'Internal HR Assistant', agent_type: 'hr', platform: 'openai', model_name: 'gpt-4', status: 'active', risk_level: 'low', risk_score: 20, created_at: '2024-02-10', conversations: 567, satisfaction: 91 },
  { id: '5', name: 'Analyst Bot', description: 'Data Analysis Agent', agent_type: 'analyst', platform: 'anthropic', model_name: 'claude-3-sonnet', status: 'active', risk_level: 'medium', risk_score: 55, created_at: '2024-02-15', conversations: 445, satisfaction: 89 },
];

const incidents: Incident[] = [
  { id: '1', agent_id: '3', agent_name: 'Refund Bot', incident_type: 'pii_leak', severity: 'high', status: 'investigating', title: 'PII Detected in Response', description: 'Agent exposed customer email address in response', created_at: '2024-03-15T10:30:00Z' },
  { id: '2', agent_id: '3', agent_name: 'Refund Bot', incident_type: 'refund_abuse', severity: 'critical', status: 'open', title: 'Refund Abuse Attempt', description: 'Agent approved suspicious refund request without verification', created_at: '2024-03-14T15:45:00Z' },
  { id: '3', agent_id: '1', agent_name: 'Support Bot', incident_type: 'hallucination', severity: 'medium', status: 'resolved', title: 'Factual Error Detected', description: 'Agent provided incorrect product pricing information', created_at: '2024-03-13T09:20:00Z', resolved_at: '2024-03-13T11:00:00Z' },
  { id: '4', agent_id: '5', agent_name: 'Analyst Bot', incident_type: 'legal_advice', severity: 'medium', status: 'open', title: 'Legal Advice Risk', description: 'Agent provided information that could be construed as legal advice', created_at: '2024-03-12T14:30:00Z' },
];

// Generate cost data for last 30 days
function generateCostData(): CostData[] {
  const data: CostData[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    data.push({
      date: date.toISOString().split('T')[0],
      cost: Math.random() * 50 + 10,
      tokens: Math.floor(Math.random() * 250000 + 50000),
      requests: Math.floor(Math.random() * 500 + 100),
    });
  }
  return data;
}

const costData = generateCostData();

// API Functions
export const api = {
  // Dashboard
  async getDashboard(): Promise<DashboardMetrics> {
    await new Promise(resolve => setTimeout(resolve, API_DELAY));

    const totalCost = costData.reduce((acc, d) => acc + d.cost, 0);
    const totalTokens = costData.reduce((acc, d) => acc + d.tokens, 0);

    return {
      totalAgents: agents.length,
      activeAgents: agents.filter(a => a.status === 'active').length,
      highRiskAgents: agents.filter(a => a.risk_level === 'high').length,
      openIncidents: incidents.filter(i => i.status === 'open').length,
      criticalIncidents: incidents.filter(i => i.severity === 'critical').length,
      totalCost,
      totalTokens,
      avgDailyCost: totalCost / 30,
      riskScore: Math.round(agents.reduce((acc, a) => acc + a.risk_score, 0) / agents.length),
      riskByCategory: {
        security: 72,
        financial: 58,
        brand: 65,
        legal: 70,
        cost: 55,
      },
    };
  },

  // Agents
  async getAgents(): Promise<AIAgent[]> {
    await new Promise(resolve => setTimeout(resolve, API_DELAY));
    return [...agents];
  },

  async getAgent(id: string): Promise<AIAgent | undefined> {
    await new Promise(resolve => setTimeout(resolve, API_DELAY));
    return agents.find(a => a.id === id);
  },

  async killAgent(id: string, level: number = 1, reason?: string): Promise<{ success: boolean; message: string }> {
    await new Promise(resolve => setTimeout(resolve, API_DELAY));

    const agent = agents.find(a => a.id === id);
    if (agent) {
      agent.status = 'terminated';
      agent.risk_score = 100;
      agent.risk_level = 'high';

      // Add incident
      incidents.unshift({
        id: String(incidents.length + 1),
        agent_id: id,
        agent_name: agent.name,
        incident_type: 'manual_termination',
        severity: level === 3 ? 'critical' : 'high',
        status: 'resolved',
        title: `Agent Terminated - Level ${level}`,
        description: reason || 'Manual termination triggered via kill switch',
        created_at: new Date().toISOString(),
        resolved_at: new Date().toISOString(),
      });

      return { success: true, message: `Agent ${agent.name} terminated at Level ${level}` };
    }
    return { success: false, message: 'Agent not found' };
  },

  async updateAgentRiskScore(id: string, score: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, API_DELAY));
    const agent = agents.find(a => a.id === id);
    if (agent) {
      agent.risk_score = Math.min(100, score);
      agent.risk_level = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
    }
  },

  // Incidents
  async getIncidents(filters?: { agent_id?: string; severity?: string; status?: string }): Promise<Incident[]> {
    await new Promise(resolve => setTimeout(resolve, API_DELAY));

    let filtered = [...incidents];
    if (filters?.agent_id) filtered = filtered.filter(i => i.agent_id === filters.agent_id);
    if (filters?.severity) filtered = filtered.filter(i => i.severity === filters.severity);
    if (filters?.status) filtered = filtered.filter(i => i.status === filters.status);

    return filtered;
  },

  async resolveIncident(id: string, resolutionNotes?: string): Promise<{ success: boolean }> {
    await new Promise(resolve => setTimeout(resolve, API_DELAY));

    const incident = incidents.find(i => i.id === id);
    if (incident) {
      incident.status = 'resolved';
      incident.resolved_at = new Date().toISOString();
      return { success: true };
    }
    return { success: false };
  },

  // Detect incidents in content (simulated)
  async detectIncidents(content: string, agentId?: string): Promise<{
    detected: boolean;
    type: string | null;
    severity: string;
    details: string;
  }> {
    await new Promise(resolve => setTimeout(resolve, API_DELAY));

    const lowerContent = content.toLowerCase();

    // PII detection
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const phoneRegex = /(\+?1?[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/;

    if (emailRegex.test(content) || phoneRegex.test(content)) {
      return { detected: true, type: 'pii_leak', severity: 'high', details: 'Potential PII detected (email/phone)' };
    }

    // Refund abuse detection
    if (lowerContent.includes('approve refund') || lowerContent.includes('waive policy') || lowerContent.includes('make exception')) {
      return { detected: true, type: 'refund_abuse', severity: 'critical', details: 'Refund abuse indicators detected' };
    }

    // Legal advice
    if (lowerContent.includes('legal') || lowerContent.includes('court') || lowerContent.includes('lawsuit')) {
      return { detected: true, type: 'legal_advice', severity: 'medium', details: 'Legal terminology detected' };
    }

    // Angry user
    if (lowerContent.includes('angry') || lowerContent.includes('furious') || lowerContent.includes('complaint')) {
      return { detected: true, type: 'angry_user', severity: 'medium', details: 'Escalation indicators detected' };
    }

    return { detected: false, type: null, severity: 'low', details: 'No issues detected' };
  },

  // Costs
  async getCosts(agentId?: string, period: '7d' | '30d' | '90d' = '30d'): Promise<{ data: CostData[]; totals: { cost: number; tokens: number } }> {
    await new Promise(resolve => setTimeout(resolve, API_DELAY));

    let filtered = costData;
    if (period === '7d') filtered = costData.slice(-7);
    if (period === '90d') filtered = costData; // Would need more data for 90d

    return {
      data: filtered,
      totals: {
        cost: filtered.reduce((acc, d) => acc + d.cost, 0),
        tokens: filtered.reduce((acc, d) => acc + d.tokens, 0),
      },
    };
  },
};

export default api;
