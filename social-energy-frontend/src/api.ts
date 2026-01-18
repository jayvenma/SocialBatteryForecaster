import type { EventsResponse, MeResponse, Profile } from "./types";

// In dev, use Vite proxy (same-origin, no CORS pain)
// In prod, MUST use VITE_API_BASE_URL (full backend origin)
const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;

const API_BASE =
  import.meta.env.DEV
    ? ""
    : (() => {
        if (!RAW_API_BASE) {
          throw new Error(
            "Missing VITE_API_BASE_URL in production. Set it in Vercel env vars to your Render backend origin, e.g. https://your-backend.onrender.com"
          );
        }
        return RAW_API_BASE.replace(/\/+$/, "");
      })();

function joinUrl(base: string, path: string) {
  if (!base) return path; // dev proxy
  return base + "/" + path.replace(/^\/+/, "");
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(joinUrl(API_BASE, path), {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });

  const text = await res.text();
  const data = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })()
    : null;

  if (!res.ok) {
    const msg =
      typeof data === "object" && data && "error" in data
        ? (data as any).error
        : typeof data === "string"
          ? data
          : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as T;
}

export function getApiBase() {
  return API_BASE || "proxy(/)";
}

export async function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/me");
}

export async function submitOnboarding(answers: number[]): Promise<Profile> {
  return apiFetch<Profile>("/api/onboarding", {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export async function getEvents(hours = 24): Promise<EventsResponse> {
  return apiFetch<EventsResponse>(`/api/events?hours=${hours}`);
}

export async function syncGoogle(
  hours = 24
): Promise<{ synced: number; window_hours: number }> {
  return apiFetch<{ synced: number; window_hours: number }>(
    `/api/google/sync?hours=${hours}`,
    { method: "POST" }
  );
}

export async function createEvent(data: {
  title: string;
  start: string;
  end: string;
  event_type?: string;
  attendee_count?: number;
  has_video?: boolean;
  has_conference_link?: boolean;
}) {
  return apiFetch(`/api/events`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateEvent(
  id: string,
  data: {
    title?: string;
    start?: string;
    end?: string;
    event_type?: string;
    attendee_count?: number;
    has_video?: boolean;
    has_conference_link?: boolean;
  }
) {
  return apiFetch(`/api/events/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function updateGoogleOverride(
  id: string,
  data: {
    attendee_count?: number | null;
    event_type?: string | null;
    has_video?: boolean | null;
    has_conference_link?: boolean | null;
  }
) {
  return apiFetch(`/api/events/google_overrides/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteEvent(id: string) {
  return apiFetch(`/api/events/${id}`, { method: "DELETE" });
}
