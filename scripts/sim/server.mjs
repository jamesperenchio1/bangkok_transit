// Tiny static file server for the Next.js static export in ./out
// (next start cannot serve an `output: "export"` build, so we roll our own).
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "../../out");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pbf": "application/x-protobuf",
  ".map": "application/json; charset=utf-8",
};

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

async function fileExists(p) {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}

export function startServer({ root = DEFAULT_ROOT, port = 0 } = {}) {
  const server = http.createServer(async (req, res) => {
    const method = (req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain" });
      res.end("method not allowed");
      return;
    }

    let pathname = "/";
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      pathname = "/";
    }

    // Prevent path traversal.
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    let filePath = path.join(root, safe);
    if (!filePath.startsWith(root)) filePath = root;

    let resolved = null;
    if (await fileExists(filePath)) {
      resolved = filePath;
    } else if (await fileExists(path.join(filePath, "index.html"))) {
      resolved = path.join(filePath, "index.html");
    } else if (!path.extname(filePath) && (await fileExists(path.join(root, "index.html")))) {
      // SPA-ish fallback: extension-less unknown paths get the app shell.
      resolved = path.join(root, "index.html");
    }

    if (!resolved) {
      if (await fileExists(path.join(root, "404.html"))) {
        const body = await readFile(path.join(root, "404.html"));
        res.writeHead(404, { "content-type": MIME[".html"], "cache-control": "no-store" });
        res.end(method === "HEAD" ? undefined : body);
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }

    try {
      const body = await readFile(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const cache =
        ext === ".html" || ext === ".json" || ext === ".webmanifest"
          ? "no-store"
          : "public, max-age=0, must-revalidate";
      res.writeHead(200, {
        "content-type": contentType(resolved),
        "content-length": body.length,
        "cache-control": cache,
        // SW + maplibre worker need correct scoping/permissions
        "service-worker-allowed": "/",
      });
      res.end(method === "HEAD" ? undefined : body);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("read error: " + err.message);
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const url = `http://127.0.0.1:${addr.port}`;
      resolve({
        url,
        port: addr.port,
        root,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Allow `node scripts/sim/server.mjs [port]` for manual use.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.argv[2] || 4321);
  const s = await startServer({ port });
  console.log(`serving ${s.root} at ${s.url}`);
}
