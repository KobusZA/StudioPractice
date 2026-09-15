// Static file server for manual and smoke testing of web/v2.
//   node tests/serve.js [port]
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const PORT = Number(process.argv[2]) || 17399;
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".tsv": "text/tab-separated-values",
};

http.createServer(async (req, res) => {
  try {
    let file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
    if (!file.startsWith(ROOT)) throw new Error("outside root");
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    const body = await readFile(file);
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": TYPES[ext] || "application/octet-stream",
      // ES modules are cached by URL. ui.js can update while an old model.js
      // stays cached, which shows up as "does not provide an export named …".
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
