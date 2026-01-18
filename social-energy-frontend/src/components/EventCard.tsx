import React from "react";
import type { ScoredEvent } from "../types";
import { updateEvent, deleteEvent } from "../api";

type Props = {
  ev: ScoredEvent;
};

// ---- Helpers to make datetime-local behave + keep times sane ----
function isoToLocalInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string) {
  const d = new Date(local); // interpreted in local timezone
  return d.toISOString();
}

export function EventCard({ ev }: Props) {
  const [editing, setEditing] = React.useState(false);

  const [title, setTitle] = React.useState(ev.title);

  // Keep ISO values for API
  const [startIso, setStartIso] = React.useState(ev.start);
  const [endIso, setEndIso] = React.useState(ev.end);

  // Use datetime-local strings for inputs (prevents weird "white" formatting + time mismatch)
  const [startLocal, setStartLocal] = React.useState(isoToLocalInput(ev.start));
  const [endLocal, setEndLocal] = React.useState(isoToLocalInput(ev.end));

  const [saving, setSaving] = React.useState(false);

  // If card re-renders with a different event, keep form in sync
  React.useEffect(() => {
    setTitle(ev.title);
    setStartIso(ev.start);
    setEndIso(ev.end);
    setStartLocal(isoToLocalInput(ev.start));
    setEndLocal(isoToLocalInput(ev.end));
  }, [ev.id, ev.title, ev.start, ev.end]);

  const inputClass =
  "w-full sticker px-3 py-2 border-2 border-[var(--ink)] bg-transparent text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-[var(--pop)]";

  const dateClass = inputClass + " [color-scheme:dark]";

  async function handleSave() {
    // Convert the editable local values back into ISO for your DB/API
    const nextStartIso = localInputToIso(startLocal);
    const nextEndIso = localInputToIso(endLocal);

    setSaving(true);
    try {
      await updateEvent(ev.id, { title, start: nextStartIso, end: nextEndIso });
      setStartIso(nextStartIso);
      setEndIso(nextEndIso);
      setEditing(false);
      window.dispatchEvent(new Event("refresh-events"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this event?")) return;
    await deleteEvent(ev.id);
    window.dispatchEvent(new Event("refresh-events"));
  }

  if (editing) {
    return (
      <div className="sticker p-5 border-2 border-[var(--ink)]">
        <div className="comic-title text-xl mb-2">Edit Event</div>

        <input
          className={inputClass}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          disabled={saving}
        />

        <div className="mt-2">
          <input
            type="datetime-local"
            className={dateClass}
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="mt-2">
          <input
            type="datetime-local"
            className={dateClass}
            value={endLocal}
            onChange={(e) => setEndLocal(e.target.value)}
            disabled={saving}
          />
        </div>

        <div className="flex gap-3 mt-3">
          <button className="btn-comic" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            className="btn-comic"
            onClick={() => {
              // reset edits
              setTitle(ev.title);
              setStartLocal(isoToLocalInput(startIso));
              setEndLocal(isoToLocalInput(endIso));
              setEditing(false);
            }}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sticker p-5">
      <div className="font-bold text-lg">{ev.title}</div>
      <div className="text-sm opacity-80">
        {ev.impact_label} ({ev.impact_score.toFixed(2)})
      </div>

      <div className="flex gap-3 mt-3">
        <button className="btn-comic" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="btn-comic" onClick={handleDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
