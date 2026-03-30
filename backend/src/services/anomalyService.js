const { pool } = require("../db/pool");
const { broadcast } = require("../websocket/server");

async function getUnreadCount() {
  const { rows } = await pool.query(`
    SELECT COUNT(*)::INTEGER AS count
    FROM anomalies
    WHERE dismissed = FALSE
      AND (
        resolved = FALSE
        OR resolved_at >= NOW() - INTERVAL '24 hours'
      )
  `);

  return rows[0]?.count || 0;
}

async function createOrResolveAnomaly(gym, type, severity, shouldExist, message) {
  const activeResult = await pool.query(
    `
      SELECT id
      FROM anomalies
      WHERE gym_id = $1 AND type = $2 AND resolved = FALSE AND dismissed = FALSE
      ORDER BY detected_at DESC
      LIMIT 1
    `,
    [gym.id, type]
  );

  const existing = activeResult.rows[0];

  if (shouldExist && !existing) {
    const insertResult = await pool.query(
      `
        INSERT INTO anomalies (gym_id, type, severity, message)
        VALUES ($1, $2, $3, $4)
        RETURNING id, gym_id, type, severity, message, detected_at, resolved
      `,
      [gym.id, type, severity, message]
    );

    const anomaly = insertResult.rows[0];
    const unreadCount = await getUnreadCount();
    broadcast({
      type: "ANOMALY_DETECTED",
      anomaly_id: anomaly.id,
      gym_id: anomaly.gym_id,
      gym_name: gym.name,
      anomaly_type: anomaly.type,
      severity: anomaly.severity,
      message: anomaly.message,
      unread_count: unreadCount,
    });
  }

  if (!shouldExist && existing) {
    const resolvedResult = await pool.query(
      `
        UPDATE anomalies
        SET resolved = TRUE, resolved_at = NOW()
        WHERE id = $1
        RETURNING id, gym_id, resolved_at
      `,
      [existing.id]
    );

    const resolved = resolvedResult.rows[0];
    const unreadCount = await getUnreadCount();
    broadcast({
      type: "ANOMALY_RESOLVED",
      anomaly_id: resolved.id,
      gym_id: resolved.gym_id,
      resolved_at: resolved.resolved_at,
      unread_count: unreadCount,
    });
  }
}

async function detectAndSyncAnomalies() {
  const { rows: gyms } = await pool.query(`
    SELECT
      g.*,
      (
        SELECT COUNT(*)
        FROM checkins c
        WHERE c.gym_id = g.id AND c.checked_out IS NULL
      ) AS current_occupancy,
      (
        SELECT MAX(c.checked_in)
        FROM checkins c
        WHERE c.gym_id = g.id
      ) AS last_checkin_at,
      (
        SELECT COALESCE(SUM(amount), 0)
        FROM payments p
        WHERE p.gym_id = g.id AND p.paid_at >= CURRENT_DATE
      ) AS revenue_today,
      (
        SELECT COALESCE(SUM(amount), 0)
        FROM payments p
        WHERE p.gym_id = g.id
          AND p.paid_at >= CURRENT_DATE - INTERVAL '7 days'
          AND p.paid_at < CURRENT_DATE - INTERVAL '6 days'
      ) AS revenue_same_day_last_week
    FROM gyms g
    WHERE g.status = 'active'
  `);

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const gym of gyms) {
    const [openHour, openMinute] = gym.opens_at.split(":").map(Number);
    const [closeHour, closeMinute] = gym.closes_at.split(":").map(Number);
    const duringOperatingHours =
      currentMinutes >= openHour * 60 + openMinute &&
      currentMinutes <= closeHour * 60 + closeMinute;

    const occupancy = Number(gym.current_occupancy);
    const capacity = Number(gym.capacity);
    const revenueToday = Number(gym.revenue_today);
    const revenueLastWeek = Number(gym.revenue_same_day_last_week);
    const lastCheckinAt = gym.last_checkin_at ? new Date(gym.last_checkin_at) : null;

    const zeroCheckins =
      duringOperatingHours &&
      (!lastCheckinAt || now.getTime() - lastCheckinAt.getTime() > 2 * 60 * 60 * 1000);
    const capacityBreach = occupancy > capacity * 0.9;
    const revenueDrop = revenueLastWeek > 0 && revenueToday <= revenueLastWeek * 0.7;

    await createOrResolveAnomaly(
      gym,
      "zero_checkins",
      "warning",
      zeroCheckins,
      `${gym.name} has recorded no check-ins in the last 2 hours during operating hours.`
    );

    await createOrResolveAnomaly(
      gym,
      "capacity_breach",
      "critical",
      capacityBreach,
      `${gym.name} is above 90% capacity and needs staff attention.`
    );

    await createOrResolveAnomaly(
      gym,
      "revenue_drop",
      "warning",
      revenueDrop,
      `${gym.name} revenue is down more than 30% versus the same weekday last week.`
    );
  }
}

async function listAnomalies(filters = {}) {
  const values = [];
  const conditions = [];

  if (filters.gymId) {
    values.push(filters.gymId);
    conditions.push(`a.gym_id = $${values.length}`);
  }

  if (filters.severity) {
    values.push(filters.severity);
    conditions.push(`a.severity = $${values.length}`);
  }

  if (!filters.includeResolved) {
    conditions.push("a.dismissed = FALSE");
    conditions.push("(a.resolved = FALSE OR a.resolved_at >= NOW() - INTERVAL '24 hours')");
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `
      SELECT a.*, g.name AS gym_name
      FROM anomalies a
      JOIN gyms g ON g.id = a.gym_id
      ${whereClause}
      ORDER BY a.detected_at DESC
    `,
    values
  );

  return rows;
}

async function dismissAnomaly(anomalyId) {
  const { rows } = await pool.query(
    `
      SELECT *
      FROM anomalies
      WHERE id = $1
      LIMIT 1
    `,
    [anomalyId]
  );

  const anomaly = rows[0];

  if (!anomaly) {
    return { status: 404, payload: { error: "Anomaly not found" } };
  }

  if (anomaly.severity === "critical") {
    return { status: 403, payload: { error: "Critical anomalies cannot be dismissed" } };
  }

  const result = await pool.query(
    `
      UPDATE anomalies
      SET dismissed = TRUE
      WHERE id = $1
      RETURNING *
    `,
    [anomalyId]
  );

  return { status: 200, payload: result.rows[0] };
}

async function archiveResolvedAnomalies() {
  await pool.query(`
    DELETE FROM anomalies
    WHERE (resolved = TRUE OR dismissed = TRUE)
      AND COALESCE(resolved_at, detected_at) < NOW() - INTERVAL '24 hours'
  `);
}

module.exports = {
  detectAndSyncAnomalies,
  listAnomalies,
  dismissAnomaly,
  archiveResolvedAnomalies,
  getUnreadCount,
};
