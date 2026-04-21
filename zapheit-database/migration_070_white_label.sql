-- migration_070_white_label.sql
-- P4-08: White-label program — custom logo, domain, email templates per org

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS white_label_enabled  boolean NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_logo_url          text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_primary_color     text;   -- hex e.g. #1a73e8
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_custom_domain     text;   -- e.g. ai.acme.com
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_product_name      text;   -- replaces "Zapheit" in UI
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_support_email     text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS wl_email_from_name   text;   -- sender display name

CREATE UNIQUE INDEX IF NOT EXISTS organizations_wl_domain_idx ON organizations (wl_custom_domain) WHERE wl_custom_domain IS NOT NULL;
