const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgres://wtf:wtf_secret@localhost:5432/wtf_livepulse",
});

module.exports = { pool };
