import type { IntegrationSpec } from './spec-types';

const API_CALLBACK_BASE = '/api/integrations/oauth/callback';

const INTERNAL_INTEGRATION: IntegrationSpec = {
  id: 'internal',
  name: 'SyntheticHR (Built-in)',
  category: 'OTHER',
  description: 'Built-in work items and safe actions inside SyntheticHR. No external credentials required.',
  // Kept as api_key for compatibility; UI/API special-case this to show as connected without configuration.
  authType: 'api_key',
  tags: ['BUILTIN', 'INTERNAL'],
  status: 'READY',
  color: '#64748B',
  priority: 0,
  endpoints: {},
  capabilities: {
    reads: [],
    writes: [
      { id: 'support.ticket.create', label: 'Create support ticket (internal)', risk: 'medium', pack: 'support' },
      { id: 'support.ticket.update_status', label: 'Update ticket status (internal)', risk: 'low', pack: 'support' },
      { id: 'sales.lead.create', label: 'Create sales lead (internal)', risk: 'medium', pack: 'sales' },
      { id: 'sales.lead.update_stage', label: 'Update lead stage (internal)', risk: 'low', pack: 'sales' },
      { id: 'it.access_request.create', label: 'Create access request (internal)', risk: 'high', pack: 'it' },
      { id: 'it.access_request.decide', label: 'Approve/deny access request (internal)', risk: 'high', pack: 'it' },
    ],
  },
  notes: 'These actions create records inside SyntheticHR and run through Jobs & Approvals via connector_action.',
};

export const PHASE1_INTEGRATIONS: IntegrationSpec[] = [
  {
    id: 'naukri',
    name: 'Naukri.com',
    category: 'RECRUITMENT',
    description: "India's largest job portal. Resume matching, candidate scoring, and job posting automation.",
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'RECRUITMENT', 'AI-READY'],
    status: 'READY',
    color: '#4A90D9',
    priority: 1,
    apiKeyConfig: {
      requiredFields: [
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Enter Naukri API Key', required: true, description: 'Partner API key from Naukri' },
        { name: 'client_id', label: 'Client ID', type: 'text', placeholder: 'Enter Client ID', required: true, description: 'Client identifier' },
        { name: 'employer_id', label: 'Employer ID', type: 'text', placeholder: 'Enter Employer ID', required: true, description: 'Your employer account ID' },
      ],
      testEndpoint: 'https://api.naukri.com/v1/jobs?limit=1',
      baseUrl: 'https://api.naukri.com/v1',
    },
    endpoints: {
      jobs: { method: 'GET', path: '/jobs' },
      createJob: { method: 'POST', path: '/jobs' },
      searchCandidates: { method: 'GET', path: '/candidates/search' },
      getCandidate: { method: 'GET', path: '/candidates/{id}' },
      parseResume: { method: 'POST', path: '/candidates/parse' },
    },
    capabilities: {
      reads: ['candidate_profiles', 'job_descriptions'],
      writes: [],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['resume_matching', 'candidate_scoring', 'skill_extraction'],
      dataTypes: ['resumes', 'job_descriptions', 'candidate_profiles'],
    },
  },
  {
    id: 'cleartax',
    name: 'ClearTax',
    category: 'COMPLIANCE',
    description: "India's tax & compliance platform. TDS calculation, GST filing, and compliance monitoring.",
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'COMPLIANCE', 'AI-READY'],
    status: 'READY',
    color: '#00A651',
    priority: 1,
    apiKeyConfig: {
      requiredFields: [
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Enter ClearTax API Key', required: true, description: 'From ClearTax developer dashboard' },
        { name: 'gstin', label: 'Company GSTIN', type: 'text', placeholder: '22AAAAA0000A1Z5', required: true, description: 'Company GST number' },
        { name: 'pan', label: 'Company PAN', type: 'text', placeholder: 'AAAAA0000A', required: true, description: 'Company PAN number' },
      ],
      testEndpoint: 'https://api.cleartax.in/v1/compliance/status',
      baseUrl: 'https://api.cleartax.in/v1',
    },
    endpoints: {
      complianceStatus: { method: 'GET', path: '/compliance/status' },
      calculateTDS: { method: 'POST', path: '/tds/calculate' },
      taxRules: { method: 'GET', path: '/tax/rules' },
      gstReturns: { method: 'POST', path: '/gst/returns' },
      notices: { method: 'GET', path: '/notices' },
    },
    capabilities: {
      reads: ['compliance.tax_rules', 'compliance.status', 'compliance.notices'],
      writes: [
        { id: 'compliance.gst.file', label: 'File GST return', risk: 'high' },
        { id: 'compliance.tds.calculate', label: 'Calculate TDS', risk: 'medium' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['compliance_monitoring', 'tax_calculation', 'deadline_prediction', 'anomaly_detection'],
      dataTypes: ['tax_rules', 'compliance_status', 'filings'],
    },
  },
  {
    id: 'zoho_people',
    name: 'Zoho People',
    category: 'HRMS',
    description: 'Zoho HRMS. Attrition prediction, workforce analytics, and employee lifecycle telemetry.',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'HRMS', 'AI-READY'],
    status: 'READY',
    color: '#D97706',
    priority: 1,
    oauthConfig: {
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes: ['ZohoPeople.employee.ALL', 'ZohoPeople.forms.READ'],
      redirectPath: `${API_CALLBACK_BASE}/zoho_people`,
    },
    endpoints: {
      employees: { method: 'GET', path: '/employees' },
      employee: { method: 'GET', path: '/employees/{id}' },
      attendance: { method: 'GET', path: '/attendance' },
      leave: { method: 'GET', path: '/leave' },
      performance: { method: 'GET', path: '/performance' },
    },
    capabilities: {
      reads: ['hr.employees', 'hr.attendance', 'hr.leaves', 'hr.performance'],
      writes: [
        { id: 'hr.employee.update', label: 'Update employee record', risk: 'medium' },
        { id: 'hr.leave.approve', label: 'Approve leave request', risk: 'medium' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['attrition_prediction', 'performance_prediction', 'workforce_analytics', 'anomaly_detection'],
      dataTypes: ['employees', 'attendance', 'leave', 'performance'],
    },
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    category: 'RECRUITMENT',
    description: 'Talent intelligence, skill mapping, and professional network analysis.',
    authType: 'oauth2',
    tags: ['GLOBAL', 'RECRUITMENT', 'AI-READY'],
    status: 'READY',
    color: '#0A66C2',
    priority: 1,
    oauthConfig: {
      authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      scopes: ['openid', 'profile', 'email'],
      redirectPath: `${API_CALLBACK_BASE}/linkedin`,
    },
    endpoints: {
      profile: { method: 'GET', path: '/me' },
      person: { method: 'GET', path: '/people/{id}' },
      search: { method: 'GET', path: '/people/search' },
      skills: { method: 'GET', path: '/skills' },
      share: { method: 'POST', path: '/shares' },
    },
    capabilities: {
      reads: ['candidate_profiles_lite'],
      writes: [],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['talent_intelligence', 'skill_mapping', 'network_analysis', 'career_trajectory'],
      dataTypes: ['profiles', 'skills', 'endorsements', 'connections'],
    },
  },
  {
    id: 'tally',
    name: 'Tally.ERP',
    category: 'FINANCE',
    description: "India's most popular accounting software. Expense analytics and HR spend insights.",
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'FINANCE', 'AI-READY'],
    status: 'READY',
    color: '#2E86AB',
    priority: 1,
    apiKeyConfig: {
      requiredFields: [
        { name: 'company_name', label: 'Company Name', type: 'text', placeholder: 'My Company', required: true, description: 'Tally company name' },
        { name: 'server_url', label: 'Server URL', type: 'text', placeholder: 'http://localhost:9000', required: true, description: 'Tally server URL' },
        { name: 'username', label: 'Username', type: 'text', placeholder: 'Admin', required: false, description: 'Optional username' },
        { name: 'password', label: 'Password', type: 'password', placeholder: '••••••••', required: false, description: 'Optional password' },
      ],
      testEndpoint: '/companies',
      baseUrl: '',
    },
    endpoints: {
      companies: { method: 'GET', path: '/companies', format: 'xml' },
      ledgers: { method: 'GET', path: '/ledgers', format: 'xml' },
      vouchers: { method: 'GET', path: '/vouchers', format: 'xml' },
      stockItems: { method: 'GET', path: '/stockitems', format: 'xml' },
      postVoucher: { method: 'POST', path: '/vouchers', format: 'xml' },
    },
    capabilities: {
      reads: ['finance.ledgers', 'finance.vouchers', 'finance.transactions'],
      writes: [
        { id: 'finance.voucher.post', label: 'Post voucher / journal entry', risk: 'money' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['expense_analytics', 'budget_prediction', 'anomaly_detection', 'trend_analysis'],
      dataTypes: ['ledgers', 'vouchers', 'transactions'],
    },
    notes: 'Tally uses an XML-style API and is usually reachable only inside the customer network.',
  },
];

export const PHASE2_INTEGRATIONS: IntegrationSpec[] = [
  {
    id: 'greythr',
    name: 'Greythr',
    category: 'HRMS',
    description: "India's leading HRMS for SMEs. Workforce planning, attendance automation, and payroll telemetry.",
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'HRMS', 'SME FOCUS', 'AI-READY'],
    status: 'READY',
    color: '#6366F1',
    priority: 2,
    apiKeyConfig: {
      requiredFields: [
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Enter Greythr API Key', required: true, description: 'From Greythr admin settings' },
        { name: 'company_id', label: 'Company ID', type: 'text', placeholder: 'Enter Company ID', required: true, description: 'Company identifier' },
        { name: 'subdomain', label: 'Subdomain', type: 'text', placeholder: 'company.greythr.com', required: true, description: 'Company subdomain' },
      ],
      testEndpoint: 'https://api.greythr.com/v2/employees',
      baseUrl: 'https://api.greythr.com/v2',
    },
    endpoints: {
      employees: { method: 'GET', path: '/employees' },
      employee: { method: 'GET', path: '/employees/{id}' },
      attendance: { method: 'GET', path: '/attendance' },
      leaves: { method: 'GET', path: '/leaves' },
      payroll: { method: 'GET', path: '/payroll' },
    },
    capabilities: {
      reads: ['hr.employees', 'hr.attendance', 'hr.leaves', 'hr.payroll'],
      writes: [
        { id: 'hr.leave.approve', label: 'Approve leave request', risk: 'medium' },
        { id: 'hr.attendance.update', label: 'Update attendance record', risk: 'low' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['workforce_planning', 'attendance_analytics', 'leave_prediction', 'payroll_anomaly'],
      dataTypes: ['employees', 'attendance', 'leaves', 'payroll'],
    },
  },
  {
    id: 'zoho_recruit',
    name: 'Zoho Recruit',
    category: 'ATS',
    description: 'Applicant tracking with resume parsing, pipeline management, and hiring analytics.',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'ATS', 'AI-READY'],
    status: 'READY',
    color: '#DC2626',
    priority: 2,
    oauthConfig: {
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes: ['ZohoRecruit.modules.ALL', 'offline_access'],
      redirectPath: `${API_CALLBACK_BASE}/zoho_recruit`,
    },
    endpoints: {
      candidates: { method: 'GET', path: '/Candidates' },
      createCandidate: { method: 'POST', path: '/Candidates' },
      jobOpenings: { method: 'GET', path: '/JobOpenings' },
      createJob: { method: 'POST', path: '/JobOpenings' },
      parseResume: { method: 'POST', path: '/parse/resume' },
    },
    capabilities: {
      reads: ['recruitment.candidates', 'recruitment.jobs', 'recruitment.applications'],
      writes: [
        { id: 'recruitment.candidate.create', label: 'Create candidate record', risk: 'low' },
        { id: 'recruitment.job.create', label: 'Create job opening', risk: 'medium' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['resume_parsing', 'candidate_matching', 'pipeline_analytics', 'hiring_prediction'],
      dataTypes: ['candidates', 'jobs', 'applications', 'interviews'],
    },
  },
  {
    id: 'apna',
    name: 'Apna',
    category: 'RECRUITMENT',
    description: "India's largest professional network for blue-collar workers. Mass recruitment telemetry.",
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'BLUE-COLLAR', 'AI-READY'],
    status: 'READY',
    color: '#F59E0B',
    priority: 2,
    apiKeyConfig: {
      requiredFields: [
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Enter Apna API Key', required: true, description: 'Partner API key from Apna' },
        { name: 'employer_id', label: 'Employer ID', type: 'text', placeholder: 'Enter Employer ID', required: true, description: 'Your employer ID' },
      ],
      testEndpoint: 'https://api.apna.co/v1/jobs',
      baseUrl: 'https://api.apna.co/v1',
    },
    endpoints: {
      jobs: { method: 'GET', path: '/jobs' },
      createJob: { method: 'POST', path: '/jobs' },
      candidates: { method: 'GET', path: '/candidates' },
      candidateProfile: { method: 'GET', path: '/candidates/{id}/profile' },
    },
    capabilities: {
      reads: ['recruitment.candidates', 'recruitment.jobs'],
      writes: [],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['candidate_matching', 'skill_assessment', 'mass_recruitment', 'availability_prediction'],
      dataTypes: ['candidate_profiles', 'job_preferences', 'applications'],
    },
  },
  {
    id: 'aadhaar',
    name: 'Aadhaar API',
    category: 'IDENTITY',
    description: 'UIDAI Aadhaar authentication and KYC verification. Use a sandbox for testing.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'KYC', 'GOVERNMENT', 'AI-READY'],
    status: 'READY',
    color: '#059669',
    priority: 2,
    apiKeyConfig: {
      requiredFields: [
        { name: 'license_key', label: 'License Key', type: 'password', placeholder: 'Enter UIDAI License Key', required: true, description: 'UIDAI license key' },
        { name: 'aua_code', label: 'AUA Code', type: 'text', placeholder: 'Enter AUA Code', required: true, description: 'Authentication User Agency code' },
        { name: 'sub_aua_code', label: 'Sub-AUA Code', type: 'text', placeholder: 'Enter Sub-AUA Code', required: true, description: 'Sub-AUA code' },
      ],
      testEndpoint: 'https://api.uidai.gov.in/v1/status',
      baseUrl: 'https://api.uidai.gov.in/v1',
    },
    endpoints: {
      auth: { method: 'POST', path: '/auth' },
      eKyc: { method: 'POST', path: '/e-kyc' },
      otp: { method: 'POST', path: '/otp' },
      status: { method: 'GET', path: '/status' },
    },
    capabilities: {
      reads: ['identity.kyc'],
      writes: [
        { id: 'identity.kyc.verify', label: 'Verify Aadhaar (eKYC)', risk: 'high' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['identity_verification', 'face_matching', 'address_verification', 'fraud_detection'],
      dataTypes: ['identity_data', 'demographics', 'photos'],
    },
    notes: 'Requires UIDAI registration and compliance. Use sandbox for testing.',
  },
];

export const PHASE3_INTEGRATIONS: IntegrationSpec[] = [
  {
    id: 'digilocker',
    name: 'DigiLocker',
    category: 'DOCUMENTS',
    description: 'Government digital locker. Document processing, verification, and AI-ready evidence intake.',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'DOCUMENTS', 'GOVERNMENT', 'AI-READY'],
    status: 'READY',
    color: '#0284C7',
    priority: 3,
    oauthConfig: {
      authorizationUrl: 'https://api.digitallocker.gov.in/oauth2/authorize',
      tokenUrl: 'https://api.digitallocker.gov.in/oauth2/token',
      scopes: ['file_fetch', 'file_upload'],
      redirectPath: `${API_CALLBACK_BASE}/digilocker`,
    },
    endpoints: {
      files: { method: 'GET', path: '/files' },
      file: { method: 'GET', path: '/files/{id}' },
      certificates: { method: 'GET', path: '/certificates' },
      verify: { method: 'POST', path: '/verify' },
    },
    capabilities: {
      reads: ['documents.files', 'documents.certificates'],
      writes: [
        { id: 'documents.certificate.verify', label: 'Verify certificate', risk: 'medium' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['document_processing', 'certificate_verification', 'ocr', 'fraud_detection'],
      dataTypes: ['documents', 'certificates', 'identity_proofs'],
    },
  },
  {
    id: 'idfy',
    name: 'IDfy',
    category: 'BGV',
    description: 'Background verification. Employment, education, and identity verification automation.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'BGV', 'AI-READY'],
    status: 'READY',
    color: '#7C3AED',
    priority: 3,
    apiKeyConfig: {
      requiredFields: [
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Enter IDfy API Key', required: true, description: 'API key from IDfy dashboard' },
        { name: 'account_id', label: 'Account ID', type: 'text', placeholder: 'Enter Account ID', required: true, description: 'Account identifier' },
      ],
      testEndpoint: 'https://api.idfy.com/v3/status',
      baseUrl: 'https://api.idfy.com/v3',
    },
    endpoints: {
      identityCheck: { method: 'POST', path: '/verification/identity' },
      employmentCheck: { method: 'POST', path: '/verification/employment' },
      educationCheck: { method: 'POST', path: '/verification/education' },
      criminalCheck: { method: 'POST', path: '/verification/criminal' },
      status: { method: 'GET', path: '/verification/{id}/status' },
    },
    capabilities: {
      reads: ['hr.bgv_status'],
      writes: [
        { id: 'hr.bgv.initiate', label: 'Initiate background verification', risk: 'high' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['risk_scoring', 'verification_automation', 'fraud_detection', 'pattern_analysis'],
      dataTypes: ['verification_status', 'risk_scores', 'reports'],
    },
  },
  {
    id: 'zoho_learn',
    name: 'Zoho Learn',
    category: 'LMS',
    description: 'Learning management from Zoho. Skill recommendations, learning paths, and certification tracking.',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'LMS', 'AI-READY'],
    status: 'READY',
    color: '#EA580C',
    priority: 3,
    oauthConfig: {
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes: ['ZohoLearn.course.READ', 'ZohoLearn.course.ALL', 'offline_access'],
      redirectPath: `${API_CALLBACK_BASE}/zoho_learn`,
    },
    endpoints: {
      courses: { method: 'GET', path: '/courses' },
      course: { method: 'GET', path: '/courses/{id}' },
      learners: { method: 'GET', path: '/learners' },
      skills: { method: 'GET', path: '/skills' },
      recommendations: { method: 'POST', path: '/recommendations' },
    },
    capabilities: {
      reads: ['lms.courses', 'lms.learner_progress', 'lms.skills'],
      writes: [
        { id: 'lms.course.assign', label: 'Assign course to employee', risk: 'low' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['skill_gap_analysis', 'course_recommendations', 'learning_path', 'certification_tracking'],
      dataTypes: ['courses', 'skills', 'progress', 'certifications'],
    },
  },
  {
    id: 'paytm',
    name: 'Paytm Business',
    category: 'PAYMENTS',
    description: 'Payment gateway in India. Payment analytics, salary disbursement tracking, and payout telemetry.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'PAYMENTS', 'AI-READY'],
    status: 'READY',
    color: '#00B9F5',
    priority: 3,
    apiKeyConfig: {
      requiredFields: [
        { name: 'merchant_id', label: 'Merchant ID', type: 'text', placeholder: 'Enter Merchant ID', required: true, description: 'Paytm merchant ID' },
        { name: 'merchant_key', label: 'Merchant Key', type: 'password', placeholder: 'Enter Merchant Key', required: true, description: 'Merchant key from dashboard' },
        { name: 'channel_id', label: 'Channel ID', type: 'text', placeholder: 'Enter Channel ID', required: true, description: 'Channel identifier' },
      ],
      testEndpoint: 'https://api.paytm.com/v1/merchant/status',
      baseUrl: 'https://api.paytm.com/v1',
    },
    endpoints: {
      createPayment: { method: 'POST', path: '/payments' },
      paymentStatus: { method: 'GET', path: '/payments/{id}' },
      transactions: { method: 'GET', path: '/transactions' },
      payouts: { method: 'POST', path: '/payouts' },
      refunds: { method: 'GET', path: '/refunds' },
    },
    capabilities: {
      reads: ['finance.transactions', 'finance.refunds', 'finance.payouts'],
      writes: [
        { id: 'finance.refund.create', label: 'Create refund', risk: 'money' },
        { id: 'finance.payout.initiate', label: 'Initiate payout', risk: 'money' },
      ],
    },
    aiFeatures: {
      enabled: true,
      capabilities: ['payment_analytics', 'fraud_detection', 'payout_automation', 'expense_tracking'],
      dataTypes: ['transactions', 'payouts', 'refunds'],
    },
  },
];

export const PHASE4_INTEGRATIONS: IntegrationSpec[] = [
  {
    id: 'zendesk',
    name: 'Zendesk',
    category: 'SUPPORT',
    description: 'Customer support ticketing (read tickets, draft replies, and triage workflows).',
    authType: 'api_key',
    tags: ['SUPPORT', 'GLOBAL'],
    status: 'READY',
    color: '#03363D',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'subdomain', label: 'Subdomain', type: 'text', placeholder: 'yourcompany', required: true, description: 'Zendesk subdomain (yourcompany.zendesk.com)' },
        { name: 'email', label: 'Email', type: 'text', placeholder: 'agent@company.com', required: true, description: 'Agent/admin email' },
        { name: 'api_token', label: 'API Token', type: 'password', placeholder: '••••••••', required: true, description: 'Zendesk API token' },
      ],
      testEndpoint: '/api/v2/users/me.json',
      baseUrl: 'https://{subdomain}.zendesk.com',
    },
    endpoints: {
      me: { method: 'GET', path: 'https://{subdomain}.zendesk.com/api/v2/users/me.json' },
      tickets: { method: 'GET', path: 'https://{subdomain}.zendesk.com/api/v2/tickets.json' },
    },
    capabilities: {
      reads: ['support.tickets'],
      writes: [
        { id: 'support.ticket.reply', label: 'Reply to ticket', risk: 'medium' },
        { id: 'support.ticket.update_status', label: 'Update ticket status', risk: 'low' },
      ],
    },
  },
  {
    id: 'freshdesk',
    name: 'Freshdesk',
    category: 'SUPPORT',
    description: 'Freshdesk ticketing (triage, replies, and SLA workflows).',
    authType: 'api_key',
    tags: ['SUPPORT', 'GLOBAL'],
    status: 'READY',
    color: '#25A7DF',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'domain', label: 'Domain', type: 'text', placeholder: 'yourcompany', required: true, description: 'Freshdesk domain (yourcompany.freshdesk.com)' },
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: '••••••••', required: true, description: 'Freshdesk API key' },
      ],
      testEndpoint: '/api/v2/agents/me',
      baseUrl: 'https://{domain}.freshdesk.com',
    },
    endpoints: {
      me: { method: 'GET', path: 'https://{domain}.freshdesk.com/api/v2/agents/me' },
    },
    capabilities: {
      reads: ['support.tickets'],
      writes: [
        { id: 'support.ticket.reply', label: 'Reply to ticket', risk: 'medium' },
        { id: 'support.ticket.update_status', label: 'Update ticket status', risk: 'low' },
      ],
    },
  },
  {
    id: 'jira',
    name: 'Jira (Atlassian)',
    category: 'ITSM',
    description: 'Issue tracking and Jira Service Management (create/update issues, triage requests).',
    authType: 'api_key',
    tags: ['ITSM', 'GLOBAL'],
    status: 'READY',
    color: '#2684FF',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'base_url', label: 'Base URL', type: 'text', placeholder: 'https://yourdomain.atlassian.net', required: true, description: 'Atlassian cloud base URL' },
        { name: 'email', label: 'Email', type: 'text', placeholder: 'admin@company.com', required: true, description: 'Atlassian account email' },
        { name: 'api_token', label: 'API Token', type: 'password', placeholder: '••••••••', required: true, description: 'Atlassian API token' },
      ],
      testEndpoint: '/rest/api/3/myself',
      baseUrl: '',
    },
    endpoints: {
      myself: { method: 'GET', path: 'https://{base_url}/rest/api/3/myself' },
    },
    capabilities: {
      reads: ['itsm.issues'],
      writes: [
        { id: 'itsm.issue.create', label: 'Create issue', risk: 'medium' },
        { id: 'itsm.issue.update', label: 'Update issue', risk: 'low' },
      ],
    },
  },
  {
    id: 'hubspot',
    name: 'HubSpot',
    category: 'CRM',
    description: 'CRM for leads, contacts, and deals (enrichment and pipeline automation).',
    authType: 'api_key',
    tags: ['CRM', 'GLOBAL'],
    status: 'READY',
    color: '#FF7A59',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'private_app_token', label: 'Private App Token', type: 'password', placeholder: 'pat-...', required: true, description: 'HubSpot private app token' },
      ],
      testEndpoint: 'https://api.hubapi.com/account-info/v3/details',
      baseUrl: 'https://api.hubapi.com',
    },
    endpoints: {
      details: { method: 'GET', path: 'https://api.hubapi.com/account-info/v3/details' },
    },
    capabilities: {
      reads: ['sales.leads', 'sales.contacts', 'sales.deals'],
      writes: [
        { id: 'sales.lead.update', label: 'Update lead/contact', risk: 'low' },
        { id: 'sales.deal.update', label: 'Update deal stage', risk: 'low' },
      ],
    },
  },
  {
    id: 'stripe',
    name: 'Stripe',
    category: 'PAYMENTS',
    description: 'Payments platform (transactions, refunds, and dispute workflows).',
    authType: 'api_key',
    tags: ['PAYMENTS', 'GLOBAL'],
    status: 'READY',
    color: '#635BFF',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'sk_live_...', required: true, description: 'Stripe secret key' },
      ],
      testEndpoint: 'https://api.stripe.com/v1/account',
      baseUrl: 'https://api.stripe.com',
    },
    endpoints: {
      account: { method: 'GET', path: 'https://api.stripe.com/v1/account' },
    },
    capabilities: {
      reads: ['finance.transactions', 'finance.refunds'],
      writes: [
        { id: 'finance.refund.create', label: 'Create refund', risk: 'money' },
      ],
    },
  },
  {
    id: 'razorpay',
    name: 'Razorpay',
    category: 'PAYMENTS',
    description: 'Payments platform in India (transactions and refunds).',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'PAYMENTS'],
    status: 'READY',
    color: '#0C2451',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'key_id', label: 'Key ID', type: 'text', placeholder: 'rzp_live_...', required: true, description: 'Razorpay key id' },
        { name: 'key_secret', label: 'Key Secret', type: 'password', placeholder: '••••••••', required: true, description: 'Razorpay key secret' },
      ],
      testEndpoint: 'https://api.razorpay.com/v1/payments?count=1',
      baseUrl: 'https://api.razorpay.com/v1',
    },
    endpoints: {
      payments: { method: 'GET', path: 'https://api.razorpay.com/v1/payments' },
    },
    capabilities: {
      reads: ['finance.transactions', 'finance.refunds'],
      writes: [
        { id: 'finance.refund.create', label: 'Create refund', risk: 'money' },
      ],
    },
  },
  {
    id: 'google_workspace',
    name: 'Google Workspace',
    category: 'PRODUCTIVITY',
    description: 'Identity + productivity telemetry across Gmail, Drive, Calendar, and Directory.',
    authType: 'oauth2',
    tags: ['GLOBAL', 'SSO', 'PRODUCTIVITY'],
    status: 'READY',
    color: '#4285F4',
    priority: 4,
    oauthConfig: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/admin.directory.user',
      ],
      redirectPath: `${API_CALLBACK_BASE}/google_workspace`,
    },
    endpoints: {
      userinfo: { method: 'GET', path: 'https://www.googleapis.com/oauth2/v3/userinfo' },
    },
    capabilities: {
      reads: ['user_profile'],
      writes: [
        { id: 'outreach.send_email', label: 'Send email (Gmail)', risk: 'medium' },
        { id: 'outreach.create_calendar_event', label: 'Create calendar invite', risk: 'medium' },
      ],
    },
  },
  {
    id: 'microsoft_365',
    name: 'Microsoft 365',
    category: 'PRODUCTIVITY',
    description: 'Identity + productivity telemetry across Outlook, OneDrive, Calendar, and Directory (Microsoft Graph).',
    authType: 'oauth2',
    tags: ['ENTERPRISE', 'SSO', 'PRODUCTIVITY'],
    status: 'READY',
    color: '#D83B01',
    priority: 4,
    oauthConfig: {
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      scopes: [
        'openid',
        'email',
        'profile',
        'offline_access',
        'User.Read',
        'Mail.ReadWrite',
        'Calendars.ReadWrite',
        'Files.ReadWrite.All',
        'Directory.Read.All',
      ],
      redirectPath: `${API_CALLBACK_BASE}/microsoft_365`,
    },
    endpoints: {
      me: { method: 'GET', path: 'https://graph.microsoft.com/v1.0/me' },
    },
    capabilities: {
      reads: ['user_profile'],
      writes: [
        { id: 'outreach.send_email', label: 'Send email (Outlook)', risk: 'medium' },
        { id: 'outreach.create_calendar_event', label: 'Create calendar invite', risk: 'medium' },
      ],
    },
  },
  {
    id: 'keka',
    name: 'Keka HR',
    category: 'HRMS',
    description: 'HRMS + payroll workflows for India. Server-to-server client credentials authentication.',
    authType: 'client_credentials',
    tags: ['INDIA PRIORITY', 'HRMS'],
    status: 'READY',
    color: '#FF6B35',
    priority: 4,
    connectionFields: [
      { name: 'client_id', label: 'Client ID', type: 'text', placeholder: 'Enter Keka Client ID', required: true, description: 'From Keka developer settings' },
      { name: 'client_secret', label: 'Client Secret', type: 'password', placeholder: '••••••••', required: true, description: 'From Keka developer settings' },
      { name: 'subdomain', label: 'Subdomain', type: 'text', placeholder: 'yourcompany', required: true, description: 'Keka subdomain (without .keka.com)' },
    ],
    endpoints: {
      token: { method: 'POST', path: 'https://{subdomain}.keka.com/oauth/token' },
      employees: { method: 'GET', path: 'https://{subdomain}.keka.com/api/v1/employees' },
    },
    capabilities: {
      reads: ['hr.employees', 'hr.attendance'],
      writes: [
        { id: 'hr.employee.update', label: 'Update employee record', risk: 'medium' },
        { id: 'hr.leave.approve', label: 'Approve leave request', risk: 'medium' },
      ],
    },
  },
  {
    id: 'razorpayx',
    name: 'RazorpayX Payroll',
    category: 'PAYROLL',
    description: 'Payroll disbursements and payout rails via RazorpayX.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'PAYROLL'],
    status: 'READY',
    color: '#0066FF',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'key_id', label: 'Key ID', type: 'text', placeholder: 'rzp_test_...', required: true, description: 'Razorpay Key ID' },
        { name: 'key_secret', label: 'Key Secret', type: 'password', placeholder: '••••••••', required: true, description: 'Razorpay Key Secret' },
        { name: 'account_id', label: 'Account ID', type: 'text', placeholder: 'acc_...', required: true, description: 'RazorpayX account identifier' },
      ],
      testEndpoint: 'https://api.razorpay.com/v1/fund_accounts',
      baseUrl: 'https://api.razorpay.com/v1',
    },
    endpoints: {
      fundAccounts: { method: 'GET', path: '/fund_accounts' },
    },
    capabilities: {
      reads: ['finance.payroll', 'finance.fund_accounts'],
      writes: [
        { id: 'finance.payout.initiate', label: 'Initiate payout', risk: 'money' },
      ],
    },
  },
  {
    id: 'deel',
    name: 'Deel',
    category: 'GLOBAL_PAYROLL',
    description: 'Global payroll + contractor operations.',
    authType: 'oauth2',
    tags: ['GLOBAL', 'PAYROLL'],
    status: 'READY',
    color: '#15357A',
    priority: 4,
    oauthConfig: {
      authorizationUrl: 'https://app.deel.com/oauth2/authorize',
      tokenUrl: 'https://app.deel.com/oauth2/token',
      scopes: [],
      redirectPath: `${API_CALLBACK_BASE}/deel`,
    },
    endpoints: {
      me: { method: 'GET', path: 'https://api.deel.com/rest/v2/profile' },
    },
    capabilities: {
      reads: ['hr.employees', 'hr.contracts', 'finance.payroll'],
      writes: [
        { id: 'hr.contract.create', label: 'Create contractor contract', risk: 'high' },
        { id: 'finance.payroll.approve', label: 'Approve payroll run', risk: 'money' },
      ],
    },
  },
  {
    id: 'gusto',
    name: 'Gusto',
    category: 'PAYROLL',
    description: 'US payroll + benefits operations.',
    authType: 'oauth2',
    tags: ['US PAYROLL'],
    status: 'READY',
    color: '#E87722',
    priority: 4,
    oauthConfig: {
      authorizationUrl: 'https://api.gusto.com/oauth/authorize',
      tokenUrl: 'https://api.gusto.com/oauth/token',
      scopes: ['employees:read', 'employees:write', 'payroll:read', 'payroll:write', 'benefits:read'],
      redirectPath: `${API_CALLBACK_BASE}/gusto`,
    },
    endpoints: {
      me: { method: 'GET', path: 'https://api.gusto.com/v1/me' },
    },
    capabilities: {
      reads: ['hr.employees', 'finance.payroll'],
      writes: [
        { id: 'finance.payroll.run', label: 'Run payroll', risk: 'money' },
      ],
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    category: 'COMMUNICATION',
    description: 'Messaging telemetry and alert delivery channel.',
    authType: 'oauth2',
    tags: ['COMMUNICATION', 'GLOBAL'],
    status: 'READY',
    color: '#4A154B',
    priority: 4,
    oauthConfig: {
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: [
        'channels:read',
        'channels:manage',
        'chat:write',
        'users:read',
        'users:read.email',
        'team:read',
        'incoming-webhook',
      ],
      redirectPath: `${API_CALLBACK_BASE}/slack`,
    },
    endpoints: {
      authTest: { method: 'POST', path: 'https://slack.com/api/auth.test' },
    },
    capabilities: {
      reads: ['comms.channels', 'comms.users'],
      writes: [
        { id: 'comms.message.send', label: 'Send Slack message', risk: 'medium' },
        { id: 'comms.channel.create', label: 'Create Slack channel', risk: 'low' },
      ],
    },
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'COLLABORATION',
    description: 'Collaboration rail via Microsoft Graph.',
    authType: 'oauth2',
    tags: ['ENTERPRISE', 'COLLABORATION'],
    status: 'READY',
    color: '#6264A7',
    priority: 4,
    oauthConfig: {
      // Teams permissions are work/school-account-only — must use 'organizations'
      // endpoint, not 'common' (which includes personal accounts that don't have Teams).
      authorizationUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token',
      scopes: ['openid', 'offline_access', 'User.Read', 'Channel.ReadBasic.All', 'ChannelMessage.Send', 'Team.ReadBasic.All'],
      redirectPath: `${API_CALLBACK_BASE}/teams`,
    },
    endpoints: {
      me: { method: 'GET', path: 'https://graph.microsoft.com/v1.0/me' },
    },
    capabilities: {
      reads: ['comms.channels', 'comms.users'],
      writes: [
        { id: 'comms.message.send', label: 'Send Teams channel message', risk: 'medium' },
      ],
    },
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp Business (Gupshup)',
    category: 'COMMUNICATION',
    description: 'WhatsApp messaging rail for alerts and workflows (via Gupshup).',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'MESSAGING'],
    status: 'READY',
    color: '#25D366',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Enter Gupshup API Key', required: true, description: 'From Gupshup dashboard' },
        { name: 'app_name', label: 'App Name', type: 'text', placeholder: 'your-app', required: true, description: 'Gupshup app name' },
        { name: 'phone_number', label: 'Phone Number', type: 'text', placeholder: '+91...', required: true, description: 'WhatsApp sender number (E.164)' },
      ],
      testEndpoint: 'https://api.gupshup.io/sm/api/v1/app',
      baseUrl: 'https://api.gupshup.io/sm/api/v1',
    },
    endpoints: {
      app: { method: 'GET', path: '/app' },
    },
    capabilities: {
      reads: [],
      writes: [
        { id: 'comms.whatsapp.send', label: 'Send WhatsApp message', risk: 'medium' },
      ],
    },
  },
  {
    id: 'okta',
    name: 'Okta / Auth0',
    category: 'IAM',
    description: 'Identity governance and directory sync via Okta or Auth0.',
    authType: 'oauth2',
    tags: ['IDENTITY', 'ENTERPRISE'],
    status: 'READY',
    color: '#007DC1',
    priority: 4,
    connectionFields: [
      { name: 'domain', label: 'Auth0 / Okta Domain', type: 'text', placeholder: 'your-tenant.us.auth0.com', required: true, description: 'Your Auth0 or Okta domain (no https://)' },
    ],
    oauthConfig: {
      authorizationUrl: 'https://{domain}/authorize',
      tokenUrl: 'https://{domain}/oauth/token',
      scopes: ['openid', 'profile', 'email'],
      redirectPath: `${API_CALLBACK_BASE}/okta`,
    },
    endpoints: {
      userinfo: { method: 'GET', path: 'https://{domain}/userinfo' },
    },
    capabilities: {
      reads: ['identity.users', 'identity.groups'],
      writes: [
        { id: 'identity.user.provision', label: 'Provision user account', risk: 'high' },
        { id: 'identity.user.deactivate', label: 'Deactivate user', risk: 'high' },
        { id: 'identity.group.assign', label: 'Assign user to group', risk: 'medium' },
      ],
    },
  },
  {
    id: 'flock',
    name: 'Flock',
    category: 'COMMUNICATION',
    description: 'Indian team messaging platform (Slack alternative).',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'COMMUNICATION'],
    status: 'READY',
    color: '#0BA8E0',
    priority: 4,
    oauthConfig: {
      authorizationUrl: 'https://api.flock.com/oauth/authorize',
      tokenUrl: 'https://api.flock.com/oauth/token',
      scopes: ['chat:read', 'chat:write', 'users:read'],
      redirectPath: `${API_CALLBACK_BASE}/flock`,
    },
    endpoints: {
      users: { method: 'GET', path: 'https://api.flock.com/v1/users.list' },
    },
    capabilities: {
      reads: [],
      writes: [
        { id: 'comms.message.send', label: 'Send Flock message', risk: 'medium' },
      ],
    },
  },
  {
    id: 'epfo',
    name: 'EPFO',
    category: 'COMPLIANCE',
    description: "Employees' Provident Fund Organization. PF compliance telemetry and filing posture.",
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'GOVERNMENT', 'COMPLIANCE'],
    status: 'READY',
    color: '#1D4ED8',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'establishment_id', label: 'Establishment ID', type: 'text', placeholder: 'Enter EPF Establishment ID', required: true, description: 'EPFO establishment id' },
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Enter API Key', required: true, description: 'EPFO API key' },
        { name: 'dsc', label: 'DSC (Digital Signature Certificate)', type: 'password', placeholder: 'Digital Signature', required: true, description: 'Digital signature certificate material' },
      ],
      testEndpoint: 'https://api.epfindia.gov.in/v1/establishment',
      baseUrl: 'https://api.epfindia.gov.in/v1',
    },
    endpoints: {
      establishment: { method: 'GET', path: '/establishment' },
    },
    capabilities: {
      reads: ['compliance.pf_status'],
      writes: [
        { id: 'compliance.pf.file', label: 'File PF return', risk: 'high' },
      ],
    },
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    category: 'CRM',
    description: 'Enterprise CRM for leads, contacts, opportunities, and pipeline automation.',
    authType: 'oauth2',
    tags: ['CRM', 'GLOBAL', 'ENTERPRISE'],
    status: 'READY',
    color: '#00A1E0',
    priority: 4,
    oauthConfig: {
      authorizationUrl: 'https://login.salesforce.com/services/oauth2/authorize',
      tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      scopes: ['api', 'refresh_token', 'offline_access'],
      redirectPath: `${API_CALLBACK_BASE}/salesforce`,
    },
    endpoints: {
      userinfo: { method: 'GET', path: 'https://login.salesforce.com/services/oauth2/userinfo' },
      leads: { method: 'GET', path: '/services/data/v59.0/sobjects/Lead' },
      contacts: { method: 'GET', path: '/services/data/v59.0/sobjects/Contact' },
      opportunities: { method: 'GET', path: '/services/data/v59.0/sobjects/Opportunity' },
    },
    capabilities: {
      reads: ['sales.leads', 'sales.contacts', 'sales.opportunities'],
      writes: [
        { id: 'sales.lead.create', label: 'Create lead', risk: 'medium' },
        { id: 'sales.lead.update', label: 'Update lead / contact', risk: 'low' },
        { id: 'sales.opportunity.update', label: 'Update opportunity stage', risk: 'low' },
      ],
    },
  },
  {
    id: 'intercom',
    name: 'Intercom',
    category: 'SUPPORT',
    description: 'Customer messaging and support platform for live chat, tickets, and product tours.',
    authType: 'oauth2',
    tags: ['SUPPORT', 'GLOBAL'],
    status: 'READY',
    color: '#1F8DED',
    priority: 4,
    oauthConfig: {
      authorizationUrl: 'https://app.intercom.com/oauth',
      tokenUrl: 'https://api.intercom.io/auth/eagle/token',
      scopes: ['conversations_read', 'conversations_write', 'contacts_read', 'contacts_write'],
      redirectPath: `${API_CALLBACK_BASE}/intercom`,
    },
    endpoints: {
      me: { method: 'GET', path: 'https://api.intercom.io/me' },
      conversations: { method: 'GET', path: 'https://api.intercom.io/conversations' },
      contacts: { method: 'GET', path: 'https://api.intercom.io/contacts' },
    },
    capabilities: {
      reads: ['support.tickets', 'support.contacts'],
      writes: [
        { id: 'support.ticket.reply', label: 'Reply to conversation', risk: 'medium' },
        { id: 'support.ticket.update_status', label: 'Close / snooze conversation', risk: 'low' },
      ],
    },
  },
  {
    id: 'quickbooks',
    name: 'QuickBooks',
    category: 'FINANCE',
    description: 'Accounting platform for invoices, expenses, payroll reporting, and financial analytics.',
    authType: 'oauth2',
    tags: ['FINANCE', 'ACCOUNTING', 'GLOBAL'],
    status: 'READY',
    color: '#2CA01C',
    priority: 4,
    oauthConfig: {
      authorizationUrl: 'https://appcenter.intuit.com/connect/oauth2',
      tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      scopes: ['com.intuit.quickbooks.accounting'],
      redirectPath: `${API_CALLBACK_BASE}/quickbooks`,
    },
    endpoints: {
      companyInfo: { method: 'GET', path: '/v3/company/{realmId}/companyinfo/{realmId}' },
      invoices: { method: 'GET', path: '/v3/company/{realmId}/query?query=select * from Invoice' },
      expenses: { method: 'GET', path: '/v3/company/{realmId}/query?query=select * from Purchase' },
    },
    capabilities: {
      reads: ['finance.invoices', 'finance.expenses', 'finance.transactions'],
      writes: [
        { id: 'finance.invoice.create', label: 'Create invoice', risk: 'money' },
        { id: 'finance.expense.create', label: 'Log expense', risk: 'medium' },
      ],
    },
  },
  {
    id: 'servicenow',
    name: 'ServiceNow',
    category: 'ITSM',
    description: 'Enterprise IT service management for incidents, change requests, and asset tracking.',
    authType: 'api_key',
    tags: ['ITSM', 'ENTERPRISE', 'GLOBAL'],
    status: 'READY',
    color: '#81B5A1',
    priority: 4,
    apiKeyConfig: {
      requiredFields: [
        { name: 'instance', label: 'Instance Name', type: 'text', placeholder: 'yourcompany', required: true, description: 'ServiceNow instance name (yourcompany.service-now.com)' },
        { name: 'username', label: 'Username', type: 'text', placeholder: 'admin', required: true, description: 'ServiceNow username' },
        { name: 'password', label: 'Password', type: 'password', placeholder: '••••••••', required: true, description: 'ServiceNow password or API token' },
      ],
      testEndpoint: '/api/now/table/sys_user?sysparm_limit=1',
      baseUrl: 'https://{instance}.service-now.com',
    },
    endpoints: {
      incidents: { method: 'GET', path: '/api/now/table/incident' },
      createIncident: { method: 'POST', path: '/api/now/table/incident' },
      changeRequests: { method: 'GET', path: '/api/now/table/change_request' },
    },
    capabilities: {
      reads: ['itsm.incidents', 'itsm.changes', 'itsm.assets'],
      writes: [
        { id: 'itsm.incident.create', label: 'Create incident', risk: 'medium' },
        { id: 'itsm.incident.update', label: 'Update incident status', risk: 'low' },
        { id: 'itsm.change.create', label: 'Create change request', risk: 'high' },
      ],
    },
  },
];

export const IMPLEMENTED_INTEGRATIONS: IntegrationSpec[] = [
  INTERNAL_INTEGRATION,
  ...PHASE1_INTEGRATIONS,
  ...PHASE2_INTEGRATIONS,
  ...PHASE3_INTEGRATIONS,
  ...PHASE4_INTEGRATIONS,
];

export function getIntegrationSpec(id: string) {
  return IMPLEMENTED_INTEGRATIONS.find((spec) => spec.id === id) || null;
}
