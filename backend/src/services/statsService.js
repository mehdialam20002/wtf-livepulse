const { pool } = require("../db/pool");
const { realtimeState } = require("./realtimeState");

function buildDateFilter(dateRange) {
  if (dateRange === "7d") {
    return "INTERVAL '7 days'";
  }

  if (dateRange === "90d") {
    return "INTERVAL '90 days'";
  }

  return "INTERVAL '30 days'";
}

async function getGymsOverview() {
  const query = `
    SELECT
      g.id,
      g.name,
      g.city,
      g.capacity,
      g.status,
      g.opens_at,
      g.closes_at,
      (
        SELECT COUNT(*)
        FROM checkins c
        WHERE c.gym_id = g.id AND c.checked_out IS NULL
      ) AS current_occupancy,
      (
        SELECT COALESCE(SUM(amount), 0)
        FROM payments p
        WHERE p.gym_id = g.id AND p.paid_at >= CURRENT_DATE
      ) AS today_revenue
    FROM gyms g
    ORDER BY g.name
  `;

  const { rows } = await pool.query(query);
  return rows.map((row) => ({
    ...row,
    capacity: Number(row.capacity),
    current_occupancy: Number(row.current_occupancy),
    today_revenue: Number(row.today_revenue),
  }));
}

async function getSummaryBar() {
  const query = `
    SELECT
      (SELECT COUNT(*) FROM checkins WHERE checked_out IS NULL) AS total_checked_in,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE paid_at >= CURRENT_DATE) AS total_revenue_today,
      (
        SELECT COUNT(*)
        FROM anomalies
        WHERE dismissed = FALSE
          AND (
            resolved = FALSE
            OR resolved_at >= NOW() - INTERVAL '24 hours'
          )
      ) AS active_anomalies
  `;

  const { rows } = await pool.query(query);
  const row = rows[0];

  return {
    totalCheckedIn: Number(row.total_checked_in),
    totalRevenueToday: Number(row.total_revenue_today),
    activeAnomalies: Number(row.active_anomalies),
    simulator: realtimeState.simulator,
  };
}

async function getLiveSnapshot(gymId) {
  const query = `
    WITH gym_base AS (
      SELECT id, name, city, capacity, status, opens_at, closes_at
      FROM gyms
      WHERE id = $1
    ),
    live_occupancy AS (
      SELECT gym_id, COUNT(*) AS current_occupancy
      FROM checkins
      WHERE gym_id = $1 AND checked_out IS NULL
      GROUP BY gym_id
    ),
    revenue_today AS (
      SELECT gym_id, COALESCE(SUM(amount), 0) AS today_revenue
      FROM payments
      WHERE gym_id = $1 AND paid_at >= CURRENT_DATE
      GROUP BY gym_id
    ),
    recent_events AS (
      SELECT *
      FROM live_event_feed
      WHERE gym_id = $1
      ORDER BY event_timestamp DESC
      LIMIT 8
    ),
    live_anomalies AS (
      SELECT id, type, severity, message, resolved, dismissed, detected_at, resolved_at
      FROM anomalies
      WHERE gym_id = $1
        AND dismissed = FALSE
        AND (
          resolved = FALSE
          OR resolved_at >= NOW() - INTERVAL '24 hours'
        )
      ORDER BY detected_at DESC
      LIMIT 10
    )
    SELECT
      gb.*,
      COALESCE(lo.current_occupancy, 0) AS current_occupancy,
      COALESCE(rt.today_revenue, 0) AS today_revenue,
      COALESCE((SELECT json_agg(re.* ORDER BY re.event_timestamp DESC) FROM recent_events re), '[]'::json) AS recent_events,
      COALESCE((SELECT json_agg(la.* ORDER BY la.detected_at DESC) FROM live_anomalies la), '[]'::json) AS active_anomalies
    FROM gym_base gb
    LEFT JOIN live_occupancy lo ON lo.gym_id = gb.id
    LEFT JOIN revenue_today rt ON rt.gym_id = gb.id
  `;

  const { rows } = await pool.query(query, [gymId]);
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    ...row,
    capacity: Number(row.capacity),
    current_occupancy: Number(row.current_occupancy),
    today_revenue: Number(row.today_revenue),
    capacity_pct: Math.round((Number(row.current_occupancy) / Number(row.capacity)) * 100),
  };
}

async function getAnalytics(gymId, dateRange = "30d") {
  const interval = buildDateFilter(dateRange);

  const [heatmap, revenue, churn, ratio] = await Promise.all([
    pool.query(
      `
        SELECT day_of_week, hour_of_day, checkin_count
        FROM gym_hourly_stats
        WHERE gym_id = $1
        ORDER BY day_of_week, hour_of_day
      `,
      [gymId]
    ),
    pool.query(
      `
        SELECT plan_type, COALESCE(SUM(amount), 0) AS revenue
        FROM payments
        WHERE gym_id = $1 AND paid_at >= NOW() - ${interval}
        GROUP BY plan_type
        ORDER BY plan_type
      `,
      [gymId]
    ),
    pool.query(
      `
        SELECT id, name, last_checkin_at,
          CASE
            WHEN last_checkin_at < NOW() - INTERVAL '60 days' THEN 'critical'
            ELSE 'high'
          END AS risk_level
        FROM members
        WHERE gym_id = $1
          AND status = 'active'
          AND last_checkin_at < NOW() - INTERVAL '45 days'
        ORDER BY last_checkin_at ASC
        LIMIT 20
      `,
      [gymId]
    ),
    pool.query(
      `
        SELECT payment_type, COUNT(*) AS total
        FROM payments
        WHERE gym_id = $1 AND paid_at >= NOW() - ${interval}
        GROUP BY payment_type
      `,
      [gymId]
    ),
  ]);

  const ratioMap = ratio.rows.reduce(
    (acc, row) => {
      acc[row.payment_type] = Number(row.total);
      return acc;
    },
    { new: 0, renewal: 0 }
  );

  return {
    heatmap: heatmap.rows.map((row) => ({
      day_of_week: Number(row.day_of_week),
      hour_of_day: Number(row.hour_of_day),
      checkin_count: Number(row.checkin_count),
    })),
    revenueByPlan: revenue.rows.map((row) => ({
      plan_type: row.plan_type,
      revenue: Number(row.revenue),
    })),
    churnRisk: churn.rows,
    newVsRenewal: {
      new: ratioMap.new,
      renewal: ratioMap.renewal,
    },
  };
}

async function getCrossGymRevenue() {
  const { rows } = await pool.query(`
    SELECT
      g.id AS gym_id,
      g.name AS gym_name,
      COALESCE(SUM(p.amount), 0) AS total_revenue
    FROM gyms g
    LEFT JOIN payments p
      ON p.gym_id = g.id
      AND p.paid_at >= NOW() - INTERVAL '30 days'
    GROUP BY g.id
    ORDER BY total_revenue DESC, g.name ASC
  `);

  return rows.map((row, index) => ({
    ...row,
    total_revenue: Number(row.total_revenue),
    rank: index + 1,
  }));
}

module.exports = {
  getGymsOverview,
  getSummaryBar,
  getLiveSnapshot,
  getAnalytics,
  getCrossGymRevenue,
};
