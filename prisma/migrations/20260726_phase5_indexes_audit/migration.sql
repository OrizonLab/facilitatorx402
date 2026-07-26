-- Phase 5: Add performance indexes and audit trail enhancements
-- These are additive — no destructive changes

-- ─── payment_requests indexes ───────────────────────────────────────────────

-- Lookup by seller (operator dashboard)
CREATE INDEX IF NOT EXISTS idx_payment_requests_seller
  ON payment_requests (seller);

-- Lookup by invoice_id (idempotence check at application layer)
CREATE INDEX IF NOT EXISTS idx_payment_requests_invoice_id
  ON payment_requests (invoice_id);

-- Retention / purge by date
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at
  ON payment_requests (created_at);

-- ─── payment_verifications indexes ─────────────────────────────────────────

-- Fast accepted-verification lookup for settle
CREATE INDEX IF NOT EXISTS idx_payment_verifications_request_status
  ON payment_verifications (request_id, verification_status);

-- Retention by date
CREATE INDEX IF NOT EXISTS idx_payment_verifications_created_at
  ON payment_verifications (created_at);

-- ─── payment_settlements indexes ───────────────────────────────────────────

-- Idempotence check (confirmed settlement by requestId)
CREATE INDEX IF NOT EXISTS idx_payment_settlements_request_status
  ON payment_settlements (request_id, settlement_status);

-- Referral analytics
CREATE INDEX IF NOT EXISTS idx_payment_settlements_referral_code
  ON payment_settlements (referral_code)
  WHERE referral_code IS NOT NULL;

-- Retention by date
CREATE INDEX IF NOT EXISTS idx_payment_settlements_created_at
  ON payment_settlements (created_at);

-- ─── payment_receipts indexes ─────────────────────────────────────────────

-- Fast lookup receipt by requestId (seller support)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_receipts_request_id
  ON payment_receipts (request_id);

-- Retention by date
CREATE INDEX IF NOT EXISTS idx_payment_receipts_created_at
  ON payment_receipts (created_at);

-- ─── audit_logs indexes ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON audit_logs (entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
  ON audit_logs (created_at);
