import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApi } from "./api.js";
import { createPool, migrate } from "./db.js";
import { createStatic } from "./static.js";

const here = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(here, "..", "..", "web");

const port = Number(process.env.PORT || 8080);
const pool = createPool();

// The schema is idempotent and small enough to apply on boot. A real migration
// tool arrives with the first change that is not additive; until then a
// separate deploy step would only be a way to forget it.
await migrate(pool);

const api = createApi(pool);
const serveStatic = createStatic(WEB_DIR);

const server = createServer(async (req, res) => {
  try {
    if (await api(req, res)) return;
    await serveStatic(req, res);
  } catch (error) {
    console.error("request failed", error);
    if (!res.headersSent) res.writeHead(500).end();
    else res.end();
  }
});

server.listen(port, () => {
  console.log(`studiopractice server on http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
