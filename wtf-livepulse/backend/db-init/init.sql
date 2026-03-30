CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE gyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  city TEXT,
  capacity INT,
  status TEXT,
  opens_at TIME,
  closes_at TIME
);

CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID,
  name TEXT,
  plan_type TEXT,
  status TEXT,
  last_checkin_at TIMESTAMP
);

CREATE TABLE checkins (
  id SERIAL PRIMARY KEY,
  member_id UUID,
  gym_id UUID,
  checked_in TIMESTAMP,
  checked_out TIMESTAMP
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID,
  gym_id UUID,
  amount NUMERIC,
  paid_at TIMESTAMP
);

CREATE TABLE anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID,
  type TEXT,
  severity TEXT,
  message TEXT,
  resolved BOOLEAN DEFAULT false,
  detected_at TIMESTAMP DEFAULT NOW()
);