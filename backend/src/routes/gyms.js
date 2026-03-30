const express = require("express");
const {
  getGymsOverview,
  getLiveSnapshot,
  getAnalytics,
  getSummaryBar,
} = require("../services/statsService");

const router = express.Router();
const validDateRanges = new Set(["7d", "30d", "90d"]);

router.get("/", async (req, res, next) => {
  try {
    const [gyms, summary] = await Promise.all([getGymsOverview(), getSummaryBar()]);
    res.json({ gyms, summary });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/live", async (req, res, next) => {
  try {
    const snapshot = await getLiveSnapshot(req.params.id);

    if (!snapshot) {
      res.status(404).json({ error: "Gym not found" });
      return;
    }

    res.json(snapshot);
  } catch (error) {
    next(error);
  }
});

router.get("/:id/analytics", async (req, res, next) => {
  try {
    const { dateRange = "30d" } = req.query;

    if (!validDateRanges.has(dateRange)) {
      res.status(400).json({ error: "dateRange must be 7d, 30d, or 90d" });
      return;
    }

    const analytics = await getAnalytics(req.params.id, dateRange);
    res.json(analytics);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
