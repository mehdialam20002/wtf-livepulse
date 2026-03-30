const express = require("express");
const { listAnomalies, dismissAnomaly } = require("../services/anomalyService");

const router = express.Router();
const validSeverities = new Set(["warning", "critical"]);

router.get("/", async (req, res, next) => {
  try {
    if (req.query.severity && !validSeverities.has(req.query.severity)) {
      res.status(400).json({ error: "severity must be warning or critical" });
      return;
    }

    const anomalies = await listAnomalies({
      gymId: req.query.gym_id,
      severity: req.query.severity,
    });
    res.json(anomalies);
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/dismiss", async (req, res, next) => {
  try {
    const result = await dismissAnomaly(req.params.id);
    res.status(result.status).json(result.payload);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
