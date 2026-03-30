const express = require("express");
const { getCrossGymRevenue } = require("../services/statsService");

const router = express.Router();

router.get("/cross-gym", async (_req, res, next) => {
  try {
    const data = await getCrossGymRevenue();
    res.json(data);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
