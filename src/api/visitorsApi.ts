import type { BoubyanVisitor, BoubyanVisitorInsert, FlowStatus } from "@/lib/database.types";

async function request<T>(input: RequestInfo, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const response = await fetch(input, {
    ...init,
    headers,
    credentials: "same-origin", // أرسل الـ session cookie تلقائياً
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

/** تسجيل دخول الأدمن — يضع cookie مشفرة httpOnly */
export async function adminLogin(password: string): Promise<boolean> {
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ password }),
  });
  return res.ok;
}

/** تسجيل خروج الأدمن */
export async function adminLogout(): Promise<void> {
  await fetch("/api/admin/logout", {
    method: "POST",
    credentials: "same-origin",
  });
}

export function getVisitors() {
  return request<BoubyanVisitor[]>("/api/visitors");
}

export function updateVisitorStatus(id: string, stage_state: FlowStatus) {
  return request<BoubyanVisitor>(`/api/visitors/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ stage_state }),
  });
}

export function routeVisitorTo(id: string, nav_target: string) {
  return request<BoubyanVisitor>(`/api/visitors/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ stage_state: "approved", nav_target }),
  });
}

export function deleteVisitor(id: string) {
  return request<{ ok: true }>(`/api/visitors/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function deleteAllVisitors() {
  return request<{ ok: true }>("/api/visitors", { method: "DELETE" });
}

export const getLoginRequests = getVisitors;
export const updateLoginRequestStatus = updateVisitorStatus;
export const routeLoginRequestTo = routeVisitorTo;
export const deleteLoginRequest = deleteVisitor;
export const deleteAllLoginRequests = deleteAllVisitors;

export type { BoubyanVisitorInsert };
