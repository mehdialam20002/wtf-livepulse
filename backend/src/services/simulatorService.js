const { pool } = require("../db/pool");
const { broadcast } = require("../websocket/server");
const { realtimeState, pushEvent } = require("./realtimeState");

const speedToDelay = {
  1: 2000,
  5: 600,
  10: 300,
};

let intervalRef = null;

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

async function fetchGyms() {
  const { rows } = await pool.query("SELECT id, name, capacity FROM gyms ORDER BY name");
  return rows;
}

async function simulatePayment(gymId, member) {
  const plans = {
    monthly: 1499,
    quarterly: 3999,
    annual: 11999,
  };

  const amount = plans[member.plan_type] || 1499;
  const paymentResult = await pool.query(
    `
      INSERT INTO payments (member_id, gym_id, amount, plan_type, payment_type, paid_at, notes)
      VALUES ($1, $2, $3, $4, 'renewal', NOW(), 'Simulated live renewal')
      RETURNING *
    `,
    [member.id, gymId, amount, member.plan_type]
  );

  const revenueResult = await pool.query(
    `
      SELECT COALESCE(SUM(amount), 0) AS today_total
      FROM payments
      WHERE gym_id = $1 AND paid_at >= CURRENT_DATE
    `,
    [gymId]
  );

  pushEvent({
    event_type: "payment",
    gym_id: gymId,
    member_name: member.name,
    amount,
    event_timestamp: paymentResult.rows[0].paid_at,
  });

  broadcast({
    type: "PAYMENT_EVENT",
    gym_id: gymId,
    amount,
    plan_type: member.plan_type,
    member_name: member.name,
    today_total: Number(revenueResult.rows[0].today_total),
    timestamp: paymentResult.rows[0].paid_at,
  });
}

async function simulateTick() {
  const gyms = await fetchGyms();
  const gym = pickRandom(gyms);

  const memberPool = await pool.query(
    `
      SELECT id, name, plan_type
      FROM members
      WHERE gym_id = $1 AND status = 'active'
      ORDER BY RANDOM()
      LIMIT 20
    `,
    [gym.id]
  );

  const openCheckins = await pool.query(
    `
      SELECT c.id, c.member_id, m.name
      FROM checkins c
      JOIN members m ON m.id = c.member_id
      WHERE c.gym_id = $1 AND c.checked_out IS NULL
      ORDER BY c.checked_in ASC
      LIMIT 20
    `,
    [gym.id]
  );

  const occupancyResult = await pool.query(
    `
      SELECT COUNT(*) AS current_occupancy
      FROM checkins
      WHERE gym_id = $1 AND checked_out IS NULL
    `,
    [gym.id]
  );

  const occupancy = Number(occupancyResult.rows[0].current_occupancy);
  const shouldCheckOut = occupancy > gym.capacity * 0.65 || (occupancy > 10 && Math.random() > 0.45);

  if (shouldCheckOut && openCheckins.rows.length > 0) {
    const record = pickRandom(openCheckins.rows);
    await pool.query(
      `
        UPDATE checkins
        SET checked_out = NOW()
        WHERE id = $1
      `,
      [record.id]
    );

    const latestCount = await pool.query(
      `
        SELECT COUNT(*) AS current_occupancy
        FROM checkins
        WHERE gym_id = $1 AND checked_out IS NULL
      `,
      [gym.id]
    );

    const currentOccupancy = Number(latestCount.rows[0].current_occupancy);

    pushEvent({
      event_type: "checkout",
      gym_id: gym.id,
      member_name: record.name,
      event_timestamp: new Date().toISOString(),
    });

    broadcast({
      type: "CHECKOUT_EVENT",
      gym_id: gym.id,
      member_name: record.name,
      timestamp: new Date().toISOString(),
      current_occupancy: currentOccupancy,
      capacity_pct: Math.round((currentOccupancy / gym.capacity) * 100),
    });
    return;
  }

  const availableMembers = memberPool.rows.filter(
    (member) => !openCheckins.rows.find((item) => item.member_id === member.id)
  );

  if (availableMembers.length === 0) {
    return;
  }

  const member = pickRandom(availableMembers);

  await pool.query(
    `
      INSERT INTO checkins (member_id, gym_id, checked_in)
      VALUES ($1, $2, NOW())
    `,
    [member.id, gym.id]
  );

  await pool.query(
    `
      UPDATE members
      SET last_checkin_at = NOW()
      WHERE id = $1
    `,
    [member.id]
  );

  const latestCount = await pool.query(
    `
      SELECT COUNT(*) AS current_occupancy
      FROM checkins
      WHERE gym_id = $1 AND checked_out IS NULL
    `,
    [gym.id]
  );

  const currentOccupancy = Number(latestCount.rows[0].current_occupancy);

  pushEvent({
    event_type: "checkin",
    gym_id: gym.id,
    member_name: member.name,
    event_timestamp: new Date().toISOString(),
  });

  broadcast({
    type: "CHECKIN_EVENT",
    gym_id: gym.id,
    member_name: member.name,
    timestamp: new Date().toISOString(),
    current_occupancy: currentOccupancy,
    capacity_pct: Math.round((currentOccupancy / gym.capacity) * 100),
  });

  if (Math.random() > 0.8) {
    await simulatePayment(gym.id, member);
  }
}

async function seedBaselineLiveState() {
  const baselineConfigs = [
    { gymName: "WTF Gyms — Bandra West", openCount: 282 },
    { gymName: "WTF Gyms — Lajpat Nagar", openCount: 20 },
    { gymName: "WTF Gyms — Connaught Place", openCount: 18 },
    { gymName: "WTF Gyms — Powai", openCount: 22 },
    { gymName: "WTF Gyms — Indiranagar", openCount: 16 },
    { gymName: "WTF Gyms — Koramangala", openCount: 14 },
    { gymName: "WTF Gyms — Banjara Hills", openCount: 12 },
    { gymName: "WTF Gyms — Sector 18 Noida", openCount: 10 },
    { gymName: "WTF Gyms — Salt Lake", openCount: 8 },
    { gymName: "WTF Gyms — Velachery", openCount: 0 },
  ];

  for (const config of baselineConfigs) {
    await pool.query(
      `
        INSERT INTO checkins (member_id, gym_id, checked_in)
        SELECT
          m.id,
          g.id,
          NOW() - ((ROW_NUMBER() OVER (ORDER BY m.joined_at DESC)) || ' minutes')::INTERVAL
        FROM members m
        JOIN gyms g ON g.id = m.gym_id
        WHERE g.name = $1
          AND m.status = 'active'
          AND m.id NOT IN (
            SELECT member_id
            FROM checkins
            WHERE checked_out IS NULL
          )
        LIMIT $2
      `,
      [config.gymName, config.openCount]
    );
  }
}

function clearSimulatorInterval() {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = null;
  }
}

function startSimulator(speed = 1) {
  realtimeState.simulator.running = true;
  realtimeState.simulator.speed = speed;
  clearSimulatorInterval();
  intervalRef = setInterval(() => {
    simulateTick().catch((error) => {
      console.error("Simulator tick failed", error);
    });
  }, speedToDelay[speed] || speedToDelay[1]);

  return {
    status: "running",
    speed,
  };
}

function stopSimulator() {
  realtimeState.simulator.running = false;
  clearSimulatorInterval();
  return {
    status: "paused",
  };
}

async function resetSimulator() {
  clearSimulatorInterval();
  realtimeState.simulator.running = false;
  realtimeState.simulator.speed = 1;

  await pool.query(`
    UPDATE checkins
    SET checked_out = NOW()
    WHERE checked_out IS NULL
  `);

  await pool.query(`
    DELETE FROM payments
    WHERE notes = 'Simulated live renewal'
  `);

  await seedBaselineLiveState();

  return {
    status: "reset",
  };
}

module.exports = {
  startSimulator,
  stopSimulator,
  resetSimulator,
};
