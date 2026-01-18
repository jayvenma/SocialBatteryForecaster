// App.tsx
import React from "react";
import Onboarding from "./components/Onboarding";
import { BatteryMeter } from "./components/BatteryMeter";
import type { ScoredEvent, MeResponse } from "./types";
import {
  createEvent,
  deleteEvent,
  syncGoogle,
  getApiBase,
  getEvents,
  getMe,
  submitOnboarding,
  updateEvent,
  updateGoogleOverride,
} from "./api";
import { Schedule3Day, type ScheduleClickSlot } from "./components/Schedule3Day";

type NewEventForm = {
  title: string;
  startLocal: string; // datetime-local value
  endLocal: string; // datetime-local value
  event_type: string;
  attendee_count: number;
  has_video: boolean;
};

type EditEventForm = {
  id: string;
  title: string;
  startLocal: string; // datetime-local
  endLocal: string; // datetime-local
  event_type: string;
  attendee_count: number;
  has_video: boolean;
  source?: "google" | "local";
};

function toIsoWithLocalOffset(dtLocal: string) {
  // datetime-local -> Date -> UTC ISO string
  const d = new Date(dtLocal);
  return d.toISOString();
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalValue(d: Date) {
  // Format Date -> "YYYY-MM-DDTHH:mm" in LOCAL time
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`;
}

function defaultLocalStartEndFromNow() {
  const now = new Date();
  const start = new Date(now.getTime() + 15 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return { startLocal: toDatetimeLocalValue(start), endLocal: toDatetimeLocalValue(end) };
}

function defaultLocalStartEndFromSlot(slot: ScheduleClickSlot) {
  return { startLocal: toDatetimeLocalValue(slot.start), endLocal: toDatetimeLocalValue(slot.end) };
}

function eventToEditForm(ev: ScoredEvent): EditEventForm {
  // ev.start/end are ISO strings; Date(...) converts to local time for the input value.
  const s = new Date(ev.start);
  const e = new Date(ev.end);

  return {
    id: ev.id,
    title: ev.title ?? "",
    startLocal: toDatetimeLocalValue(s),
    endLocal: toDatetimeLocalValue(e),
    event_type: (ev as any).event_type ?? "meeting",
    attendee_count: Number((ev as any).attendee_count ?? 0),
    has_video: Boolean((ev as any).has_video ?? false),
    source: (ev as any).source ?? "local",
  };
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function App() {
  const [me, setMe] = React.useState<MeResponse | null>(null);

  const [events, setEvents] = React.useState<ScoredEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = React.useState(false);
  const [eventsError, setEventsError] = React.useState<string | null>(null);

  const [onboardingSaving, setOnboardingSaving] = React.useState(false);
  const [onboardingError, setOnboardingError] = React.useState<string | null>(null);

  // New Event Modal state
  const [showNew, setShowNew] = React.useState(false);
  const [newSaving, setNewSaving] = React.useState(false);
  const [newError, setNewError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<NewEventForm>(() => {
    const { startLocal, endLocal } = defaultLocalStartEndFromNow();
    return {
      title: "",
      startLocal,
      endLocal,
      event_type: "meeting",
      attendee_count: 0,
      has_video: false,
    };
  });

  // Edit Event Modal state
  const [showEdit, setShowEdit] = React.useState(false);
  const [editSaving, setEditSaving] = React.useState(false);
  const [editDeleting, setEditDeleting] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [editForm, setEditForm] = React.useState<EditEventForm | null>(null);

  async function refreshMe() {
    try {
      const data = await getMe();
      setMe(data);
    } catch {
      setMe({ authenticated: false, onboarded: false } as any);
    }
  }

  async function loadEvents() {
    setLoadingEvents(true);
    setEventsError(null);
    try {
      const data = await getEvents(72);
      setEvents(data.events || []);
    } catch (e: any) {
      setEvents([]);
      setEventsError(e?.message || "Failed to fetch");
    } finally {
      setLoadingEvents(false);
    }
  }

  React.useEffect(() => {
    refreshMe();
  }, []);

  React.useEffect(() => {
    if (me?.authenticated && me?.onboarded) {
      loadEvents();
    }
  }, [me?.authenticated, me?.onboarded]);

  React.useEffect(() => {
    const fn = () => loadEvents();
    window.addEventListener("refresh-events", fn);
    return () => window.removeEventListener("refresh-events", fn);
  }, [me?.authenticated, me?.onboarded]);

  async function handleOnboardingSubmit(answers: number[]) {
    setOnboardingSaving(true);
    setOnboardingError(null);
    try {
      await submitOnboarding(answers);
      await refreshMe();
      await loadEvents();
    } catch (e: any) {
      setOnboardingError(e?.message || "Couldn’t save onboarding.");
    } finally {
      setOnboardingSaving(false);
    }
  }

  const apiBase = getApiBase();

  async function handleRetakePersonality() {
    await fetch("/api/onboarding", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: [] }),
    });
    await refreshMe();
  }

  async function handleSyncGoogle() {
    setLoadingEvents(true);
    setEventsError(null);
    try {
      await syncGoogle(72);
      await loadEvents();
    } catch (e: any) {
      setEventsError(e?.message || "Failed to sync Google");
    } finally {
      setLoadingEvents(false);
    }
  }

  function openNewEvent() {
    setNewError(null);
    const { startLocal, endLocal } = defaultLocalStartEndFromNow();
    setForm({
      title: "",
      startLocal,
      endLocal,
      event_type: "meeting",
      attendee_count: 0,
      has_video: false,
    });
    setShowNew(true);
  }

  function openNewAtSlot(slot: ScheduleClickSlot) {
    setNewError(null);
    const { startLocal, endLocal } = defaultLocalStartEndFromSlot(slot);
    setForm({
      title: "",
      startLocal,
      endLocal,
      event_type: "meeting",
      attendee_count: 0,
      has_video: false,
    });
    setShowNew(true);
  }

  async function submitNewEvent(e: React.FormEvent) {
    e.preventDefault();
    setNewError(null);

    const title = form.title.trim();
    if (!title) return setNewError("Title is required.");
    if (!form.startLocal || !form.endLocal) return setNewError("Start and end are required.");

    const startIso = toIsoWithLocalOffset(form.startLocal);
    const endIso = toIsoWithLocalOffset(form.endLocal);

    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      return setNewError("End must be after start.");
    }

    setNewSaving(true);
    try {
      await createEvent({
        title,
        start: startIso,
        end: endIso,
        event_type: form.event_type,
        attendee_count: Number(form.attendee_count) || 0,
        has_video: !!form.has_video,
      } as any);

      setShowNew(false);
      await loadEvents();
    } catch (err: any) {
      setNewError(err?.message || "Failed to create event.");
    } finally {
      setNewSaving(false);
    }
  }

  function openEditEvent(ev: ScoredEvent) {
    setEditError(null);
    setEditForm(eventToEditForm(ev));
    setShowEdit(true);
  }

  function closeEdit() {
    if (editSaving || editDeleting) return;
    setShowEdit(false);
    setEditForm(null);
    setEditError(null);
  }

  async function submitEditEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!editForm) return;

    setEditError(null);

    const isGoogle = editForm.source === "google";

    // For local events, validate title/time. For google override edits, do not require.
    const title = editForm.title.trim();
    if (!isGoogle && !title) return setEditError("Title is required.");
    if (!isGoogle && (!editForm.startLocal || !editForm.endLocal)) return setEditError("Start and end are required.");

    const startIso = !isGoogle ? toIsoWithLocalOffset(editForm.startLocal) : null;
    const endIso = !isGoogle ? toIsoWithLocalOffset(editForm.endLocal) : null;

    if (!isGoogle && startIso && endIso) {
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        return setEditError("End must be after start.");
      }
    }

    setEditSaving(true);
    try {
      if (isGoogle) {
        // Save local-only overrides for Google event
        await updateGoogleOverride(editForm.id, {
          event_type: editForm.event_type,
          attendee_count: Number(editForm.attendee_count) || 0,
          has_video: !!editForm.has_video,
        });
      } else {
        // Normal DB update for local events
        await updateEvent(editForm.id, {
          title,
          start: startIso!,
          end: endIso!,
          event_type: editForm.event_type,
          attendee_count: Number(editForm.attendee_count) || 0,
          has_video: !!editForm.has_video,
        } as any);
      }

      setShowEdit(false);
      setEditForm(null);
      await loadEvents();
    } catch (err: any) {
      setEditError(err?.message || "Failed to update event.");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteEvent() {
    if (!editForm) return;

    if (editForm.source === "google") {
      setEditError("Google events can’t be deleted here. (You can delete local events only.)");
      return;
    }

    const ok = window.confirm("Delete this event? This cannot be undone.");
    if (!ok) return;

    setEditDeleting(true);
    setEditError(null);
    try {
      await deleteEvent(editForm.id);
      setShowEdit(false);
      setEditForm(null);
      await loadEvents();
    } catch (err: any) {
      setEditError(err?.message || "Failed to delete event.");
    } finally {
      setEditDeleting(false);
    }
  }

  // drag/drop move handler (local only)
  async function handleMoveEvent(id: string, start: Date, end: Date) {
    const ev = events.find((x) => x.id === id);
    if (!ev) return;

    if ((ev as any).source === "google") return;

    try {
      setLoadingEvents(true);
      await updateEvent(id, { start: start.toISOString(), end: end.toISOString() } as any);
      await loadEvents();
    } catch (e: any) {
      setEventsError(e?.message || "Failed to move event.");
      await loadEvents();
    } finally {
      setLoadingEvents(false);
    }
  }

  // ---- UI states ----
  if (!me || !me.authenticated) {
    return (
      <div className="min-h-screen comic-bg px-6 py-10">
        <div className="max-w-5xl mx-auto">
          <div className="text-5xl md:text-6xl" style={{ fontFamily: "Bangers, Comic Neue, sans-serif" }}>
            Social Energy Forecast
          </div>
          <div className="mt-2 opacity-80">Connect Google so we can read your calendar and predict social drain.</div>

          <div className="mt-8 sticker p-6 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-xl font-bold">Step 1: Connect Google</div>
              <div className="text-sm opacity-80 mt-1">We only use calendar data to compute your energy forecast.</div>
            </div>

            <a className="btn-comic sticker" href={`${import.meta.env.VITE_API_BASE_URL}/auth/login`}>
              Connect Google
            </a>
          </div>

          <div className="mt-6 text-xs opacity-70">Backend: {apiBase}</div>
        </div>
      </div>
    );
  }

  if (!me.onboarded) {
    return (
      <div className="min-h-screen comic-bg px-6 py-10">
        <div className="max-w-4xl mx-auto">
          <Onboarding onSubmit={handleOnboardingSubmit} submitting={onboardingSaving} error={onboardingError} />
          <div className="mt-6 text-xs opacity-70">Backend: {apiBase}</div>
        </div>
      </div>
    );
  }

  // ✅ TODAY-ONLY battery drain
  const today0 = startOfDay(new Date());
  const todayEvents = events.filter((ev) => {
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    return isSameDay(s, today0) || isSameDay(e, today0) || (s < new Date(today0.getTime() + 86400000) && e > today0);
  });

  const totalDrain = todayEvents.reduce(
    (acc, ev) => acc + (Number.isFinite(ev.impact_score) ? ev.impact_score : 0),
    0
  );

  // ✅ TRUE Top Drains: your drains are NEGATIVE, so we take most-negative first
  const topDrains = [...events]
    .filter((e) => (e.impact_score ?? 0) < 0)
    .sort((a, b) => (a.impact_score ?? 0) - (b.impact_score ?? 0))
    .slice(0, 3);

  return (
    <div className="min-h-screen comic-bg px-6 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="text-5xl md:text-6xl" style={{ fontFamily: "Bangers, Comic Neue, sans-serif" }}>
              Social Energy Forecast
            </div>
            <div className="mt-2 opacity-80">
              Your calendar, but with a superpower: <b>predicting social drain</b>.
            </div>
            <div className="mt-1 text-sm opacity-70 flex items-center gap-3 flex-wrap">
              <div>
                Personality: <b>{me.profile?.label}</b> ({me.profile?.personality_score})
              </div>
              <button
                type="button"
                className="btn-comic sticker border-2 border-[var(--pop)] text-xs"
                onClick={handleRetakePersonality}
              >
                Retake Test
              </button>
            </div>
          </div>

          <div className="flex gap-3 items-center flex-wrap">
            <button className="btn-comic sticker" onClick={loadEvents} disabled={loadingEvents}>
              {loadingEvents ? "Loading..." : "Refresh"}
            </button>

            <button className="btn-comic sticker" onClick={handleSyncGoogle} disabled={loadingEvents}>
              Sync Google
            </button>

            <button
              className="btn-comic sticker border-2 border-[var(--pop)]"
              onClick={openNewEvent}
              disabled={loadingEvents}
            >
              + Add Event
            </button>

            <a className="btn-comic sticker" href="/auth/logout">
              Logout
            </a>

            <div className="sticker px-4 py-3 text-sm">
              <div className="opacity-70">Backend</div>
              <div className="font-bold">{apiBase}</div>
            </div>
          </div>
        </div>

        {/* New Event Modal */}
        {showNew ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60" onClick={() => !newSaving && setShowNew(false)} />
            <div className="relative w-full max-w-xl sticker p-6 border-2 border-[var(--pop)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-3xl" style={{ fontFamily: "Bangers, Comic Neue, sans-serif" }}>
                    New Event
                  </div>
                  <div className="text-sm opacity-70">Creates a local event stored in your DB.</div>
                </div>
                <button className="btn-comic sticker text-sm" onClick={() => !newSaving && setShowNew(false)} type="button">
                  Close
                </button>
              </div>

              <form className="mt-5 space-y-4" onSubmit={submitNewEvent}>
                <div>
                  <div className="text-sm font-bold">Title</div>
                  <input
                    className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Team Standup"
                    maxLength={80}
                    disabled={newSaving}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-bold">Start</div>
                    <input
                      type="datetime-local"
                      className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                      value={form.startLocal}
                      onChange={(e) => setForm((f) => ({ ...f, startLocal: e.target.value }))}
                      disabled={newSaving}
                    />
                  </div>

                  <div>
                    <div className="text-sm font-bold">End</div>
                    <input
                      type="datetime-local"
                      className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                      value={form.endLocal}
                      onChange={(e) => setForm((f) => ({ ...f, endLocal: e.target.value }))}
                      disabled={newSaving}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm font-bold">Type</div>
                    <select
                      className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                      value={form.event_type}
                      onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value }))}
                      disabled={newSaving}
                    >
                      <option value="meeting">meeting</option>
                      <option value="one_on_one">one_on_one</option>
                      <option value="social">social</option>
                      <option value="call">call</option>
                      <option value="async">async</option>
                      <option value="solo">solo</option>
                      <option value="custom">custom</option>
                    </select>
                  </div>

                  <div>
                    <div className="text-sm font-bold">Attendees</div>
                    <input
                      type="number"
                      min={0}
                      className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                      value={form.attendee_count}
                      onChange={(e) => setForm((f) => ({ ...f, attendee_count: Number(e.target.value) }))}
                      disabled={newSaving}
                    />
                  </div>

                  <div className="flex items-end">
                    <label className="flex items-center gap-2 sticker px-3 py-2 border-2 border-[var(--ink)] w-full">
                      <input
                        type="checkbox"
                        checked={form.has_video}
                        onChange={(e) => setForm((f) => ({ ...f, has_video: e.target.checked }))}
                        disabled={newSaving}
                      />
                      <span className="text-sm font-bold">Video</span>
                    </label>
                  </div>
                </div>

                {newError ? (
                  <div className="sticker p-3 border-2 border-[var(--pop)] text-sm">
                    <b>Oops:</b> {newError}
                  </div>
                ) : null}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button type="button" className="btn-comic sticker" onClick={() => setShowNew(false)} disabled={newSaving}>
                    Cancel
                  </button>

                  <button type="submit" className="btn-comic sticker border-2 border-[var(--pop)]" disabled={newSaving}>
                    {newSaving ? "Saving..." : "Create Event"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        {/* Edit Event Modal */}
        {showEdit && editForm ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/60" onClick={closeEdit} />
            <div className="relative w-full max-w-xl sticker p-6 border-2 border-[var(--pop)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-3xl" style={{ fontFamily: "Bangers, Comic Neue, sans-serif" }}>
                    Edit Event
                  </div>
                  <div className="text-sm opacity-70">
                    {editForm.source === "google"
                      ? "Google-synced event (overrides saved locally)"
                      : "Local event stored in your DB"}
                  </div>
                </div>
                <button
                  className="btn-comic sticker text-sm"
                  onClick={closeEdit}
                  type="button"
                  disabled={editSaving || editDeleting}
                >
                  Close
                </button>
              </div>

              <form className="mt-5 space-y-4" onSubmit={submitEditEvent}>
                <div>
                  <div className="text-sm font-bold">Title</div>
                  <input
                    className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => (f ? { ...f, title: e.target.value } : f))}
                    maxLength={80}
                    disabled={editSaving || editDeleting || editForm.source === "google"}
                    title={editForm.source === "google" ? "Title is read-only for Google events" : ""}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm font-bold">Start</div>
                    <input
                      type="datetime-local"
                      className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                      value={editForm.startLocal}
                      onChange={(e) => setEditForm((f) => (f ? { ...f, startLocal: e.target.value } : f))}
                      disabled={editSaving || editDeleting || editForm.source === "google"}
                      title={editForm.source === "google" ? "Time is read-only for Google events" : ""}
                    />
                  </div>

                  <div>
                    <div className="text-sm font-bold">End</div>
                    <input
                      type="datetime-local"
                      className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                      value={editForm.endLocal}
                      onChange={(e) => setEditForm((f) => (f ? { ...f, endLocal: e.target.value } : f))}
                      disabled={editSaving || editDeleting || editForm.source === "google"}
                      title={editForm.source === "google" ? "Time is read-only for Google events" : ""}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <div className="text-sm font-bold">Type</div>
                    <select
                      className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                      value={editForm.event_type}
                      onChange={(e) => setEditForm((f) => (f ? { ...f, event_type: e.target.value } : f))}
                      disabled={editSaving || editDeleting}
                    >
                      <option value="meeting">meeting</option>
                      <option value="one_on_one">one_on_one</option>
                      <option value="social">social</option>
                      <option value="call">call</option>
                      <option value="async">async</option>
                      <option value="solo">solo</option>
                      <option value="custom">custom</option>
                    </select>
                  </div>

                  <div>
                    <div className="text-sm font-bold">Attendees</div>
                    <input
                      type="number"
                      min={0}
                      className="mt-1 w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent"
                      value={editForm.attendee_count}
                      onChange={(e) => setEditForm((f) => (f ? { ...f, attendee_count: Number(e.target.value) } : f))}
                      disabled={editSaving || editDeleting}
                    />
                  </div>

                  <div className="flex items-end">
                    <label className="flex items-center gap-2 sticker px-3 py-2 border-2 border-[var(--ink)] w-full">
                      <input
                        type="checkbox"
                        checked={editForm.has_video}
                        onChange={(e) => setEditForm((f) => (f ? { ...f, has_video: e.target.checked } : f))}
                        disabled={editSaving || editDeleting}
                      />
                      <span className="text-sm font-bold">Video</span>
                    </label>
                  </div>
                </div>

                {editError ? (
                  <div className="sticker p-3 border-2 border-[var(--pop)] text-sm">
                    <b>Oops:</b> {editError}
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    className="btn-comic sticker border-2 border-[var(--pop)]"
                    onClick={handleDeleteEvent}
                    disabled={editSaving || editDeleting || editForm.source === "google"}
                    title={editForm.source === "google" ? "Google events can’t be deleted here" : "Delete this event"}
                  >
                    {editDeleting ? "Deleting..." : "Delete"}
                  </button>

                  <div className="flex items-center gap-3">
                    <button type="button" className="btn-comic sticker" onClick={closeEdit} disabled={editSaving || editDeleting}>
                      Cancel
                    </button>

                    <button
                      type="submit"
                      className="btn-comic sticker border-2 border-[var(--pop)]"
                      disabled={editSaving || editDeleting}
                    >
                      {editSaving ? "Saving..." : editForm.source === "google" ? "Save Overrides" : "Save Changes"}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        ) : null}

        <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            <div className="sticker p-6">
              <BatteryMeter totalDrain={totalDrain} />
            </div>

            <div className="sticker p-6">
              <div className="text-2xl" style={{ fontFamily: "Bangers, Comic Neue, sans-serif" }}>
                Top Drains
              </div>
              <div className="text-sm opacity-70">The biggest energy vampires coming up.</div>

              <div className="mt-4 space-y-3">
                {topDrains.length === 0 ? (
                  <div className="text-sm opacity-80">No drains detected — you might be invincible ✨</div>
                ) : (
                  topDrains.map((e) => (
                    <div key={e.id} className="sticker p-4">
                      <div className="font-bold">{e.title}</div>
                      <div className="text-sm opacity-70">{(e.impact_score ?? 0).toFixed(1)} impact</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 sticker p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-3xl" style={{ fontFamily: "Bangers, Comic Neue, sans-serif" }}>
                  Upcoming Events
                </div>
                <div className="text-sm opacity-70">
                  3-day schedule view (Today + next 2 days) from <code>/api/events</code>
                </div>
              </div>
              <div className="text-sm">
                Count: <b>{events.length}</b>
              </div>
            </div>

            {eventsError ? (
              <div className="mt-6 sticker p-5 border-2 border-[var(--pop)]">
                <div className="font-bold">BONK!</div>
                <div className="mt-1">Couldn’t load events.</div>
                <div className="mt-2 text-sm opacity-80">{eventsError}</div>
                <div className="mt-3 text-xs opacity-70">Try Refresh or Sync Google.</div>
              </div>
            ) : null}

            {events.length === 0 && !eventsError ? (
              <div className="mt-6 text-sm opacity-80">No events in the selected window. Try Sync Google.</div>
            ) : (
              <Schedule3Day
                events={events}
                onCreateAt={openNewAtSlot}
                onEditEvent={openEditEvent}
                onMoveEvent={handleMoveEvent}
              />
            )}
          </div>
        </div>

        <div className="mt-10 text-center text-xs opacity-70">
          Built with ✏️ bold outlines, ✨ stickers, and a tiny bit of chaos.
        </div>
      </div>
    </div>
  );
}
