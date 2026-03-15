# Information Security Policy

**Rasi Cyber Solutions**
**Effective Date:** March 15, 2026
**Last Updated:** March 15, 2026

---

## 1. Purpose

This policy defines the security controls, standards, and responsibilities that Rasi Cyber Solutions maintains to protect customer data, employee data, and company systems from unauthorized access, disclosure, modification, or destruction.

---

## 2. Scope

This policy applies to:
- All employees, contractors, and third parties with access to company systems
- All systems, applications, and infrastructure used to deliver the RasiSyntheticHR Service
- All customer and partner data processed by Rasi Cyber Solutions

---

## 3. Infrastructure Security

### 3.1 Hosting Providers
- **Backend API:** Railway (SOC 2 compliant)
- **Frontend:** Vercel (SOC 2 compliant)
- **Database:** Supabase (SOC 2 compliant, PostgreSQL with Row-Level Security)

All hosting providers are contractually bound to maintain equivalent security standards.

### 3.2 Network Security
- All data in transit is encrypted using TLS 1.2 or higher
- HTTPS is enforced on all endpoints — HTTP requests are automatically redirected
- Internal service-to-service communication uses encrypted connections

### 3.3 Data Encryption
- **In transit:** TLS 1.2+ on all connections
- **At rest:** AES-256 encryption for all sensitive data including OAuth tokens, API keys, and credentials
- **Passwords:** Hashed using bcrypt — never stored in plaintext

---

## 4. Access Control

### 4.1 Principle of Least Privilege
All access to systems and data is granted based on job function. Users receive the minimum permissions necessary to perform their role.

### 4.2 Role-Based Access Control (RBAC)
The RasiSyntheticHR platform enforces four access levels:
- **super_admin** — full platform access
- **admin** — organization-level administration
- **manager** — operational access within their team
- **viewer** — read-only access

### 4.3 Multi-Factor Authentication (MFA)
MFA is required for access to all internal systems including:
- GitHub (source code)
- Railway (backend infrastructure)
- Vercel (frontend infrastructure)
- Supabase (database)

### 4.4 Database Isolation
Row-Level Security (RLS) is enforced at the database layer, ensuring complete organizational data isolation. No user can access data belonging to another organization.

### 4.5 Secrets Management
All secrets and credentials are stored in Railway's encrypted environment variable store. Secrets are never committed to source code. Access to production secrets is restricted to authorized personnel only.

---

## 5. Application Security

### 5.1 Input Validation
All API endpoints enforce strict input validation using Zod schemas. Inputs are validated for type, format, length, and range before processing.

### 5.2 Authentication
- Authentication is handled via Supabase Auth using industry-standard JWT tokens
- Tokens expire after 15 minutes of inactivity
- Account lockout and brute force protection is enforced by Supabase Auth

### 5.3 Injection Prevention
- All database queries use parameterized queries via Supabase's client library
- No raw SQL string concatenation is used

### 5.4 API Security
- All API routes require authentication
- RBAC permissions are validated on every request
- Rate limiting is enforced to prevent abuse
- Response payloads return only explicitly defined fields — no mass data exposure

### 5.5 Code Review
All code changes require pull request review before merging to the main branch. Security-sensitive changes receive additional review.

### 5.6 Dependency Management
Dependencies are monitored for known vulnerabilities using GitHub Dependabot. Critical vulnerabilities are patched within 48 hours of disclosure.

---

## 6. Employee Security

### 6.1 Background Checks
All employees and contractors undergo background checks prior to starting work, including identity verification and employment history.

### 6.2 Confidentiality Agreements
All employees and contractors sign NDAs and confidentiality agreements prior to starting work.

### 6.3 Security Awareness
Security best practices are reviewed during employee onboarding. Employees are briefed on phishing awareness, password hygiene, and secure handling of customer data.

### 6.4 Endpoint Security
Employees are required to:
- Enable full-disk encryption on work devices
- Use screen locks with a maximum 5-minute timeout
- Keep operating systems and software up to date
- Use a password manager for all work credentials

---

## 7. Vulnerability Management

### 7.1 Scanning
- GitHub Dependabot monitors dependencies for known CVEs
- Infrastructure vulnerability scanning is handled by Railway and Supabase

### 7.2 Remediation SLAs
| Severity | Remediation Timeline |
|---|---|
| Critical | Within 48 hours |
| High | Within 7 days |
| Medium | Within 30 days |
| Low | Next scheduled release |

### 7.3 Penetration Testing
Rasi Cyber Solutions plans to conduct its first third-party penetration test within 6 months. Penetration testing will be conducted annually thereafter.

---

## 8. Third-Party Vendor Management

Prior to onboarding vendors or partners with access to customer data, we evaluate:
- Security certifications (SOC 2, ISO 27001)
- Data handling and privacy practices
- Incident response capabilities

Ongoing vendor risk is reviewed annually.

---

## 9. Logging and Monitoring

- All API requests are logged with endpoint, method, response status, org context, and timestamp
- Logs are retained for 1 year
- Anomalous activity triggers alerts for review
- Integration connection events are audited in a dedicated audit log table

---

## 10. Policy Review

This policy is reviewed and updated at least annually, or following any significant security incident or material change to our infrastructure.

**Policy Owner:** Rasi Cyber Solutions Leadership
**Contact:** info@rasisolutions.com
