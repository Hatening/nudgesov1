-- FinancialGuard: financial escalations must be high-risk, financial and urgent.
-- Keep legacy `risk` for compatibility; add explicit queue fields.

ALTER TABLE escalations ADD COLUMN risk_level TEXT NOT NULL DEFAULT 'high'
  CHECK (risk_level IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE escalations ADD COLUMN category TEXT NOT NULL DEFAULT 'general';

ALTER TABLE escalations ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal', 'high', 'urgent'));

UPDATE escalations
SET risk_level = CASE
  WHEN risk IN ('critical', 'high') THEN risk
  WHEN risk = 'medium' THEN 'medium'
  WHEN risk = 'low' THEN 'low'
  ELSE 'high'
END
WHERE risk_level = 'high' AND risk IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_escalations_financial_priority
  ON escalations(category, priority, status, created_at);
