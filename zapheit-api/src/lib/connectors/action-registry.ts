// ---------------------------------------------------------------------------
// Connector Action Registry
// OpenAI function-calling tool schemas for each supported connector.
// Tool name format: {connectorId}__{action} (double underscore for easy parsing)
// ---------------------------------------------------------------------------

export type ConnectorToolParameter = {
  type: string;
  description: string;
  enum?: string[];
};

export type ConnectorTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ConnectorToolParameter>;
      required: string[];
    };
  };
};

export type ConnectorActionSchema = {
  connectorId: string;
  tools: ConnectorTool[];
};

export const ACTION_REGISTRY: Record<string, ConnectorActionSchema> = {
  // ─── Zendesk ──────────────────────────────────────────────────────────────
  zendesk: {
    connectorId: 'zendesk',
    tools: [
      {
        type: 'function',
        function: {
          name: 'zendesk__get_ticket',
          description: 'Retrieve a specific Zendesk support ticket by its ID.',
          parameters: {
            type: 'object',
            properties: {
              ticket_id: { type: 'string', description: 'The Zendesk ticket ID (numeric)' },
            },
            required: ['ticket_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'zendesk__update_ticket',
          description: 'Update a Zendesk ticket status, priority, or assignee.',
          parameters: {
            type: 'object',
            properties: {
              ticket_id: { type: 'string', description: 'The Zendesk ticket ID' },
              status: { type: 'string', description: 'New status', enum: ['open', 'pending', 'solved', 'closed'] },
              priority: { type: 'string', description: 'New priority', enum: ['low', 'normal', 'high', 'urgent'] },
              assignee_id: { type: 'string', description: 'Agent ID to assign the ticket to' },
            },
            required: ['ticket_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'zendesk__create_ticket',
          description: 'Create a new Zendesk support ticket.',
          parameters: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Ticket subject line' },
              body: { type: 'string', description: 'Ticket description body' },
              requester_email: { type: 'string', description: 'Email of the requester' },
              priority: { type: 'string', description: 'Ticket priority', enum: ['low', 'normal', 'high', 'urgent'] },
            },
            required: ['subject', 'body', 'requester_email'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'zendesk__add_comment',
          description: 'Add a public reply or internal note to a Zendesk ticket.',
          parameters: {
            type: 'object',
            properties: {
              ticket_id: { type: 'string', description: 'The Zendesk ticket ID' },
              comment: { type: 'string', description: 'The comment text to add' },
              public: { type: 'string', description: 'true for public reply, false for internal note', enum: ['true', 'false'] },
            },
            required: ['ticket_id', 'comment'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'zendesk__search_tickets',
          description: 'Search Zendesk tickets by keyword or filter.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query string' },
              status: { type: 'string', description: 'Filter by status', enum: ['open', 'pending', 'solved', 'closed'] },
              limit: { type: 'string', description: 'Max results to return (default 10)' },
            },
            required: ['query'],
          },
        },
      },
    ],
  },

  // ─── Slack ────────────────────────────────────────────────────────────────
  slack: {
    connectorId: 'slack',
    tools: [
      {
        type: 'function',
        function: {
          name: 'slack__send_message',
          description: 'Send a message to a Slack channel or user.',
          parameters: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel name (e.g. #general) or user ID' },
              text: { type: 'string', description: 'Message text to send' },
            },
            required: ['channel', 'text'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'slack__get_channel_history',
          description: 'Retrieve recent messages from a Slack channel.',
          parameters: {
            type: 'object',
            properties: {
              channel: { type: 'string', description: 'Channel name or ID' },
              limit: { type: 'string', description: 'Number of messages to return (default 10)' },
            },
            required: ['channel'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'slack__get_user_info',
          description: 'Look up a Slack user by email or user ID.',
          parameters: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Email address to look up' },
              user_id: { type: 'string', description: 'Slack user ID (alternative to email)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'slack__list_channels',
          description: 'List public Slack channels in the workspace.',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'string', description: 'Max channels to return (default 20)' },
            },
            required: [],
          },
        },
      },
    ],
  },

  // ─── Salesforce ───────────────────────────────────────────────────────────
  salesforce: {
    connectorId: 'salesforce',
    tools: [
      {
        type: 'function',
        function: {
          name: 'salesforce__get_lead',
          description: 'Retrieve a Salesforce Lead record by ID.',
          parameters: {
            type: 'object',
            properties: {
              lead_id: { type: 'string', description: 'Salesforce Lead record ID' },
            },
            required: ['lead_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'salesforce__update_lead',
          description: 'Update a Salesforce Lead record fields.',
          parameters: {
            type: 'object',
            properties: {
              lead_id: { type: 'string', description: 'Salesforce Lead record ID' },
              status: { type: 'string', description: 'New lead status (e.g. "Qualified", "Working")' },
              rating: { type: 'string', description: 'Lead rating (Hot/Warm/Cold)' },
              description: { type: 'string', description: 'Notes to add to the lead description' },
            },
            required: ['lead_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'salesforce__create_task',
          description: 'Create a follow-up task in Salesforce linked to a record.',
          parameters: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Task subject line' },
              who_id: { type: 'string', description: 'Lead or Contact ID to link the task to' },
              what_id: { type: 'string', description: 'Opportunity or Account ID to link (optional)' },
              due_date: { type: 'string', description: 'Due date in YYYY-MM-DD format' },
              description: { type: 'string', description: 'Task description or notes' },
            },
            required: ['subject'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'salesforce__search_records',
          description: 'Search Salesforce records using SOSL query.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'SOSL search string or keyword' },
              object_type: { type: 'string', description: 'Object type to search (Lead, Contact, Opportunity, Account)', enum: ['Lead', 'Contact', 'Opportunity', 'Account'] },
              limit: { type: 'string', description: 'Max results (default 10)' },
            },
            required: ['query'],
          },
        },
      },
    ],
  },

  // ─── HubSpot ──────────────────────────────────────────────────────────────
  hubspot: {
    connectorId: 'hubspot',
    tools: [
      {
        type: 'function',
        function: {
          name: 'hubspot__get_contact',
          description: 'Retrieve a HubSpot contact by ID or email.',
          parameters: {
            type: 'object',
            properties: {
              contact_id: { type: 'string', description: 'HubSpot contact ID' },
              email: { type: 'string', description: 'Email address (alternative to contact_id)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'hubspot__create_contact',
          description: 'Create a new HubSpot contact.',
          parameters: {
            type: 'object',
            properties: {
              email: { type: 'string', description: 'Contact email address' },
              firstname: { type: 'string', description: 'First name' },
              lastname: { type: 'string', description: 'Last name' },
              company: { type: 'string', description: 'Company name' },
              phone: { type: 'string', description: 'Phone number' },
            },
            required: ['email'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'hubspot__update_deal',
          description: 'Update a HubSpot deal stage or properties.',
          parameters: {
            type: 'object',
            properties: {
              deal_id: { type: 'string', description: 'HubSpot deal ID' },
              dealstage: { type: 'string', description: 'New deal stage ID' },
              amount: { type: 'string', description: 'Deal amount' },
              closedate: { type: 'string', description: 'Expected close date in YYYY-MM-DD format' },
            },
            required: ['deal_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'hubspot__search_contacts',
          description: 'Search HubSpot contacts by name, email, or company.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query string' },
              limit: { type: 'string', description: 'Max results to return (default 10)' },
            },
            required: ['query'],
          },
        },
      },
    ],
  },

  // ─── Razorpay ─────────────────────────────────────────────────────────────
  razorpay: {
    connectorId: 'razorpay',
    tools: [
      {
        type: 'function',
        function: {
          name: 'razorpay__get_order',
          description: 'Retrieve a Razorpay order by ID.',
          parameters: {
            type: 'object',
            properties: {
              order_id: { type: 'string', description: 'Razorpay order ID (order_...)' },
            },
            required: ['order_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'razorpay__initiate_refund',
          description: 'Initiate a refund for a Razorpay payment.',
          parameters: {
            type: 'object',
            properties: {
              payment_id: { type: 'string', description: 'Razorpay payment ID (pay_...)' },
              amount: { type: 'string', description: 'Refund amount in paise (leave empty for full refund)' },
              notes: { type: 'string', description: 'Reason or notes for the refund' },
            },
            required: ['payment_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'razorpay__list_payments',
          description: 'List recent Razorpay payments for the account.',
          parameters: {
            type: 'object',
            properties: {
              count: { type: 'string', description: 'Number of payments to return (default 10, max 100)' },
              from: { type: 'string', description: 'Unix timestamp to fetch payments from' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'razorpay__get_settlement',
          description: 'Get details of a specific Razorpay settlement.',
          parameters: {
            type: 'object',
            properties: {
              settlement_id: { type: 'string', description: 'Razorpay settlement ID (setl_...)' },
            },
            required: ['settlement_id'],
          },
        },
      },
    ],
  },

  // ─── Paytm ────────────────────────────────────────────────────────────────
  paytm: {
    connectorId: 'paytm',
    tools: [
      {
        type: 'function',
        function: {
          name: 'paytm__get_payment_status',
          description: 'Retrieve the current status of a Paytm payment or transaction.',
          parameters: {
            type: 'object',
            properties: {
              payment_id: { type: 'string', description: 'Paytm payment or order identifier' },
            },
            required: ['payment_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'paytm__list_transactions',
          description: 'List recent Paytm transactions for monitoring or reconciliation.',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'string', description: 'Number of transactions to return (default 10)' },
              status: { type: 'string', description: 'Optional status filter such as SUCCESS or FAILED' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'paytm__create_refund',
          description: 'Create a governed refund request in Paytm for a specific payment.',
          parameters: {
            type: 'object',
            properties: {
              payment_id: { type: 'string', description: 'Original Paytm payment identifier' },
              amount: { type: 'string', description: 'Refund amount in minor units' },
              reason: { type: 'string', description: 'Refund reason for audit and customer communication' },
            },
            required: ['payment_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'paytm__initiate_payout',
          description: 'Initiate a payout through Paytm after policy and approval checks.',
          parameters: {
            type: 'object',
            properties: {
              beneficiary_id: { type: 'string', description: 'Beneficiary identifier in Paytm' },
              amount: { type: 'string', description: 'Payout amount in minor units' },
              reference_id: { type: 'string', description: 'Internal payout reference or invoice ID' },
              note: { type: 'string', description: 'Optional payout note' },
            },
            required: ['beneficiary_id', 'amount'],
          },
        },
      },
    ],
  },

  // ─── Tally ────────────────────────────────────────────────────────────────
  tally: {
    connectorId: 'tally',
    tools: [
      {
        type: 'function',
        function: {
          name: 'tally__list_ledgers',
          description: 'Read ledger records from Tally for finance review and reconciliation.',
          parameters: {
            type: 'object',
            properties: {
              company_name: { type: 'string', description: 'Optional Tally company name override' },
              limit: { type: 'string', description: 'Max ledger rows to return when supported' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'tally__list_vouchers',
          description: 'Read voucher or journal data from Tally for reconciliation workflows.',
          parameters: {
            type: 'object',
            properties: {
              company_name: { type: 'string', description: 'Optional Tally company name override' },
              from_date: { type: 'string', description: 'Optional start date in YYYYMMDD' },
              to_date: { type: 'string', description: 'Optional end date in YYYYMMDD' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'tally__post_voucher',
          description: 'Post a voucher or journal entry into Tally after governed approval.',
          parameters: {
            type: 'object',
            properties: {
              voucher_xml: { type: 'string', description: 'Complete voucher XML payload ready for Tally import' },
            },
            required: ['voucher_xml'],
          },
        },
      },
    ],
  },

  // ─── Naukri ───────────────────────────────────────────────────────────────
  naukri: {
    connectorId: 'naukri',
    tools: [
      {
        type: 'function',
        function: {
          name: 'naukri__search_candidates',
          description: 'Search Naukri candidate profiles using a role, skill, or free-text query.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query or skill keywords' },
              job_id: { type: 'string', description: 'Optional job opening identifier' },
              limit: { type: 'string', description: 'Max candidates to return (default 10)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'naukri__get_candidate',
          description: 'Fetch a specific candidate profile from Naukri.',
          parameters: {
            type: 'object',
            properties: {
              candidate_id: { type: 'string', description: 'Naukri candidate identifier' },
            },
            required: ['candidate_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'naukri__create_job',
          description: 'Publish a new job opening to Naukri through a governed action.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Job title' },
              description: { type: 'string', description: 'Job description or summary' },
              location: { type: 'string', description: 'Job location' },
              employment_type: { type: 'string', description: 'Optional employment type' },
            },
            required: ['title', 'description'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'naukri__parse_resume',
          description: 'Parse a resume document through Naukri for structured candidate extraction.',
          parameters: {
            type: 'object',
            properties: {
              resume_text: { type: 'string', description: 'Raw resume text when file upload is not available' },
              candidate_id: { type: 'string', description: 'Optional existing candidate identifier' },
            },
            required: [],
          },
        },
      },
    ],
  },

  // ─── ClearTax ─────────────────────────────────────────────────────────────
  cleartax: {
    connectorId: 'cleartax',
    tools: [
      {
        type: 'function',
        function: {
          name: 'cleartax__get_compliance_status',
          description: 'Retrieve current ClearTax compliance posture for the connected entity.',
          parameters: {
            type: 'object',
            properties: {
              gstin: { type: 'string', description: 'Optional GSTIN override for the lookup' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cleartax__list_notices',
          description: 'Read tax notices or alerts from ClearTax for compliance investigation.',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'string', description: 'Maximum number of notices to return' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cleartax__calculate_tds',
          description: 'Calculate TDS using ClearTax with structured input payloads.',
          parameters: {
            type: 'object',
            properties: {
              payload: { type: 'string', description: 'JSON string payload for the TDS calculation request' },
            },
            required: ['payload'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'cleartax__file_gst_return',
          description: 'Submit a GST return through ClearTax after approval and evidence capture.',
          parameters: {
            type: 'object',
            properties: {
              payload: { type: 'string', description: 'JSON string payload describing the GST return submission' },
            },
            required: ['payload'],
          },
        },
      },
    ],
  },

  // ─── Framework stubs — executor not yet built; tools visible in UI ────────
  // The action-executor.ts default case returns 501 for these connectors.

  'google_workspace': {
    connectorId: 'google_workspace',
    tools: [
      {
        type: 'function',
        function: {
          name: 'google_workspace__list_files',
          description: 'List files in Google Drive matching a search query.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Drive search query (e.g. "name contains \'report\'")' },
              limit: { type: 'number', description: 'Max results to return (default 10)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'google_workspace__create_document',
          description: 'Create a new Google Doc with the given title and content.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Document title' },
              content: { type: 'string', description: 'Initial body text' },
            },
            required: ['title'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'google_workspace__send_email',
          description: 'Send an email via Gmail on behalf of the authenticated user.',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Recipient email address' },
              subject: { type: 'string', description: 'Email subject' },
              body: { type: 'string', description: 'Email body (plain text)' },
            },
            required: ['to', 'subject', 'body'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'google_workspace__list_calendar_events',
          description: 'List upcoming Google Calendar events for the authenticated user.',
          parameters: {
            type: 'object',
            properties: {
              days_ahead: { type: 'number', description: 'How many days forward to look (default 7)' },
              limit: { type: 'number', description: 'Max events to return (default 10)' },
            },
            required: [],
          },
        },
      },
    ],
  },

  'google-workspace': {
    connectorId: 'google-workspace',
    tools: [
      {
        type: 'function',
        function: {
          name: 'google-workspace__list_files',
          description: 'List files in Google Drive matching a search query.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Drive search query (e.g. "name contains \'report\'")' },
              limit: { type: 'number', description: 'Max results to return (default 10)' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'google-workspace__create_document',
          description: 'Create a new Google Doc with the given title and content.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Document title' },
              content: { type: 'string', description: 'Initial body text' },
            },
            required: ['title'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'google-workspace__send_email',
          description: 'Send an email via Gmail on behalf of the authenticated user.',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Recipient email address' },
              subject: { type: 'string', description: 'Email subject' },
              body: { type: 'string', description: 'Email body (plain text)' },
            },
            required: ['to', 'subject', 'body'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'google-workspace__list_calendar_events',
          description: 'List upcoming Google Calendar events for the authenticated user.',
          parameters: {
            type: 'object',
            properties: {
              days_ahead: { type: 'number', description: 'How many days forward to look (default 7)' },
              limit: { type: 'number', description: 'Max events to return (default 10)' },
            },
            required: [],
          },
        },
      },
    ],
  },

  'microsoft-365': {
    connectorId: 'microsoft-365',
    tools: [
      {
        type: 'function',
        function: {
          name: 'microsoft-365__send_email',
          description: 'Send an email via Microsoft Outlook on behalf of the authenticated user.',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Recipient email address' },
              subject: { type: 'string', description: 'Email subject' },
              body: { type: 'string', description: 'Email body (plain text or HTML)' },
            },
            required: ['to', 'subject', 'body'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'microsoft-365__list_emails',
          description: 'List recent emails from the authenticated user\'s Outlook inbox.',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max emails to return (default 10)' },
              folder: { type: 'string', description: 'Folder name (default: inbox)', enum: ['inbox', 'sent', 'drafts'] },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'microsoft-365__create_calendar_event',
          description: 'Create a calendar event in the authenticated user\'s Outlook calendar.',
          parameters: {
            type: 'object',
            properties: {
              subject: { type: 'string', description: 'Event title' },
              start: { type: 'string', description: 'Start time in ISO 8601 (e.g. 2025-03-21T14:00:00)' },
              end: { type: 'string', description: 'End time in ISO 8601' },
              attendees: { type: 'string', description: 'Comma-separated attendee email addresses' },
            },
            required: ['subject', 'start', 'end'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'microsoft-365__list_teams_channels',
          description: 'List Microsoft Teams channels available to the authenticated user.',
          parameters: {
            type: 'object',
            properties: {
              team_id: { type: 'string', description: 'Teams group/team ID (optional — lists all teams if omitted)' },
            },
            required: [],
          },
        },
      },
    ],
  },

  zoho: {
    connectorId: 'zoho',
    tools: [
      {
        type: 'function',
        function: {
          name: 'zoho__get_contact',
          description: 'Retrieve a Zoho CRM contact by ID or email.',
          parameters: {
            type: 'object',
            properties: {
              contact_id: { type: 'string', description: 'Zoho contact record ID' },
              email: { type: 'string', description: 'Contact email (alternative to contact_id)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'zoho__create_lead',
          description: 'Create a new lead record in Zoho CRM.',
          parameters: {
            type: 'object',
            properties: {
              first_name: { type: 'string', description: 'Lead first name' },
              last_name: { type: 'string', description: 'Lead last name' },
              email: { type: 'string', description: 'Lead email address' },
              company: { type: 'string', description: 'Lead company name' },
            },
            required: ['last_name', 'email'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'zoho__update_deal',
          description: 'Update the stage, amount, or close date of a Zoho CRM deal.',
          parameters: {
            type: 'object',
            properties: {
              deal_id: { type: 'string', description: 'Zoho deal record ID' },
              stage: { type: 'string', description: 'New deal stage' },
              amount: { type: 'number', description: 'Updated deal amount' },
              close_date: { type: 'string', description: 'Expected close date (YYYY-MM-DD)' },
            },
            required: ['deal_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'zoho__search_records',
          description: 'Search Zoho CRM records across contacts, leads, or deals.',
          parameters: {
            type: 'object',
            properties: {
              module: { type: 'string', description: 'Module to search', enum: ['Contacts', 'Leads', 'Deals', 'Accounts'] },
              query: { type: 'string', description: 'Search keyword' },
              limit: { type: 'number', description: 'Max results (default 10)' },
            },
            required: ['module', 'query'],
          },
        },
      },
    ],
  },

  deel: {
    connectorId: 'deel',
    tools: [
      {
        type: 'function',
        function: {
          name: 'deel__list_workers',
          description: 'List workers (employees and contractors) in the Deel organization.',
          parameters: {
            type: 'object',
            properties: {
              status: { type: 'string', description: 'Filter by status', enum: ['active', 'inactive', 'all'] },
              limit: { type: 'number', description: 'Max results (default 20)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'deel__get_contract',
          description: 'Retrieve a Deel contract by ID.',
          parameters: {
            type: 'object',
            properties: {
              contract_id: { type: 'string', description: 'Deel contract ID' },
            },
            required: ['contract_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'deel__list_payments',
          description: 'List recent payments made through Deel.',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max results (default 20)' },
              status: { type: 'string', description: 'Filter by payment status', enum: ['paid', 'pending', 'failed'] },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'deel__create_payment',
          description: 'Initiate a payment to a worker via Deel.',
          parameters: {
            type: 'object',
            properties: {
              contract_id: { type: 'string', description: 'Deel contract ID for the worker' },
              amount: { type: 'number', description: 'Payment amount in the contract currency' },
              description: { type: 'string', description: 'Payment description or memo' },
            },
            required: ['contract_id', 'amount'],
          },
        },
      },
    ],
  },

  gusto: {
    connectorId: 'gusto',
    tools: [
      {
        type: 'function',
        function: {
          name: 'gusto__list_employees',
          description: 'List all employees in the Gusto company.',
          parameters: {
            type: 'object',
            properties: {
              active_only: { type: 'boolean', description: 'Return only active employees (default true)' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'gusto__get_employee',
          description: 'Retrieve detailed information about a specific Gusto employee.',
          parameters: {
            type: 'object',
            properties: {
              employee_id: { type: 'string', description: 'Gusto employee UUID' },
            },
            required: ['employee_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'gusto__get_payroll',
          description: 'Retrieve a Gusto payroll run by ID.',
          parameters: {
            type: 'object',
            properties: {
              payroll_id: { type: 'string', description: 'Gusto payroll UUID' },
            },
            required: ['payroll_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'gusto__run_payroll',
          description: 'Submit (finalize) a prepared Gusto payroll run for processing.',
          parameters: {
            type: 'object',
            properties: {
              payroll_id: { type: 'string', description: 'Gusto payroll UUID to finalize' },
            },
            required: ['payroll_id'],
          },
        },
      },
    ],
  },

  'linkedin-recruiter': {
    connectorId: 'linkedin-recruiter',
    tools: [
      {
        type: 'function',
        function: {
          name: 'linkedin-recruiter__search_candidates',
          description: 'Search LinkedIn Recruiter for candidates matching given criteria.',
          parameters: {
            type: 'object',
            properties: {
              keywords: { type: 'string', description: 'Skills or keywords to search for' },
              location: { type: 'string', description: 'Candidate location (city or country)' },
              limit: { type: 'number', description: 'Max results (default 10)' },
            },
            required: ['keywords'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'linkedin-recruiter__get_profile',
          description: 'Get a LinkedIn member profile by member URN or profile URL.',
          parameters: {
            type: 'object',
            properties: {
              profile_id: { type: 'string', description: 'LinkedIn member URN or public profile URL' },
            },
            required: ['profile_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'linkedin-recruiter__send_inmail',
          description: 'Send an InMail message to a LinkedIn member via Recruiter.',
          parameters: {
            type: 'object',
            properties: {
              profile_id: { type: 'string', description: 'Recipient LinkedIn member URN' },
              subject: { type: 'string', description: 'InMail subject line' },
              body: { type: 'string', description: 'InMail message body' },
            },
            required: ['profile_id', 'subject', 'body'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'linkedin-recruiter__list_job_postings',
          description: 'List active job postings from the connected LinkedIn Recruiter account.',
          parameters: {
            type: 'object',
            properties: {
              limit: { type: 'number', description: 'Max postings to return (default 10)' },
            },
            required: [],
          },
        },
      },
    ],
  },
};
