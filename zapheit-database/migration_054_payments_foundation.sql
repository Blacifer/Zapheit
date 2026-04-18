BEGIN;

CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'cashfree',
  offer_code VARCHAR(64) NOT NULL,
  offer_name VARCHAR(255) NOT NULL,
  merchant_order_id VARCHAR(64) NOT NULL UNIQUE,
  provider_order_id VARCHAR(64) UNIQUE,
  provider_payment_session_id TEXT,
  provider_order_status VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'pending', 'paid', 'failed', 'cancelled', 'expired')),
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(32) NOT NULL,
  company_name VARCHAR(255),
  return_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_org_created
  ON payment_orders(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_org_status
  ON payment_orders(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_merchant_order_id
  ON payment_orders(merchant_order_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  payment_order_id UUID REFERENCES payment_orders(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL DEFAULT 'cashfree',
  provider_event_id VARCHAR(128),
  event_type VARCHAR(128) NOT NULL,
  event_status VARCHAR(32) NOT NULL DEFAULT 'received',
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_events_order_created
  ON payment_events(payment_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_org_created
  ON payment_events(organization_id, created_at DESC);

ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_orders_select ON payment_orders
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY payment_orders_insert ON payment_orders
  FOR INSERT WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY payment_orders_update ON payment_orders
  FOR UPDATE USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

CREATE POLICY payment_events_select ON payment_events
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM users WHERE id = auth.uid()
    )
  );

COMMIT;