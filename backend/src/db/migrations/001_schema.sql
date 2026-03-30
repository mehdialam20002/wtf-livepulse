CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS gyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL,
  address TEXT,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance')),
  opens_at TIME NOT NULL DEFAULT '06:00',
  closes_at TIME NOT NULL DEFAULT '22:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly', 'quarterly', 'annual')),
  member_type TEXT NOT NULL DEFAULT 'new' CHECK (member_type IN ('new', 'renewal')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'frozen')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  plan_expires_at TIMESTAMPTZ NOT NULL,
  last_checkin_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_churn_risk
  ON members (last_checkin_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_members_gym_id
  ON members (gym_id);

CREATE TABLE IF NOT EXISTS checkins (
  id BIGSERIAL PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  checked_in TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_out TIMESTAMPTZ,
  duration_min INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN checked_out IS NOT NULL THEN (EXTRACT(EPOCH FROM (checked_out - checked_in)) / 60)::INTEGER
      ELSE NULL
    END
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_checkins_time_brin
  ON checkins USING BRIN (checked_in);

CREATE INDEX IF NOT EXISTS idx_checkins_live_occupancy
  ON checkins (gym_id, checked_out)
  WHERE checked_out IS NULL;

CREATE INDEX IF NOT EXISTS idx_checkins_member
  ON checkins (member_id, checked_in DESC);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  plan_type TEXT NOT NULL CHECK (plan_type IN ('monthly', 'quarterly', 'annual')),
  payment_type TEXT NOT NULL DEFAULT 'new' CHECK (payment_type IN ('new', 'renewal')),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_gym_date
  ON payments (gym_id, paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_date
  ON payments (paid_at DESC);

CREATE TABLE IF NOT EXISTS anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('zero_checkins', 'capacity_breach', 'revenue_drop')),
  severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
  message TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_anomalies_active
  ON anomalies (gym_id, detected_at DESC)
  WHERE resolved = FALSE;

DROP MATERIALIZED VIEW IF EXISTS gym_hourly_stats;
CREATE MATERIALIZED VIEW gym_hourly_stats AS
SELECT
  gym_id,
  EXTRACT(DOW FROM checked_in)::INTEGER AS day_of_week,
  EXTRACT(HOUR FROM checked_in)::INTEGER AS hour_of_day,
  COUNT(*) AS checkin_count
FROM checkins
WHERE checked_in >= NOW() - INTERVAL '7 days'
GROUP BY gym_id, day_of_week, hour_of_day
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_hourly_stats_unique
  ON gym_hourly_stats (gym_id, day_of_week, hour_of_day);

CREATE OR REPLACE VIEW live_event_feed AS
SELECT
  c.gym_id,
  m.name AS member_name,
  'checkin'::TEXT AS event_type,
  c.checked_in AS event_timestamp,
  NULL::NUMERIC AS amount
FROM checkins c
JOIN members m ON m.id = c.member_id
UNION ALL
SELECT
  c.gym_id,
  m.name AS member_name,
  'checkout'::TEXT AS event_type,
  c.checked_out AS event_timestamp,
  NULL::NUMERIC AS amount
FROM checkins c
JOIN members m ON m.id = c.member_id
WHERE c.checked_out IS NOT NULL
UNION ALL
SELECT
  p.gym_id,
  m.name AS member_name,
  'payment'::TEXT AS event_type,
  p.paid_at AS event_timestamp,
  p.amount
FROM payments p
JOIN members m ON m.id = p.member_id;
