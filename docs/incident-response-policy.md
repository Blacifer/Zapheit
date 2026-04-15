# Incident Response Policy

**Rasi Cyber Solutions**
**Effective Date:** March 15, 2026
**Last Updated:** March 15, 2026

---

## 1. Purpose

This policy defines how Rasi Cyber Solutions detects, responds to, documents, and communicates security incidents, including data breaches, unauthorized access, and service disruptions.

---

## 2. Scope

This policy applies to all systems, services, and data managed by Rasi Cyber Solutions, including the Zapheit platform and all third-party integrations.

---

## 3. Incident Classification

| Severity | Description | Examples |
|---|---|---|
| **P1 - Critical** | Active breach or data exposure affecting customer data | Unauthorized access to production DB, credential theft, data exfiltration |
| **P2 - High** | Suspected breach or significant service compromise | Abnormal API access patterns, suspected token theft, service unavailability |
| **P3 - Medium** | Contained vulnerability or limited exposure | Misconfigured access control, dependency CVE, isolated account compromise |
| **P4 - Low** | Minor security issue with no data exposure risk | Failed login spikes, minor config issues |

---

## 4. Incident Response Phases

### Phase 1 — Detection (Target: within 1 hour)
Incidents may be detected via:
- Automated monitoring and alerting (Railway, Supabase)
- API anomaly detection in application logs
- Customer or third-party report
- Internal team discovery

All suspected incidents must be reported immediately to support@zapheit.com.

### Phase 2 — Triage (Target: within 4 hours of detection)
Upon detection:
- Confirm whether an incident has occurred
- Classify severity (P1–P4)
- Assign incident owner
- Begin incident log

### Phase 3 — Containment (Target: within 4 hours for P1, 24 hours for P2)
Containment actions may include:
- Revoking compromised credentials or tokens
- Disabling affected integrations or API keys
- Isolating affected infrastructure
- Blocking malicious IP addresses
- Forcing re-authentication for affected users

### Phase 4 — Investigation (Target: within 24 hours for P1)
- Identify root cause
- Determine scope of data affected
- Identify affected customers and data types
- Preserve evidence and logs

### Phase 5 — Notification

#### Customer Notification SLAs
| Severity | Customer Notification Timeline |
|---|---|
| P1 - Critical | Within 72 hours of confirmed breach |
| P2 - High | Within 5 business days |
| P3 - Medium | Within 10 business days (if data affected) |
| P4 - Low | No notification required unless data affected |

#### Regulatory Notification
- **GDPR (EEA users):** Supervisory authority notified within 72 hours of confirmed breach
- **India DPDPA:** Notification to Data Protection Board as required by applicable regulations
- **US (CCPA/state laws):** Notification to affected individuals per applicable state requirements

#### Notification Content
Customer breach notifications will include:
- Nature of the incident
- Data types affected
- Approximate number of affected individuals
- Steps taken to contain and remediate
- Recommended actions for affected customers
- Contact for further information

### Phase 6 — Remediation
- Implement permanent fix for root cause
- Patch affected systems
- Update security controls to prevent recurrence
- Verify fix effectiveness

### Phase 7 — Post-Incident Review (within 7 days of resolution)
- Document full incident timeline
- Root cause analysis
- Lessons learned
- Policy and control updates

---

## 5. Roles and Responsibilities

| Role | Responsibility |
|---|---|
| Incident Owner | Leads response, coordinates team, owns communication |
| Engineering Lead | Technical investigation and remediation |
| Leadership | Customer and regulatory notifications, business decisions |

---

## 6. Contact

To report a security incident or vulnerability:
**Email:** support@zapheit.com
**Subject line:** SECURITY INCIDENT — [brief description]

We aim to acknowledge all security reports within 24 hours.
