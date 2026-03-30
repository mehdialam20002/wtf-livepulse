DO $$
DECLARE
  member_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO member_count FROM members;

  IF member_count > 0 THEN
    RAISE NOTICE 'Seed skipped: members already exist.';
    RETURN;
  END IF;

  RAISE NOTICE 'Seeding gyms...';

  INSERT INTO gyms (name, city, address, capacity, status, opens_at, closes_at)
  VALUES
    ('WTF Gyms — Lajpat Nagar', 'New Delhi', 'Lajpat Nagar, New Delhi', 220, 'active', '05:30', '22:30'),
    ('WTF Gyms — Connaught Place', 'New Delhi', 'Connaught Place, New Delhi', 180, 'active', '06:00', '22:00'),
    ('WTF Gyms — Bandra West', 'Mumbai', 'Bandra West, Mumbai', 300, 'active', '05:00', '23:00'),
    ('WTF Gyms — Powai', 'Mumbai', 'Powai, Mumbai', 250, 'active', '05:30', '22:30'),
    ('WTF Gyms — Indiranagar', 'Bengaluru', 'Indiranagar, Bengaluru', 200, 'active', '05:30', '22:00'),
    ('WTF Gyms — Koramangala', 'Bengaluru', 'Koramangala, Bengaluru', 180, 'active', '06:00', '22:00'),
    ('WTF Gyms — Banjara Hills', 'Hyderabad', 'Banjara Hills, Hyderabad', 160, 'active', '06:00', '22:00'),
    ('WTF Gyms — Sector 18 Noida', 'Noida', 'Sector 18, Noida', 140, 'active', '06:00', '21:30'),
    ('WTF Gyms — Salt Lake', 'Kolkata', 'Salt Lake, Kolkata', 120, 'active', '06:00', '21:00'),
    ('WTF Gyms — Velachery', 'Chennai', 'Velachery, Chennai', 110, 'active', '06:00', '21:00');

  RAISE NOTICE 'Seeding member distribution...';

  CREATE TEMP TABLE gym_seed_config (
    gym_name TEXT,
    member_count INTEGER,
    monthly_count INTEGER,
    quarterly_count INTEGER,
    annual_count INTEGER,
    active_count INTEGER,
    inactive_count INTEGER,
    frozen_count INTEGER
  ) ON COMMIT DROP;

  INSERT INTO gym_seed_config VALUES
    ('WTF Gyms — Lajpat Nagar', 650, 325, 195, 130, 572, 52, 26),
    ('WTF Gyms — Connaught Place', 550, 220, 220, 110, 468, 54, 28),
    ('WTF Gyms — Bandra West', 750, 300, 300, 150, 675, 50, 25),
    ('WTF Gyms — Powai', 600, 240, 240, 120, 522, 52, 26),
    ('WTF Gyms — Indiranagar', 550, 220, 220, 110, 490, 40, 20),
    ('WTF Gyms — Koramangala', 500, 200, 200, 100, 430, 46, 24),
    ('WTF Gyms — Banjara Hills', 450, 225, 135, 90, 378, 48, 24),
    ('WTF Gyms — Sector 18 Noida', 400, 240, 100, 60, 328, 48, 24),
    ('WTF Gyms — Salt Lake', 300, 180, 90, 30, 240, 36, 24),
    ('WTF Gyms — Velachery', 250, 150, 75, 25, 195, 35, 20);

  CREATE TEMP TABLE temp_members (
    seq BIGSERIAL PRIMARY KEY,
    gym_id UUID,
    gym_name TEXT,
    name TEXT,
    email TEXT,
    phone TEXT,
    plan_type TEXT,
    member_type TEXT,
    status TEXT,
    joined_at TIMESTAMPTZ,
    plan_expires_at TIMESTAMPTZ,
    target_last_checkin TIMESTAMPTZ
  ) ON COMMIT DROP;

  INSERT INTO temp_members (
    gym_id,
    gym_name,
    name,
    email,
    phone,
    plan_type,
    member_type,
    status,
    joined_at,
    plan_expires_at,
    target_last_checkin
  )
  SELECT
    g.id,
    g.name,
    CONCAT(
      (ARRAY['Aarav','Vihaan','Reyansh','Kabir','Arjun','Advait','Rahul','Rohan','Aryan','Ishaan','Priya','Neha','Ananya','Aisha','Sanya','Kavya','Ritika','Meera','Diya','Ira'])[(gs.n % 20) + 1],
      ' ',
      (ARRAY['Sharma','Verma','Mehta','Gupta','Patel','Nair','Reddy','Kapoor','Yadav','Singh','Malhotra','Jain','Khanna','Bose','Kulkarni','Iyer','Chopra','Bhat','Saxena','Agarwal'])[(gs.n % 20) + 1],
      ' ',
      LPAD(gs.n::TEXT, 4, '0')
    ),
    CONCAT(
      'member',
      REPLACE(REPLACE(LOWER(g.city), ' ', ''), '-', ''),
      '.',
      gs.local_seq,
      '.',
      SUBSTRING(MD5(g.name) FROM 1 FOR 6),
      '@wtflivepulse.dev'
    ),
    CONCAT(CASE WHEN gs.n % 3 = 0 THEN '7' WHEN gs.n % 2 = 0 THEN '8' ELSE '9' END, LPAD((100000000 + gs.n * 97)::TEXT, 9, '0')),
    CASE
      WHEN gs.local_seq <= c.monthly_count THEN 'monthly'
      WHEN gs.local_seq <= c.monthly_count + c.quarterly_count THEN 'quarterly'
      ELSE 'annual'
    END,
    CASE WHEN gs.local_seq % 5 = 0 THEN 'renewal' ELSE 'new' END,
    CASE
      WHEN gs.local_seq <= c.active_count THEN 'active'
      WHEN gs.local_seq <= c.active_count + c.inactive_count THEN 'inactive'
      ELSE 'frozen'
    END,
    CASE
      WHEN gs.local_seq <= c.active_count THEN NOW() - ((gs.local_seq % 90) || ' days')::INTERVAL - ((gs.local_seq % 12) || ' hours')::INTERVAL
      ELSE NOW() - ((91 + (gs.local_seq % 90)) || ' days')::INTERVAL
    END,
    NOW(),
    CASE
      WHEN gs.local_seq <= c.active_count AND gs.n <= 150 THEN NOW() - INTERVAL '50 days'
      WHEN gs.local_seq <= c.active_count AND gs.n > 150 AND gs.n <= 230 THEN NOW() - INTERVAL '70 days'
      WHEN gs.local_seq <= c.active_count THEN NOW() - ((gs.local_seq % 30) || ' days')::INTERVAL
      ELSE NOW() - ((60 + (gs.local_seq % 60)) || ' days')::INTERVAL
    END
  FROM (
    SELECT
      c.gym_name,
      generate_series(1, c.member_count) AS local_seq,
      row_number() OVER () AS n
    FROM gym_seed_config c
  ) gs
  JOIN gym_seed_config c ON c.gym_name = gs.gym_name
  JOIN gyms g ON g.name = c.gym_name;

  UPDATE temp_members
  SET plan_expires_at = CASE plan_type
    WHEN 'monthly' THEN joined_at + INTERVAL '30 days'
    WHEN 'quarterly' THEN joined_at + INTERVAL '90 days'
    ELSE joined_at + INTERVAL '365 days'
  END;

  INSERT INTO members (
    gym_id,
    name,
    email,
    phone,
    plan_type,
    member_type,
    status,
    joined_at,
    plan_expires_at,
    last_checkin_at
  )
  SELECT
    gym_id,
    name,
    email,
    phone,
    plan_type,
    member_type,
    status,
    joined_at,
    plan_expires_at,
    target_last_checkin
  FROM temp_members
  ORDER BY seq;

  RAISE NOTICE 'Seeding payments...';

  INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at, notes)
  SELECT
    m.id,
    m.gym_id,
    CASE m.plan_type
      WHEN 'monthly' THEN 1499
      WHEN 'quarterly' THEN 3999
      ELSE 11999
    END,
    m.plan_type,
    'new',
    m.joined_at,
    'Seeded join payment'
  FROM members m;

  INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at, notes)
  SELECT
    m.id,
    m.gym_id,
    CASE m.plan_type
      WHEN 'monthly' THEN 1499
      WHEN 'quarterly' THEN 3999
      ELSE 11999
    END,
    m.plan_type,
    'renewal',
    CASE m.plan_type
      WHEN 'monthly' THEN m.joined_at + INTERVAL '30 days'
      WHEN 'quarterly' THEN m.joined_at + INTERVAL '90 days'
      ELSE m.joined_at + INTERVAL '365 days'
    END,
    'Seeded renewal payment'
  FROM members m
  WHERE m.member_type = 'renewal'
    AND CASE m.plan_type
      WHEN 'monthly' THEN m.joined_at + INTERVAL '30 days'
      WHEN 'quarterly' THEN m.joined_at + INTERVAL '90 days'
      ELSE m.joined_at + INTERVAL '365 days'
    END <= NOW();

  INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at, notes)
  SELECT
    m.id,
    m.gym_id,
    CASE m.plan_type
      WHEN 'monthly' THEN 1499
      WHEN 'quarterly' THEN 3999
      ELSE 11999
    END,
    m.plan_type,
    CASE WHEN ABS(HASHTEXT(m.email)) % 2 = 0 THEN 'renewal' ELSE 'new' END,
    NOW() - ((ABS(HASHTEXT(m.id::TEXT)) % 30) || ' days')::INTERVAL - ((ABS(HASHTEXT(m.phone)) % 6) || ' hours')::INTERVAL,
    'Rolling revenue payment'
  FROM members m
  WHERE ABS(HASHTEXT(m.email)) % 3 = 0;

  DELETE FROM payments
  WHERE gym_id = (SELECT id FROM gyms WHERE name = 'WTF Gyms — Salt Lake')
    AND paid_at >= CURRENT_DATE;

  INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at, notes)
  SELECT
    m.id,
    m.gym_id,
    1499,
    'monthly',
    'new',
    CURRENT_DATE - INTERVAL '7 days' + INTERVAL '10 hours' + ((row_number() OVER ()) || ' minutes')::INTERVAL,
    'Salt Lake prior week'
  FROM members m
  WHERE m.gym_id = (SELECT id FROM gyms WHERE name = 'WTF Gyms — Salt Lake')
  ORDER BY m.joined_at DESC
  LIMIT 10;

  INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at, notes)
  SELECT
    m.id,
    m.gym_id,
    1499,
    'monthly',
    'new',
    NOW() - INTERVAL '30 minutes',
    'Salt Lake weak today'
  FROM members m
  WHERE m.gym_id = (SELECT id FROM gyms WHERE name = 'WTF Gyms — Salt Lake')
  ORDER BY m.joined_at DESC
  LIMIT 1;

  RAISE NOTICE 'Seeding historical check-ins...';

  INSERT INTO checkins (member_id, gym_id, checked_in, checked_out)
  SELECT
    m.id,
    m.gym_id,
    generated.checkin_at,
    generated.checkin_at + (((45 + (ABS(HASHTEXT(m.id::TEXT || generated.checkin_at::TEXT)) % 45))) || ' minutes')::INTERVAL
  FROM members m
  CROSS JOIN LATERAL (
    SELECT
      NOW()
      - ((d.day_offset + (ABS(HASHTEXT(m.id::TEXT)) % 3)) || ' days')::INTERVAL
      - (((ABS(HASHTEXT(m.email || d.day_offset::TEXT)) % 14) * 60 + 360) || ' minutes')::INTERVAL AS checkin_at
    FROM generate_series(1, 45) AS d(day_offset)
  ) generated
  WHERE generated.checkin_at < NOW() - INTERVAL '3 hours';

  INSERT INTO checkins (member_id, gym_id, checked_in, checked_out)
  SELECT
    m.id,
    m.gym_id,
    generated.checkin_at,
    generated.checkin_at + (((45 + (ABS(HASHTEXT(m.phone || generated.checkin_at::TEXT)) % 45))) || ' minutes')::INTERVAL
  FROM members m
  CROSS JOIN LATERAL (
    SELECT
      NOW()
      - ((d.day_offset + (ABS(HASHTEXT(m.phone)) % 2)) || ' days')::INTERVAL
      - (((ABS(HASHTEXT(m.name || d.day_offset::TEXT)) % 10) * 45 + 1020) || ' minutes')::INTERVAL AS checkin_at
    FROM generate_series(1, 15) AS d(day_offset)
  ) generated
  WHERE m.status = 'active'
    AND generated.checkin_at < NOW() - INTERVAL '3 hours';

  UPDATE members m
  SET last_checkin_at = history.max_checkin
  FROM (
    SELECT member_id, MAX(checked_in) AS max_checkin
    FROM checkins
    GROUP BY member_id
  ) history
  WHERE history.member_id = m.id;

  RAISE NOTICE 'Seeding live occupancy scenarios...';

  INSERT INTO checkins (member_id, gym_id, checked_in, checked_out)
  SELECT
    m.id,
    m.gym_id,
    NOW() - ((row_number() OVER ()) || ' minutes')::INTERVAL,
    NULL
  FROM members m
  WHERE m.gym_id = (SELECT id FROM gyms WHERE name = 'WTF Gyms — Bandra West')
    AND m.status = 'active'
  LIMIT 282;

  INSERT INTO checkins (member_id, gym_id, checked_in, checked_out)
  SELECT
    m.id,
    m.gym_id,
    NOW() - ((row_number() OVER ()) || ' minutes')::INTERVAL,
    NULL
  FROM members m
  WHERE m.gym_id IN (
      SELECT id FROM gyms
      WHERE name IN (
        'WTF Gyms — Lajpat Nagar',
        'WTF Gyms — Powai',
        'WTF Gyms — Indiranagar'
      )
    )
    AND m.status = 'active'
    AND m.id NOT IN (SELECT member_id FROM checkins WHERE checked_out IS NULL)
  LIMIT 40;

  DELETE FROM checkins
  WHERE gym_id = (SELECT id FROM gyms WHERE name = 'WTF Gyms — Velachery')
    AND checked_out IS NULL;

  INSERT INTO checkins (member_id, gym_id, checked_in, checked_out)
  SELECT
    m.id,
    m.gym_id,
    NOW() - INTERVAL '2 hours 20 minutes',
    NOW() - INTERVAL '1 hour 15 minutes'
  FROM members m
  WHERE m.gym_id = (SELECT id FROM gyms WHERE name = 'WTF Gyms — Velachery')
  ORDER BY m.joined_at DESC
  LIMIT 1;

  UPDATE members m
  SET last_checkin_at = history.max_checkin
  FROM (
    SELECT member_id, MAX(checked_in) AS max_checkin
    FROM checkins
    GROUP BY member_id
  ) history
  WHERE history.member_id = m.id;

  REFRESH MATERIALIZED VIEW gym_hourly_stats;

  RAISE NOTICE 'Seed complete.';
END $$;
