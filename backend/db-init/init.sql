CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE gyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  opens_at TIME,
  closes_at TIME
);

CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id UUID REFERENCES gyms(id),
  name TEXT,
  email TEXT,
  phone TEXT,
  plan_type TEXT,
  member_type TEXT,
  status TEXT,
  joined_at TIMESTAMP,
  plan_expires_at TIMESTAMP,
  last_checkin_at TIMESTAMP
);

CREATE TABLE checkins (
  id SERIAL PRIMARY KEY,
  member_id UUID REFERENCES members(id),
  gym_id UUID REFERENCES gyms(id),
  checked_in TIMESTAMP,
  checked_out TIMESTAMP
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id),
  gym_id UUID REFERENCES gyms(id),
  amount NUMERIC,
  plan_type TEXT,
  payment_type TEXT,
  paid_at TIMESTAMP
);

INSERT INTO gyms (name, city, capacity, status, opens_at, closes_at) VALUES
('WTF Gyms - Lajpat Nagar', 'New Delhi', 220, 'active', '05:30', '22:30'),
('WTF Gyms - Connaught Place', 'New Delhi', 180, 'active', '06:00', '22:00'),
('WTF Gyms - Bandra West', 'Mumbai', 300, 'active', '05:00', '23:00'),
('WTF Gyms - Powai', 'Mumbai', 250, 'active', '05:30', '22:30'),
('WTF Gyms - Indiranagar', 'Bengaluru', 200, 'active', '05:30', '22:00'),
('WTF Gyms - Koramangala', 'Bengaluru', 180, 'active', '06:00', '22:00'),
('WTF Gyms - Banjara Hills', 'Hyderabad', 160, 'active', '06:00', '22:00'),
('WTF Gyms - Sector 18 Noida', 'Noida', 140, 'active', '06:00', '21:30'),
('WTF Gyms - Salt Lake', 'Kolkata', 120, 'active', '06:00', '21:00'),
('WTF Gyms - Velachery', 'Chennai', 110, 'active', '06:00', '21:00');
