# syntheticHR Integration Specifications

> **Project**: AI-Powered HR Platform for Indian Companies
> **Tech Stack**: Next.js 15, Prisma, SQLite, shadcn/ui, TypeScript
> **Purpose**: This document contains complete specifications for all HR integrations

---

## Table of Contents

1. [Integration Categories](#integration-categories)
2. [Database Schema](#database-schema)
3. [Integration Configurations](#integration-configurations)
4. [Service Adapters](#service-adapters)
5. [API Routes](#api-routes)
6. [Environment Variables](#environment-variables)
7. [Implementation Priority](#implementation-priority)

---

## Integration Categories

| Category | Purpose | AI Capability |
|----------|---------|---------------|
| `HRMS` | Human Resource Management | Attrition prediction, workforce analytics |
| `PAYROLL` | Salary & Compensation | Payroll anomaly detection |
| `RECRUITMENT` | Hiring & Talent Acquisition | Resume matching, candidate scoring |
| `ATS` | Applicant Tracking | Pipeline analytics |
| `COMPLIANCE` | Tax & Regulatory | Compliance automation, deadline prediction |
| `COMMUNICATION` | Team Messaging | Sentiment analysis, burnout detection |
| `IDENTITY` | Authentication & KYC | Identity verification |
| `DOCUMENTS` | Document Management | Document processing, verification |
| `BGV` | Background Verification | Risk scoring, verification automation |
| `LMS` | Learning Management | Skill gap analysis, course recommendations |
| `PAYMENTS` | Financial Transactions | Payment analytics, fraud detection |
| `FINANCE` | Accounting | Financial insights, expense analysis |
| `COLLABORATION` | Team Workspaces | Productivity analytics |
| `IAM` | Identity Access Management | Access pattern analysis |

---

## Database Schema

### Complete Prisma Schema for All Integrations

```prisma
// This is your Prisma schema file,
// learn more about it in the docs: https://pris.ly/prisma-schema

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

// ==================== USER MANAGEMENT ====================

model User {
  id           String        @id @default(cuid())
  email        String        @unique
  name         String?
  role         String        @default("user")
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  integrations Integration[]
  aiModels     AIModel[]
}

// ==================== INTEGRATIONS ====================

model Integration {
  id              String              @id @default(cuid())
  userId          String
  user            User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  // Service Identification
  serviceType     String              // e.g., 'naukri', 'cleartax', 'zoho_people'
  serviceName     String              // Display name: 'Naukri.com', 'ClearTax'
  category        String              // HRMS, PAYROLL, RECRUITMENT, etc.

  // Connection Status
  status          IntegrationStatus   @default(disconnected)
  authType        AuthType

  // AI Features
  aiEnabled       Boolean             @default(false)
  aiLastTraining  DateTime?
  aiModelVersion  String?
  aiConfidence    Float?

  // Timestamps
  lastSyncAt      DateTime?
  lastErrorAt     DateTime?
  lastErrorMsg    String?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  // Relations
  credentials     Credential[]
  connectionLogs  ConnectionLog[]
  aiDataPoints    AIDataPoint[]

  @@unique([userId, serviceType])
  @@index([category])
  @@index([status])
}

model Credential {
  id             String       @id @default(cuid())
  integrationId  String
  integration    Integration  @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  key            String       // e.g., 'api_key', 'access_token', 'client_id'
  value          String       // Encrypted value
  isSensitive    Boolean      @default(true)

  // Token expiry for OAuth
  expiresAt      DateTime?

  // Metadata
  label          String?      // Display label
  lastRotated    DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@unique([integrationId, key])
}

model ConnectionLog {
  id             String       @id @default(cuid())
  integrationId  String
  integration    Integration  @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  action         String       // connect, disconnect, sync, refresh, error
  status         String       // success, failed
  message        String?
  metadata       String?      // JSON string for additional data

  createdAt      DateTime     @default(now())

  @@index([integrationId, createdAt])
}

// ==================== AI MODELS ====================

model AIModel {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  name          String
  version       String
  purpose       String   // attrition_prediction, resume_matching, sentiment_analysis

  // Training Info
  trainingDataCount Int   @default(0)
  accuracy          Float?
  lastTrainedAt     DateTime?

  // Model Config
  config        String?  // JSON: hyperparameters, features

  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, name, version])
}

model AIDataPoint {
  id             String   @id @default(cuid())
  integrationId  String
  integration    Integration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  // Data Classification
  dataType       String   // resume, attendance, sentiment, payroll, etc.
  sourceId       String?  // ID from the source system

  // Raw & Processed Data
  rawData        String   // JSON: original data from API
  processedData  String?  // JSON: AI-processed/enriched data

  // Processing Status
  status         String   @default("pending") // pending, processed, failed
  processedAt    DateTime?
  error          String?

  // AI Insights
  confidence     Float?
  predictions    String?  // JSON: AI predictions

  createdAt      DateTime @default(now())

  @@index([integrationId, dataType])
  @@index([status])
}

// ==================== ENUMS ====================

enum IntegrationStatus {
  disconnected
  connected
  error
  syncing
  expired
}

enum AuthType {
  oauth2
  api_key
  client_credentials
  basic_auth
}

// ==================== LEGACY (Keep for compatibility) ====================

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

---

## Integration Configurations

### TypeScript Configuration Object

```typescript
// src/lib/integrations/config.ts

import { IntegrationConfig } from './types';

// Base URL for OAuth callbacks
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export const INTEGRATIONS: IntegrationConfig[] = [
  // ============================================================
  // TIER 1: CRITICAL (Highest Priority for AI HR Platform)
  // ============================================================

  // 1. NAUKRI.COM - AI Resume Matching & Recruitment
  {
    id: 'naukri',
    name: 'Naukri.com',
    category: 'RECRUITMENT',
    description: 'India\'s largest job portal. AI-powered resume matching, candidate scoring, and job posting automation.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'RECRUITMENT RAIL', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/naukri.svg',
    color: '#4A90D9',
    priority: 1,

    apiKeyConfig: {
      requiredFields: [
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Enter Naukri API Key', required: true, description: 'Partner API key from Naukri' },
        { name: 'client_id', label: 'Client ID', type: 'text', placeholder: 'Enter Client ID', required: true, description: 'Client identifier' },
        { name: 'employer_id', label: 'Employer ID', type: 'text', placeholder: 'Enter Employer ID', required: true, description: 'Your employer account ID' },
      ],
      testEndpoint: 'https://api.naukri.com/v1/jobs',
      baseUrl: 'https://api.naukri.com/v1',
    },

    endpoints: {
      jobs: { method: 'GET', path: '/jobs' },
      createJob: { method: 'POST', path: '/jobs' },
      searchCandidates: { method: 'GET', path: '/candidates/search' },
      getCandidate: { method: 'GET', path: '/candidates/{id}' },
      parseResume: { method: 'POST', path: '/candidates/parse' },
    },

    aiFeatures: {
      enabled: true,
      capabilities: ['resume_matching', 'candidate_scoring', 'skill_extraction'],
      dataTypes: ['resumes', 'job_descriptions', 'candidate_profiles'],
    },

    webhookConfig: {
      supportedEvents: ['candidate.applied', 'candidate.shortlisted', 'candidate.rejected', 'job.posted'],
      webhookPath: '/api/webhooks/naukri',
    },
  },

  // 2. CLEARTAX - AI Tax & Compliance Automation
  {
    id: 'cleartax',
    name: 'ClearTax',
    category: 'COMPLIANCE',
    description: 'India\'s #1 tax & compliance platform. AI-powered TDS calculation, GST filing, and compliance monitoring.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'COMPLIANCE RAIL', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/cleartax.svg',
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

    aiFeatures: {
      enabled: true,
      capabilities: ['compliance_monitoring', 'tax_calculation', 'deadline_prediction', 'anomaly_detection'],
      dataTypes: ['tax_rules', 'compliance_status', 'filings'],
    },

    webhookConfig: {
      supportedEvents: ['compliance.deadline', 'notice.received', 'return.filed'],
      webhookPath: '/api/webhooks/cleartax',
    },
  },

  // 3. ZOHO PEOPLE - AI HRMS & Attrition Prediction
  {
    id: 'zoho_people',
    name: 'Zoho People',
    category: 'HRMS',
    description: 'Comprehensive HRMS from Zoho. AI-powered attrition prediction, workforce analytics, and employee lifecycle management.',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'HRMS', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/zoho.svg',
    color: '#D97706',
    priority: 1,

    oauthConfig: {
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes: ['ZohoPeople.modules.ALL', 'ZohoPeople.users.READ', 'ZohoPeople.users.ALL'],
      redirectUri: `${BASE_URL}/api/integrations/oauth/callback/zoho_people`,
    },

    endpoints: {
      employees: { method: 'GET', path: '/employees' },
      employee: { method: 'GET', path: '/employees/{id}' },
      attendance: { method: 'GET', path: '/attendance' },
      leave: { method: 'GET', path: '/leave' },
      performance: { method: 'GET', path: '/performance' },
    },

    aiFeatures: {
      enabled: true,
      capabilities: ['attrition_prediction', 'performance_prediction', 'workforce_analytics', 'anomaly_detection'],
      dataTypes: ['employees', 'attendance', 'leave', 'performance'],
    },

    webhookConfig: {
      supportedEvents: ['employee.added', 'employee.updated', 'employee.offboarded', 'leave.applied'],
      webhookPath: '/api/webhooks/zoho_people',
    },
  },

  // 4. LINKEDIN - AI Talent Intelligence
  {
    id: 'linkedin',
    name: 'LinkedIn',
    category: 'RECRUITMENT',
    description: 'World\'s largest professional network. AI-powered talent intelligence, skill mapping, and professional network analysis.',
    authType: 'oauth2',
    tags: ['GLOBAL', 'RECRUITMENT', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/linkedin.svg',
    color: '#0A66C2',
    priority: 1,

    oauthConfig: {
      authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization',
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      scopes: ['r_liteprofile', 'r_emailaddress', 'r_basicprofile', 'w_member_social'],
      redirectUri: `${BASE_URL}/api/integrations/oauth/callback/linkedin`,
    },

    endpoints: {
      profile: { method: 'GET', path: '/me' },
      person: { method: 'GET', path: '/people/{id}' },
      search: { method: 'GET', path: '/people/search' },
      skills: { method: 'GET', path: '/skills' },
      share: { method: 'POST', path: '/shares' },
    },

    aiFeatures: {
      enabled: true,
      capabilities: ['talent_intelligence', 'skill_mapping', 'network_analysis', 'career_trajectory'],
      dataTypes: ['profiles', 'skills', 'endorsements', 'connections'],
    },

    webhookConfig: {
      supportedEvents: ['profile.updated'],
      webhookPath: '/api/webhooks/linkedin',
    },
  },

  // 5. TALLY.ERP - AI Financial Insights
  {
    id: 'tally',
    name: 'Tally.ERP',
    category: 'FINANCE',
    description: 'India\'s most popular accounting software (90%+ market share). AI-powered financial insights for HR, payroll expense tracking.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'FINANCE RAIL', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/tally.svg',
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
      baseUrl: '', // Dynamic based on server_url
    },

    endpoints: {
      companies: { method: 'GET', path: '/companies', format: 'xml' },
      ledgers: { method: 'GET', path: '/ledgers', format: 'xml' },
      vouchers: { method: 'GET', path: '/vouchers', format: 'xml' },
      stockItems: { method: 'GET', path: '/stockitems', format: 'xml' },
      postVoucher: { method: 'POST', path: '/vouchers', format: 'xml' },
    },

    aiFeatures: {
      enabled: true,
      capabilities: ['expense_analytics', 'budget_prediction', 'anomaly_detection', 'trend_analysis'],
      dataTypes: ['ledgers', 'vouchers', 'transactions'],
    },

    notes: 'Tally uses XML-based API (ODBC). Runs locally or via Tally on Cloud.',
  },

  // ============================================================
  // TIER 2: HIGH PRIORITY
  // ============================================================

  // 6. GREYTHR - AI Workforce Planning
  {
    id: 'greythr',
    name: 'Greythr',
    category: 'HRMS',
    description: 'India\'s leading HRMS for SMEs. AI-powered workforce planning, attendance automation, and payroll management.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'HRMS', 'SME FOCUS', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/greythr.svg',
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

    aiFeatures: {
      enabled: true,
      capabilities: ['workforce_planning', 'attendance_analytics', 'leave_prediction', 'payroll_anomaly'],
      dataTypes: ['employees', 'attendance', 'leaves', 'payroll'],
    },

    webhookConfig: {
      supportedEvents: ['employee.onboarded', 'employee.offboarded', 'attendance.swipe', 'leave.approved'],
      webhookPath: '/api/webhooks/greythr',
    },
  },

  // 7. ZOHO RECRUIT - AI Applicant Tracking
  {
    id: 'zoho_recruit',
    name: 'Zoho Recruit',
    category: 'ATS',
    description: 'AI-powered applicant tracking system. Resume parsing, candidate pipeline management, and hiring analytics.',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'ATS', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/zoho.svg',
    color: '#DC2626',
    priority: 2,

    oauthConfig: {
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes: ['ZohoRecruit.modules.ALL', 'ZohoRecruit.users.READ'],
      redirectUri: `${BASE_URL}/api/integrations/oauth/callback/zoho_recruit`,
    },

    endpoints: {
      candidates: { method: 'GET', path: '/Candidates' },
      createCandidate: { method: 'POST', path: '/Candidates' },
      jobOpenings: { method: 'GET', path: '/JobOpenings' },
      createJob: { method: 'POST', path: '/JobOpenings' },
      parseResume: { method: 'POST', path: '/parse/resume' },
    },

    aiFeatures: {
      enabled: true,
      capabilities: ['resume_parsing', 'candidate_matching', 'pipeline_analytics', 'hiring_prediction'],
      dataTypes: ['candidates', 'jobs', 'applications', 'interviews'],
    },

    webhookConfig: {
      supportedEvents: ['candidate.added', 'candidate.moved', 'interview.scheduled', 'offer.extended'],
      webhookPath: '/api/webhooks/zoho_recruit',
    },
  },

  // 8. APNA - AI Blue-collar Hiring
  {
    id: 'apna',
    name: 'Apna',
    category: 'RECRUITMENT',
    description: 'India\'s largest professional network for blue-collar workers. AI-powered candidate matching for mass recruitment.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'BLUE-COLLAR', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/apna.svg',
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

    aiFeatures: {
      enabled: true,
      capabilities: ['candidate_matching', 'skill_assessment', 'mass_recruitment', 'availability_prediction'],
      dataTypes: ['candidate_profiles', 'job_preferences', 'applications'],
    },

    webhookConfig: {
      supportedEvents: ['candidate.applied', 'candidate.shortlisted'],
      webhookPath: '/api/webhooks/apna',
    },
  },

  // 9. AADHAAR API - AI Identity Verification
  {
    id: 'aadhaar',
    name: 'Aadhaar API',
    category: 'IDENTITY',
    description: 'UIDAI Aadhaar authentication. AI-powered identity verification, KYC automation, and document verification.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'KYC', 'GOVERNMENT', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/aadhaar.svg',
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

    aiFeatures: {
      enabled: true,
      capabilities: ['identity_verification', 'face_matching', 'address_verification', 'fraud_detection'],
      dataTypes: ['identity_data', 'demographics', 'photos'],
    },

    webhookConfig: {
      supportedEvents: ['verification.success', 'verification.failed'],
      webhookPath: '/api/webhooks/aadhaar',
    },

    notes: 'Requires UIDAI registration and compliance. Use sandbox for testing.',
  },

  // ============================================================
  // TIER 3: MEDIUM PRIORITY
  // ============================================================

  // 10. DIGILOCKER - AI Document Processing
  {
    id: 'digilocker',
    name: 'DigiLocker',
    category: 'DOCUMENTS',
    description: 'Government digital locker. AI-powered document processing, certificate verification, and education/ID verification.',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'DOCUMENTS', 'GOVERNMENT', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/digilocker.svg',
    color: '#0284C7',
    priority: 3,

    oauthConfig: {
      authorizationUrl: 'https://api.digitallocker.gov.in/oauth2/authorize',
      tokenUrl: 'https://api.digitallocker.gov.in/oauth2/token',
      scopes: ['file_fetch', 'file_upload'],
      redirectUri: `${BASE_URL}/api/integrations/oauth/callback/digilocker`,
    },

    endpoints: {
      files: { method: 'GET', path: '/files' },
      file: { method: 'GET', path: '/files/{id}' },
      certificates: { method: 'GET', path: '/certificates' },
      verify: { method: 'POST', path: '/verify' },
    },

    aiFeatures: {
      enabled: true,
      capabilities: ['document_processing', 'certificate_verification', 'ocr', 'fraud_detection'],
      dataTypes: ['documents', 'certificates', 'identity_proofs'],
    },

    webhookConfig: {
      supportedEvents: ['document.added', 'document.verified'],
      webhookPath: '/api/webhooks/digilocker',
    },
  },

  // 11. IDFY - AI Background Verification
  {
    id: 'idfy',
    name: 'IDfy',
    category: 'BGV',
    description: 'AI-powered background verification. Employment verification, education check, criminal check automation.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'BGV', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/idfy.svg',
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

    aiFeatures: {
      enabled: true,
      capabilities: ['risk_scoring', 'verification_automation', 'fraud_detection', 'pattern_analysis'],
      dataTypes: ['verification_status', 'risk_scores', 'reports'],
    },

    webhookConfig: {
      supportedEvents: ['verification.completed', 'verification.failed', 'report.generated'],
      webhookPath: '/api/webhooks/idfy',
    },
  },

  // 12. ZOHO LEARN - AI Learning Recommendations
  {
    id: 'zoho_learn',
    name: 'Zoho Learn',
    category: 'LMS',
    description: 'Learning management from Zoho. AI-powered skill recommendations, learning path optimization, course suggestions.',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'LMS', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/zoho.svg',
    color: '#EA580C',
    priority: 3,

    oauthConfig: {
      authorizationUrl: 'https://accounts.zoho.com/oauth/v2/auth',
      tokenUrl: 'https://accounts.zoho.com/oauth/v2/token',
      scopes: ['ZohoLearn.modules.ALL', 'ZohoLearn.users.READ'],
      redirectUri: `${BASE_URL}/api/integrations/oauth/callback/zoho_learn`,
    },

    endpoints: {
      courses: { method: 'GET', path: '/courses' },
      course: { method: 'GET', path: '/courses/{id}' },
      learners: { method: 'GET', path: '/learners' },
      skills: { method: 'GET', path: '/skills' },
      recommendations: { method: 'POST', path: '/recommendations' },
    },

    aiFeatures: {
      enabled: true,
      capabilities: ['skill_gap_analysis', 'course_recommendations', 'learning_path', 'certification_tracking'],
      dataTypes: ['courses', 'skills', 'progress', 'certifications'],
    },

    webhookConfig: {
      supportedEvents: ['course.completed', 'certification.earned'],
      webhookPath: '/api/webhooks/zoho_learn',
    },
  },

  // 13. PAYTM BUSINESS - AI Payment Analytics
  {
    id: 'paytm',
    name: 'Paytm Business',
    category: 'PAYMENTS',
    description: 'Popular payment gateway in India. AI-powered payment analytics, salary disbursement tracking.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'PAYMENTS', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/paytm.svg',
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

    aiFeatures: {
      enabled: true,
      capabilities: ['payment_analytics', 'fraud_detection', 'payout_automation', 'expense_tracking'],
      dataTypes: ['transactions', 'payouts', 'refunds'],
    },

    webhookConfig: {
      supportedEvents: ['payment.success', 'payment.failed', 'payout.processed'],
      webhookPath: '/api/webhooks/paytm',
    },
  },

  // ============================================================
  // TIER 4: GROWING / NICHE
  // ============================================================

  // 14. FLOCK - AI Communication (Indian Slack Alternative)
  {
    id: 'flock',
    name: 'Flock',
    category: 'COMMUNICATION',
    description: 'Indian team messaging platform. AI-powered sentiment analysis, communication analytics, collaboration insights.',
    authType: 'oauth2',
    tags: ['INDIA PRIORITY', 'COMMUNICATION', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/flock.svg',
    color: '#0BA8E0',
    priority: 4,

    oauthConfig: {
      authorizationUrl: 'https://api.flock.com/oauth/authorize',
      tokenUrl: 'https://api.flock.com/oauth/token',
      scopes: ['chat:read', 'chat:write', 'users:read'],
      redirectUri: `${BASE_URL}/api/integrations/oauth/callback/flock`,
    },

    endpoints: {
      users: { method: 'GET', path: '/users' },
      conversations: { method: 'GET', path: '/conversations' },
      messages: { method: 'POST', path: '/messages' },
      channels: { method: 'GET', path: '/channels' },
    },

    aiFeatures: {
      enabled: true,
      capabilities: ['sentiment_analysis', 'engagement_analytics', 'productivity_insights', 'burnout_detection'],
      dataTypes: ['messages', 'channels', 'users', 'reactions'],
    },

    webhookConfig: {
      supportedEvents: ['message.received', 'channel.created', 'user.joined'],
      webhookPath: '/api/webhooks/flock',
    },
  },

  // 15. EPFO - AI PF Compliance
  {
    id: 'epfo',
    name: 'EPFO',
    category: 'COMPLIANCE',
    description: 'Employees\' Provident Fund Organization. AI-powered PF compliance, retirement fund tracking, compliance automation.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'COMPLIANCE', 'GOVERNMENT', 'AI-READY'],
    status: 'READY',
    icon: '/integrations/epfo.svg',
    color: '#1D4ED8',
    priority: 4,

    apiKeyConfig: {
      requiredFields: [
        { name: 'establishment_id', label: 'Establishment ID', type: 'text', placeholder: 'Enter EPF Establishment ID', required: true, description: 'EPF establishment ID' },
        { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'Enter API Key', required: true, description: 'API key from EPFO' },
        { name: 'dsc', label: 'DSC', type: 'password', placeholder: 'Digital Signature', required: true, description: 'Digital Signature Certificate' },
      ],
      testEndpoint: 'https://api.epfindia.gov.in/v1/establishment',
      baseUrl: 'https://api.epfindia.gov.in/v1',
    },

    endpoints: {
      establishment: { method: 'GET', path: '/establishment' },
      returns: { method: 'POST', path: '/returns' },
      members: { method: 'GET', path: '/members' },
      contributions: { method: 'GET', path: '/contributions' },
      complianceStatus: { method: 'GET', path: '/compliance/status' },
    },

    aiFeatures: {
      enabled: true,
      capabilities: ['compliance_monitoring', 'deadline_prediction', 'contribution_analytics', 'anomaly_detection'],
      dataTypes: ['pf_contributions', 'balances', 'filings'],
    },

    notes: 'Government API with limited webhook support. Use polling for updates.',
  },

  // ============================================================
  // EXISTING INTEGRATIONS (Already Implemented)
  // ============================================================

  // KEKA HR - Already Added
  {
    id: 'keka',
    name: 'Keka HR',
    category: 'HRMS',
    description: 'HRMS automation with statutory payroll workflows, attendance sync, and employee lifecycle triggers.',
    authType: 'client_credentials',
    tags: ['INDIA PRIORITY', 'LIVE VALIDATION'],
    status: 'READY',
    icon: '/integrations/keka.svg',
    color: '#FF6B35',
    priority: 1,
    // ... existing config
  },

  // RAZORPAYX - Already Added
  {
    id: 'razorpayx',
    name: 'RazorpayX Payroll',
    category: 'PAYROLL',
    description: 'Automate payroll disbursements, compliance cutoffs, and salary payout confirmations.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'PAYROLL RAIL'],
    status: 'READY',
    icon: '/integrations/razorpayx.svg',
    color: '#0066FF',
    priority: 1,
    // ... existing config
  },

  // SLACK - Already Added
  {
    id: 'slack',
    name: 'Slack',
    category: 'COMMUNICATION',
    description: 'Push onboarding alerts, IT requests, and people-ops escalations directly into channel workflows.',
    authType: 'oauth2',
    tags: ['OPS RAIL', 'LIVE VALIDATION'],
    status: 'READY',
    icon: '/integrations/slack.svg',
    color: '#4A154B',
    priority: 1,
    // ... existing config
  },

  // MICROSOFT TEAMS - Already Added
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'COLLABORATION',
    description: 'Route approvals, HR notifications, and service updates into Teams channels and chat workflows.',
    authType: 'oauth2',
    tags: ['ENTERPRISE', 'VERIFIED'],
    status: 'READY',
    icon: '/integrations/teams.svg',
    color: '#6264A7',
    priority: 1,
    // ... existing config
  },

  // WHATSAPP BUSINESS - Already Added
  {
    id: 'whatsapp',
    name: 'WhatsApp Business (Gupshup)',
    category: 'COMMUNICATION',
    description: 'Deliver WhatsApp notifications for payroll status, onboarding tasks, and employee support.',
    authType: 'api_key',
    tags: ['INDIA PRIORITY', 'MESSAGE RAIL'],
    status: 'READY',
    icon: '/integrations/whatsapp.svg',
    color: '#25D366',
    priority: 1,
    // ... existing config
  },

  // OKTA - Already Added
  {
    id: 'okta',
    name: 'Okta',
    category: 'IAM',
    description: 'Provision users, manage access lifecycle events, and sync identity posture with HR.',
    authType: 'oauth2',
    tags: ['IDENTITY', 'VERIFIED'],
    status: 'READY',
    icon: '/integrations/okta.svg',
    color: '#007DC1',
    priority: 1,
    // ... existing config
  },

  // DEEL - Already Added
  {
    id: 'deel',
    name: 'Deel',
    category: 'GLOBAL_PAYROLL',
    description: 'Manage contractor onboarding, international payroll sync, and compliance-ready worker records.',
    authType: 'oauth2',
    tags: ['GLOBAL TEAM', 'VERIFIED'],
    status: 'READY',
    icon: '/integrations/deel.svg',
    color: '#15357A',
    priority: 2,
    // ... existing config
  },

  // GUSTO - Already Added
  {
    id: 'gusto',
    name: 'Gusto',
    category: 'PAYROLL',
    description: 'Keep payroll, benefits, and employee changes aligned with your HR operating stack.',
    authType: 'oauth2',
    tags: ['PAYROLL', 'VERIFIED'],
    status: 'READY',
    icon: '/integrations/gusto.svg',
    color: '#E87722',
    priority: 2,
    // ... existing config
  },
];

// Helper functions
export function getIntegrationById(id: string): IntegrationConfig | undefined {
  return INTEGRATIONS.find(i => i.id === id);
}

export function getIntegrationsByCategory(category: string): IntegrationConfig[] {
  return INTEGRATIONS.filter(i => i.category === category);
}

export function getIntegrationsByPriority(priority: number): IntegrationConfig[] {
  return INTEGRATIONS.filter(i => i.priority === priority);
}

export function getIntegrationsByAuthType(authType: string): IntegrationConfig[] {
  return INTEGRATIONS.filter(i => i.authType === authType);
}

export function getAIEnabledIntegrations(): IntegrationConfig[] {
  return INTEGRATIONS.filter(i => i.aiFeatures?.enabled);
}
```

---

## Service Adapters

### Adapter Implementation Pattern

```typescript
// src/lib/integrations/adapters.ts

import { ConnectionTestResult, SyncResult, TokenResponse } from './types';
import { decrypt } from './encryption';

export interface IntegrationAdapter {
  // Required
  testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult>;

  // Optional - OAuth2 only
  refreshToken?(credentials: Record<string, string>): Promise<TokenResponse>;

  // Optional - Data sync
  sync?(integrationId: string, credentials: Record<string, string>): Promise<SyncResult>;

  // Optional - AI data extraction
  extractAIData?(credentials: Record<string, string>, dataType: string): Promise<unknown>;

  // Optional - Webhook verification
  verifyWebhook?(payload: unknown, signature: string): boolean;
}

// ==================== NAUKRI ADAPTER ====================
export const NaukriAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decrypt(credentials.api_key);
      const clientId = decrypt(credentials.client_id);

      const response = await fetch('https://api.naukri.com/v1/jobs?limit=1', {
        headers: {
          'X-Api-Key': apiKey,
          'X-Client-Id': clientId,
        },
      });

      if (!response.ok) {
        return { success: false, message: `API Error: ${response.status}` };
      }

      return { success: true, message: 'Connected to Naukri.com successfully' };
    } catch (error) {
      return { success: false, message: `Connection failed: ${error}` };
    }
  },

  async extractAIData(credentials: Record<string, string>, dataType: string) {
    const apiKey = decrypt(credentials.api_key);
    const clientId = decrypt(credentials.client_id);

    if (dataType === 'candidates') {
      const response = await fetch('https://api.naukri.com/v1/candidates/search', {
        headers: { 'X-Api-Key': apiKey, 'X-Client-Id': clientId },
      });
      return response.json();
    }

    // Add more data types as needed
  },
};

// ==================== CLEARTAX ADAPTER ====================
export const ClearTaxAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const apiKey = decrypt(credentials.api_key);
      const gstin = decrypt(credentials.gstin);

      const response = await fetch(`https://api.cleartax.in/v1/compliance/status?gstin=${gstin}`, {
        headers: { 'X-Cleartax-Api-Key': apiKey },
      });

      if (!response.ok) {
        return { success: false, message: `API Error: ${response.status}` };
      }

      return { success: true, message: 'Connected to ClearTax successfully' };
    } catch (error) {
      return { success: false, message: `Connection failed: ${error}` };
    }
  },
};

// ==================== ZOHO PEOPLE ADAPTER ====================
export const ZohoPeopleAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const accessToken = decrypt(credentials.access_token);

      const response = await fetch('https://people.zoho.com/api/v1/employees', {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return { success: false, message: 'Token expired. Please reconnect.' };
        }
        return { success: false, message: `API Error: ${response.status}` };
      }

      return { success: true, message: 'Connected to Zoho People successfully' };
    } catch (error) {
      return { success: false, message: `Connection failed: ${error}` };
    }
  },

  async refreshToken(credentials: Record<string, string>): Promise<TokenResponse> {
    const refreshToken = decrypt(credentials.refresh_token);

    const response = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.ZOHO_CLIENT_ID!,
        client_secret: process.env.ZOHO_CLIENT_SECRET!,
      }).toString(),
    });

    if (!response.ok) throw new Error('Token refresh failed');
    return response.json();
  },
};

// ==================== TALLY ADAPTER ====================
export const TallyAdapter: IntegrationAdapter = {
  async testConnection(credentials: Record<string, string>): Promise<ConnectionTestResult> {
    try {
      const serverUrl = decrypt(credentials.server_url);

      // Tally uses XML format
      const xmlRequest = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Company Information</ID></HEADER><BODY></BODY></ENVELOPE>`;

      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml' },
        body: xmlRequest,
      });

      if (!response.ok) {
        return { success: false, message: 'Cannot connect to Tally server' };
      }

      return { success: true, message: 'Connected to Tally.ERP successfully' };
    } catch (error) {
      return { success: false, message: `Connection failed: ${error}` };
    }
  },
};

// ==================== ADAPTER REGISTRY ====================
export const Adapters: Record<string, IntegrationAdapter> = {
  naukri: NaukriAdapter,
  cleartax: ClearTaxAdapter,
  zoho_people: ZohoPeopleAdapter,
  tally: TallyAdapter,
  // ... add all other adapters
};

export function getAdapter(serviceId: string): IntegrationAdapter | undefined {
  return Adapters[serviceId];
}
```

---

## API Routes

### Route Structure

```
src/app/api/integrations/
├── oauth/
│   ├── authorize/route.ts          # Start OAuth flow
│   └── callback/[service]/route.ts # OAuth callback
├── api-keys/route.ts               # API key auth
├── client-credentials/route.ts     # Client credentials auth
├── [id]/
│   └── route.ts                    # CRUD operations
├── sync/[service]/route.ts         # Manual sync
├── test/[service]/route.ts         # Test connection
└── ai/
    └── extract/route.ts            # AI data extraction
```

---

## Environment Variables

```env
# ==================== APP CONFIG ====================
NEXT_PUBLIC_APP_URL=http://localhost:3000
ENCRYPTION_KEY=your-32-character-encryption-key-here

# ==================== TIER 1: CRITICAL ====================

# Naukri.com
NAUKRI_API_KEY=
NAUKRI_CLIENT_ID=
NAUKRI_EMPLOYER_ID=

# ClearTax
CLEARTAX_API_KEY=
CLEARTAX_GSTIN=
CLEARTAX_PAN=

# Zoho (Shared OAuth for People, Recruit, Learn)
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=

# LinkedIn
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=

# Tally.ERP
TALLY_SERVER_URL=http://localhost:9000
TALLY_COMPANY_NAME=
TALLY_USERNAME=
TALLY_PASSWORD=

# ==================== TIER 2: HIGH PRIORITY ====================

# Greythr
GREYTHR_API_KEY=
GREYTHR_COMPANY_ID=
GREYTHR_SUBDOMAIN=

# Apna
APNA_API_KEY=
APNA_EMPLOYER_ID=

# Aadhaar (UIDAI)
AADHAAR_LICENSE_KEY=
AADHAAR_AUA_CODE=
AADHAAR_SUB_AUA_CODE=

# ==================== TIER 3: MEDIUM PRIORITY ====================

# DigiLocker
DIGILOCKER_CLIENT_ID=
DIGILOCKER_CLIENT_SECRET=

# IDfy
IDFY_API_KEY=
IDFY_ACCOUNT_ID=

# Paytm Business
PAYTM_MERCHANT_ID=
PAYTM_MERCHANT_KEY=
PAYTM_CHANNEL_ID=

# ==================== TIER 4: GROWING ====================

# Flock
FLOCK_CLIENT_ID=
FLOCK_CLIENT_SECRET=

# EPFO
EPFO_ESTABLISHMENT_ID=
EPFO_API_KEY=
EPFO_DSC=

# ==================== EXISTING INTEGRATIONS ====================

# Keka HR
KEKA_CLIENT_ID=
KEKA_CLIENT_SECRET=

# RazorpayX
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_ACCOUNT_ID=

# Slack
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=

# Microsoft Teams
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=

# WhatsApp (Gupshup)
GUPSHUP_API_KEY=
GUPSHUP_APP_NAME=
GUPSHUP_PHONE_NUMBER=

# Okta
OKTA_CLIENT_ID=
OKTA_CLIENT_SECRET=
OKTA_DOMAIN=

# Deel
DEEL_CLIENT_ID=
DEEL_CLIENT_SECRET=

# Gusto
GUSTO_CLIENT_ID=
GUSTO_CLIENT_SECRET=
```

---

## Implementation Priority

### Phase 1: Critical (Week 1-2)
```
├── naukri (AI Recruitment)
├── cleartax (AI Compliance)
├── zoho_people (AI HRMS)
├── linkedin (AI Talent Intelligence)
└── tally (AI Finance)
```

### Phase 2: High Priority (Week 3-4)
```
├── greythr (AI Workforce Planning)
├── zoho_recruit (AI ATS)
├── apna (AI Blue-collar)
└── aadhaar (AI Identity)
```

### Phase 3: Medium Priority (Week 5-6)
```
├── digilocker (AI Documents)
├── idfy (AI Background Check)
├── zoho_learn (AI Learning)
└── paytm (AI Payments)
```

### Phase 4: Growing (Week 7-8)
```
├── flock (AI Communication)
└── epfo (AI Compliance)
```

---

## AI Feature Matrix

| Integration | Resume Matching | Attrition Prediction | Sentiment Analysis | Compliance AI | Skill Analysis |
|-------------|-----------------|---------------------|-------------------|---------------|----------------|
| Naukri | ✅ | - | - | - | ✅ |
| ClearTax | - | - | - | ✅ | - |
| Zoho People | - | ✅ | - | - | - |
| LinkedIn | ✅ | - | - | - | ✅ |
| Tally | - | - | - | ✅ | - |
| Greythr | - | ✅ | - | - | - |
| Slack | - | - | ✅ | - | - |
| Teams | - | - | ✅ | - | - |
| WhatsApp | - | - | ✅ | - | - |

---

## Notes for Implementation

1. **Security**: All credentials must be encrypted before storage
2. **Token Refresh**: Implement auto-refresh for OAuth2 tokens
3. **Rate Limiting**: Respect API rate limits for each service
4. **Error Handling**: Log all errors with context for debugging
5. **Webhooks**: Implement signature verification for all webhooks
6. **AI Data**: Store raw data for AI training, processed data for quick access
7. **Testing**: Use sandbox/test modes during development
8. **Documentation**: Each adapter should have JSDoc comments

---