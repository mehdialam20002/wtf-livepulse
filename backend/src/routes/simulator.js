const express = require("express");
const {
  startSimulator,
  stopSimulator,
  resetSimulator,
} = require("../services/simulatorService");

const router = express.Router();

router.post("/start", (req, res) => {
  const speed = Number(req.body.speed || 1);

  if (!Number.isInteger(speed) || ![1, 5, 10].includes(speed)) {
    res.status(400).json({ error: "Speed must be 1, 5, or 10" });
    return;
  }

  res.json(startSimulator(speed));
});

router.post("/stop", (_req, res) => {
  res.json(stopSimulator());
});

router.post("/reset", async (_req, res, next) => {
  try {
    res.json(await resetSimulator());
  } catch (error) {
    next(error);
  }
});

module.exports = router;
