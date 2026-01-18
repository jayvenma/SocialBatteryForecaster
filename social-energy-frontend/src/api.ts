import type { EventsResponse, MeResponse, Profile } from "./types";

// In dev, use Vite proxy (same-origin, no CORS pain)
// In prod, use env base URL
const API_BASE =
  import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL as string);

function joinUrl(base: string, path: string) {
  if (!base) return path;
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
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

/**
 * DB-backed events (your main "refresh" list)
 * Backend should implement: GET /api/events?hours=24
 */
export async function getEvents(hours = 24): Promise<EventsResponse> {
  return apiFetch<EventsResponse>(`/api/events?hours=${hours}`);
}

/**
 * Sync from Google Calendar INTO the DB (does not return events; call getEvents after)
 * Backend should implement: POST /api/google/sync?hours=24
 */
export async function syncGoogle(
  hours = 24
): Promise<{ synced: number; window_hours: number }> {
  return apiFetch<{ synced: number; window_hours: number }>(
    `/api/google/sync?hours=${hours}`,
    {
      method: "POST",
    }
  );
}

/**
 * Create a manual/local event that persists in the DB
 * Backend should implement: POST /api/events
 * Expects to return: { event: ScoredEvent }
 */
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

/**
 * Update an event in the DB
 * Backend should implement: PUT /api/events/{id}
 *
 * NOTE: This is for LOCAL events. Google events should use updateGoogleOverride.
 */
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

/**
 * Part B: Update Google event overrides (local-only)
 * Backend implements: PUT /api/events/google_overrides/{id}
 *
 * You can use this to allow editing:
 * - attendee_count
 * - event_type
 * - has_video (optional)
 * - has_conference_link (optional)
 *
 * This does NOT write back to Google Calendar.
 */
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

/**
 * Delete an event from the DB
 * Backend should implement: DELETE /api/events/{id}
 */
export async function deleteEvent(id: string) {
  return apiFetch(`/api/events/${id}`, { method: "DELETE" });
}
