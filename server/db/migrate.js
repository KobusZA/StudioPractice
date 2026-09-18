import { createPool, migrate } from "../src/db.js";

const pool = createPool();
try {
  await migrate(pool);
  console.log("schema applied");
} finally {
  await pool.end();
}
