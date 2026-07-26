-- Phase 11-12: Sellers API Key management + Webhooks

-- Sellers table (devices, AI agents, robots, servers)
CREATE TABLE IF NOT EXISTS sellers (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  api_key_hash  TEXT NOT NULL UNIQUE,   -- bcrypt hash of the API key
  wallet_address TEXT NOT NULL,          -- custodial wallet managed by facilitator
  referral_code TEXT,
  device_type   TEXT NOT NULL DEFAULT 'server', -- 'server' | 'robot' | 'iot' | 'agent'
  webhook_url   TEXT,                    -- convenience field for single-webhook sellers
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_sellers_api_key_hash ON sellers(api_key_hash);
CREATE INDEX idx_sellers_device_type  ON sellers(device_type);

-- Webhook subscriptions
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id          TEXT PRIMARY KEY,
  seller_id   TEXT NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  events      TEXT[] NOT NULL,          -- ['settlement.confirmed', 'settlement.failed', ...]
  secret      TEXT NOT NULL,            -- HMAC-SHA256 signing secret for verification
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhooks_seller_id ON webhook_subscriptions(seller_id);
CREATE INDEX idx_webhooks_active    ON webhook_subscriptions(active);

-- Webhook deliveries (audit trail + retry tracking)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  event           TEXT NOT NULL,
  payload         JSONB NOT NULL,
  attempt         INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'delivered' | 'failed'
  http_status     INTEGER,
  response_body   TEXT,
  next_retry_at   TIMESTAMP WITH TIME ZONE,
  delivered_at    TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_webhook_deliveries_sub_id ON webhook_deliveries(subscription_id);
CREATE INDEX idx_webhook_deliveries_status ON webhook_deliveries(status);
CREATE INDEX idx_webhook_deliveries_retry  ON webhook_deliveries(next_retry_at) WHERE status = 'pending';
