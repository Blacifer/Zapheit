# Data Retention and Destruction Policy

**Rasi Cyber Solutions**
**Effective Date:** March 15, 2026
**Last Updated:** March 15, 2026

---

## 1. Purpose

This policy defines how Rasi Cyber Solutions retains, archives, and permanently destroys customer, partner, employee, and vendor data in a secure and compliant manner.

---

## 2. Scope

This policy applies to all data collected, processed, or stored by Rasi Cyber Solutions in connection with the RasiSyntheticHR Service, including data from third-party integrations such as Gusto, Salesforce, Slack, and others.

---

## 3. Data Retention Schedule

| Data Category | Retention Period | Basis |
|---|---|---|
| Account and profile data | Duration of subscription + 30 days post-termination | Service delivery |
| OAuth access tokens | Until disconnection or expiry | Security |
| OAuth refresh tokens | Until disconnection or revocation | Security |
| API keys (third-party) | Until disconnection by user | Service delivery |
| Agent execution logs | 90 days | Operational support |
| Audit logs | 1 year | Security and compliance |
| Incident and error logs | 1 year | Security review |
| Integration connection logs | 1 year | Audit trail |
| Billing and payment records | 7 years | Legal and tax requirement |
| Employee HR data (from integrations) | Not permanently stored — processed transiently | Data minimization |
| Payroll data (from integrations) | Not permanently stored — processed transiently | Data minimization |

**Note on integration data:** Data accessed from third-party integrations (e.g. employee records from Gusto) is processed transiently to fulfill agent actions. Raw integration data is not permanently stored in our systems. Only derived metadata, summaries, and audit logs are retained per the schedule above.

---

## 4. Data Destruction

### 4.1 Account Termination
Upon customer account termination:
- All OAuth tokens and API keys are immediately revoked and deleted
- Account and profile data is deleted within **30 days**
- Agent configurations and logs are deleted within **30 days**
- Billing records are retained for 7 years as required by law

### 4.2 Integration Disconnection
When a user disconnects a third-party integration:
- OAuth access and refresh tokens are **immediately deleted**
- API keys are **immediately deleted**
- Encrypted credentials are purged from the database

### 4.3 End of Retention Period
Data that has reached the end of its retention period is:
- Permanently deleted from production databases
- Purged from backups within the subsequent backup cycle
- Deleted from all log storage systems

### 4.4 Secure Deletion Standards
- Database records are hard-deleted (not soft-deleted) at end of retention
- Backups containing expired data are overwritten or destroyed within 30 days of the retention expiry
- Cloud provider storage (Railway, Supabase, Vercel) uses cryptographic erasure where permanent deletion cannot be guaranteed at the hardware level

---

## 5. Data Subject Deletion Requests

Customers and end users may request deletion of their personal data at any time by contacting info@rasisolutions.com.

Upon receiving a verified deletion request:
- We will confirm receipt within **5 business days**
- Data will be deleted within **30 days** of the verified request
- We will confirm completion of deletion in writing

We may retain data that is required by law (e.g. billing records) even following a deletion request, and will inform the requester of any such retention.

---

## 6. Third-Party Data

Data shared by third-party integration providers (e.g. Gusto employee and payroll data) is:
- Processed only for the purpose authorized by the customer
- Not permanently stored beyond transient processing
- Subject to the same deletion standards as all other customer data
- Returned or destroyed upon termination of the relevant integration or customer account

---

## 7. Backup and Recovery

- Production database backups are managed by Supabase with point-in-time recovery
- Backups are encrypted at rest
- Backups older than 30 days are automatically purged by the backup system

---

## 8. Policy Review

This policy is reviewed annually and updated following any significant change to our data processing activities, infrastructure, or applicable regulations.

**Policy Owner:** Rasi Cyber Solutions Leadership
**Contact:** info@rasisolutions.com
**Website:** www.rasisolutions.com
