const fs = require("fs/promises");
const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const gymsRouter = require("./routes/gyms");
const anomaliesRouter = require("./routes/anomalies");
const analyticsRouter = require("./routes/analytics");
const simulatorRouter = require("./routes/simulator");
const { pool } = require("./db/pool");
const { initWebSocketServer } = require("./websocket/server");
const { startAnomalyDetector } = require("./jobs/anomalyDetector");
const { bootSimulator } = require("./jobs/simulator");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/gyms", gymsRouter);
app.use("/api/anomalies", anomaliesRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/simulator", simulatorRouter);

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

async function runMigrations() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, "db", "migrations");
    const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

    for (const file of files) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [file],
      );

      if (existing.rowCount > 0) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [file],
      );
      await client.query("COMMIT");
    }
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors when no transaction is active.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function waitForDatabase(maxAttempts = 20, delayMs = 3000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      console.warn(`Database not ready yet (attempt ${attempt}/${maxAttempts}). Retrying...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function ensureSeedData() {
  const memberCountResult = await pool.query("SELECT COUNT(*)::INTEGER AS count FROM members");
  const memberCount = memberCountResult.rows[0]?.count || 0;

  if (memberCount > 0) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const schemaSql = await fs.readFile(path.join(__dirname, "db", "migrations", "001_schema.sql"), "utf8");
    const seedSql = await fs.readFile(path.join(__dirname, "db", "migrations", "002_seed.sql"), "utf8");
    await client.query(schemaSql);
    await client.query(seedSql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  (async () => {
    const port = Number(process.env.PORT || 3001);
    const server = http.createServer(app);
    await waitForDatabase();
    await runMigrations();
    await ensureSeedData();
    initWebSocketServer(server);
    startAnomalyDetector();
    bootSimulator();
    server.listen(port, () => {
      console.log(`WTF LivePulse backend running on ${port}`);
    });
  })().catch((error) => {
    console.error("Backend bootstrap failed", error);
    process.exit(1);
  });
}

module.exports = { app };
