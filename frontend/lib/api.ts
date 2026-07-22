import { beginRequest, endRequest } from "@/lib/loading-state";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("ghst_token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("ghst_token", token);
  else localStorage.removeItem("ghst_token");
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  beginRequest();
  try {
    const response = await fetch(`${API_URL}${path}`, { ...init, headers });
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const body = await response.json();
        message = typeof body.detail === "string" ? body.detail : body.detail?.message || message;
      } catch {}
      throw new Error(message);
    }
    return response.json() as Promise<T>;
  } finally {
    endRequest();
  }
}

export { API_URL };
