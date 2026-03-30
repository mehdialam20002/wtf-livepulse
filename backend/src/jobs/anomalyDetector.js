const { pool } = require("../db/pool");
const {
  detectAndSyncAnomalies,
  archiveResolvedAnomalies,
} = require("../services/anomalyService");

async function refreshHeatmap() {
  await pool.query("REFRESH MATERIALIZED VIEW gym_hourly_stats");
}

function startAnomalyDetector() {
  const runCycle = async () => {
    await detectAndSyncAnomalies();
    await archiveResolvedAnomalies();
  };

  runCycle().catch((error) => {
    console.error("Initial anomaly detection failed", error);
  });

  refreshHeatmap().catch((error) => {
    console.error("Initial heatmap refresh failed", error);
  });

  setInterval(() => {
    runCycle().catch((error) => {
      console.error("Scheduled anomaly detection failed", error);
    });
  }, 30000);

  setInterval(() => {
    refreshHeatmap().catch((error) => {
      console.error("Scheduled heatmap refresh failed", error);
    });
  }, 15 * 60 * 1000);
}

module.exports = { startAnomalyDetector };
