# Zapheit - Project Context

## 1. High-Level Concept
**Zapheit** is an Enterprise AI Workforce Management Platform designed to act as "HR for AI Agents." The platform empowers enterprise users to securely organize, deploy, and manage AI agents tailored for specific departments such as HR, IT, Sales, and Customer Support. By centralizing management, organizations can govern their AI workforce with the same oversight and structure as their human workforce.

## 2. Infrastructure & Deployment Architecture
Our deployment architecture is built around enterprise security and data privacy:
- **VPC / On-Premise Runtimes**: Agent runtimes sit securely inside a customer's Virtual Private Cloud (VPC) or on-premise infrastructure. This ensures that sensitive enterprise data processing remains securely within the customer's perimeter.
- **Secure Polling Mechanism**: Instead of exposing inbound ports, the runtimes proactively pull approved jobs and configurations from the Zapheit central control plane using a secure polling mechanism.
- **Authentication**: Runtimes authenticate and register via unique Docker configurations, Runtime IDs, and securely issued Enrollment Tokens.

## 3. LLM Routing & Model Architecture
The platform handles AI models using a flexible and secure hybrid approach:
- **Public Model Routing Layer**: For general-purpose and low-sensitivity tasks, our built-in routing layer connects to an expansive library of 340+ public models from leading AI platforms.
- **Secure Local Models**: For workloads processing highly sensitive or proprietary enterprise data, the routing layer automatically directs requests to secure, locally-hosted LLMs to maintain strict data compliance and privacy.

## 4. Agent Data Structure (Persona Library)
Agents within the platform are provisioned via our Persona Library based on a standardized JSON schema. The defined configuration attributes include:
- **Name**: The display name or identification for the agent.
- **Description**: The agent's core function and specialization.
- **Agent Type**: Categorization of the agent's role (e.g., HR Coordinator, IT Support).
- **AI Platform/Model**: The designated LLM ecosystem or specific model assigned for the agent.
- **System Prompt/Persona**: The base instructions defining the agent's operational behavior and expertise.
- **Budget**: Financial and token limits for the agent's execution.
- **Keywords**: Tags used for internal discoverability and capabilities matching.

## 5. Current State & Immediate Next Steps

### Current State
We have successfully architected and built the following core foundations:
- Functional VPC deployment and polling architecture.
- Core intuitive User Interface (Basic UI/Dashboard).
- The dynamic LLM model routing layer interfacing with both public and secure endpoints.

### Immediate Engineering Goals
The immediate roadmap revolves around agent capability expansion and governance:
1. **Building the Tool/Plugin Registry**: Expanding agent capabilities by allowing them to interface with external APIs, internal enterprise tools, and software ecosystems securely.
2. **Building the Approval Workflow Engine**: Establishing strict human-in-the-loop (HITL) policies, requiring human review and approval for high-risk or outbound agent actions.
3. **Structuring Agent-to-Agent Handoff Protocols**: Creating communication frameworks that enable seamless task delegation and collaboration between specialized agents.

## 6. Control Plane & Execution Flow
At its core, Zapheit functions as a centralized control plane for your entire AI workforce. Executions map to the following concepts:
- **Playbooks**: Standardized, defined operational templates outlining *how* an agent should solve specific departmental problems.
- **Jobs**: Active runs or invocations generated from Playbooks.
- **Approvals**: The human-in-the-loop (HITL) checkpoints routing high-risk operations for explicit oversight.
- **Audit Trails**: Extensive, immutable logs maintaining a history of all executed agent actions for compliance and review.

## 7. Technology Stack & Core Components
The platform is built on a modern, enterprise-ready technology stack:
- **Frontend Panel**: Built with **React**, **Vite**, **Tailwind CSS**, and **shadcn/ui** for a highly responsive, manageable interface.
- **Backend API Engine**: Powered by **Node.js** and **Express**, featuring robust rate limiting, compression, and OpenAPI/Swagger documentation.
- **Database & Authentication**: Heavily utilizes **Supabase (PostgreSQL)** for transactional data, vector storage (if applicable), and secure role-based authentication.
- **Observability & Tracing**: Enterprise-grade monitoring is embedded deeply into the APIs using **OpenTelemetry** (Metrics and Traces), **Prometheus**, and **Sentry** for reliable error tracking and system audits.

## 8. Repository Structure & Navigation
To assist with navigation and onboarding, the repository is structured as a monorepo containing distinct services:
- `/synthetic-hr`: The Frontend React/Vite dashboard.
- `/synthetic-hr-api`: The Express/Node.js backend HTTP API.
- `/synthetic-hr-runtime`: The execution engine/worker node application.
- `/synthetic-hr-database`: Database schema, Supabase migrations, and deployment configurations.
- `/deploy`: Centralized deployment configurations (e.g., Docker Compose for self-hosting).
- `/docs`: Archived and broader application documentation.

## 9. Testing & Quality Assurance
Quality and reliability are enforced using the following tools:
- **API/Unit Tests**: Executed via **Jest** located in `src/__tests__` within the API repository.
- **End-to-End Tests**: Utilizes **Playwright** for the React frontend, simulating full user flows.
- **CI/CD**: Uses standard GitHub actions / CI pipelines for quality, linting (ESLint), and TypeScript compilation.

## 10. Security & Encryption
Given the sensitive nature of an enterprise AI workforce, Zapheit incorporates several layers of cryptographic security:
- **Authentication**: Managed via Supabase Auth, adhering to industry standards for secure password hashing and JWT issuance.
- **Secrets Management (AES-256-GCM)**: All third-party integration credentials, OAuth tokens, and plugin API keys are symmetrically encrypted at rest using **AES-256-GCM**.
- **Cryptographic Hashing**: Strong hashing algorithms (e.g., **SHA-256**) are actively used throughout the API layer for prompt cache deduplication, payload integrity, and reconciling events. 
- **Automated Security Smoke Tests**: Dedicated standalone boundary checks (e.g., `test-security.js`) validate that unauthenticated or tampered requests are immediately rejected by the API.
