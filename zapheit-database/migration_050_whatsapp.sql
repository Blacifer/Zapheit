-- migration_050_whatsapp.sql
-- WhatsApp Business (Cloud API) tables for message persistence,
-- contact management, and template sync.

-- ─── WhatsApp Messages ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  integration_id    UUID REFERENCES integrations(id) ON DELETE SET NULL,
  waba_id           VARCHAR(32) NOT NULL,
  phone_number_id   VARCHAR(32) NOT NULL,
  from_number       VARCHAR(20) NOT NULL,
  to_number         VARCHAR(20) NOT NULL,
  direction         VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type      VARCHAR(20) NOT NULL DEFAULT 'text'
                    CHECK (message_type IN ('text','image','document','audio','video','template','interactive','location','contacts','sticker','reaction')),
  content           TEXT NOT NULL DEFAULT '',
  media_url         TEXT,
  wa_message_id     VARCHAR(64) NOT NULL,
  wa_timestamp      TIMESTAMPTZ,
  status            VARCHAR(20) NOT NULL DEFAULT 'received'
                    CHECK (status IN ('sent','delivered','read','failed','received')),
  thread_phone      VARCHAR(20) NOT NULL,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (waba_id, wa_message_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_org        ON whatsapp_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_wa_messages_thread     ON whatsapp_messages(organization_id, thread_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_status     ON whatsapp_messages(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_messages_created    ON whatsapp_messages(created_at DESC);

-- ─── WhatsApp Contacts ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone             VARCHAR(20) NOT NULL,
  name              VARCHAR(255),
  wa_id             VARCHAR(20),
  opted_in          BOOLEAN NOT NULL DEFAULT false,
  opted_in_at       TIMESTAMPTZ,
  labels            JSONB NOT NULL DEFAULT '[]',
  last_message_at   TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_wa_contacts_org        ON whatsapp_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_labels     ON whatsapp_contacts USING gin(labels);

-- ─── WhatsApp Templates ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wa_template_id    VARCHAR(64),
  name              VARCHAR(255) NOT NULL,
  category          VARCHAR(30) NOT NULL DEFAULT 'UTILITY'
                    CHECK (category IN ('UTILITY','MARKETING','AUTHENTICATION')),
  language          VARCHAR(10) NOT NULL DEFAULT 'en',
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('APPROVED','PENDING','REJECTED','PAUSED','DISABLED')),
  body              TEXT NOT NULL DEFAULT '',
  header            JSONB,
  footer            TEXT,
  buttons           JSONB,
  last_synced_at    TIMESTAMPTZ,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (organization_id, wa_template_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_templates_org       ON whatsapp_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_wa_templates_status    ON whatsapp_templates(organization_id, status);

-- ─── Row Level Security ─────────────────────────────────────────────
ALTER TABLE whatsapp_messages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contacts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;

-- Messages: org members can SELECT + UPDATE status; INSERT via service role only
CREATE POLICY wa_messages_select ON whatsapp_messages
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
CREATE POLICY wa_messages_update ON whatsapp_messages
  FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Contacts: full CRUD for org members
CREATE POLICY wa_contacts_select ON whatsapp_contacts
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
CREATE POLICY wa_contacts_insert ON whatsapp_contacts
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
CREATE POLICY wa_contacts_update ON whatsapp_contacts
  FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
CREATE POLICY wa_contacts_delete ON whatsapp_contacts
  FOR DELETE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Templates: full CRUD for org members
CREATE POLICY wa_templates_select ON whatsapp_templates
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
CREATE POLICY wa_templates_insert ON whatsapp_templates
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
CREATE POLICY wa_templates_update ON whatsapp_templates
  FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
CREATE POLICY wa_templates_delete ON whatsapp_templates
  FOR DELETE USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );
