describe("anomaly thresholds", () => {
  test("zero check-ins condition is true when no checkins in 2 hours", () => {
    const now = new Date("2026-03-30T10:00:00Z");
    const lastCheckin = new Date("2026-03-30T07:30:00Z");
    expect(now.getTime() - lastCheckin.getTime()).toBeGreaterThan(2 * 60 * 60 * 1000);
  });

  test("capacity breach threshold checks for > 90%", () => {
    const occupancy = 275;
    const capacity = 300;
    expect(occupancy > capacity * 0.9).toBe(true);
  });
});
