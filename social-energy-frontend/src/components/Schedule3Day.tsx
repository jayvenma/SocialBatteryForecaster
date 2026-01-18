// components/Schedule3Day.tsx
import React from "react";
import type { ScoredEvent } from "../types";
import { DayBatteryMini } from "./DayBatteryMini";

// ---- date/time helpers (local time) ----
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtHeader(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function fmtHourLabel(h: number) {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric" });
}
function fmtTimeRange(startIso: string, endIso: string) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${fmt(s)}–${fmt(e)}`;
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// ---- color helpers (score -> gradient) ----
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}
function rgbToCss(rgb: [number, number, number]) {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

/**
 * Map impact_score -> color:
 * Boost (+) trends green, Drain (-) trends red.
 * Clamp to [-15, +15].
 */
function colorForScore(score: number) {
  const s = Number.isFinite(score) ? score : 0;

  const MIN = -15;
  const MAX = 15;
  const t = clamp01((s - MIN) / (MAX - MIN));

  const red: [number, number, number] = [180, 50, 60];
  const mid: [number, number, number] = [35, 45, 65];
  const green: [number, number, number] = [35, 160, 110];

  if (t < 0.5) {
    const tt = t / 0.5;
    return rgbToCss(mixRgb(red, mid, tt));
  } else {
    const tt = (t - 0.5) / 0.5;
    return rgbToCss(mixRgb(mid, green, tt));
  }
}

type Positioned = {
  ev: ScoredEvent;
  topPx: number;
  heightPx: number;
  colIndex: number;
  colCount: number;
};

function computePositionsForDay(
  day: Date,
  events: ScoredEvent[],
  dayStartHour: number,
  dayEndHour: number,
  pxPerMinute: number
): Positioned[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);

  const inDay = events
    .map((ev) => {
      const s = new Date(ev.start);
      const e = new Date(ev.end);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
      if (e <= s) return null;
      if (s < dayEnd && e > dayStart) return ev;
      return null;
    })
    .filter((x): x is ScoredEvent => Boolean(x));

  const sorted = [...inDay].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const positioned: Positioned[] = [];

  let i = 0;
  while (i < sorted.length) {
    // build overlap cluster
    const cluster: ScoredEvent[] = [];
    let clusterEnd = new Date(sorted[i].end);
    cluster.push(sorted[i]);

    let j = i + 1;
    while (j < sorted.length) {
      const nextStart = new Date(sorted[j].start);
      if (nextStart.getTime() < clusterEnd.getTime()) {
        cluster.push(sorted[j]);
        const nextEnd = new Date(sorted[j].end);
        if (nextEnd > clusterEnd) clusterEnd = nextEnd;
        j++;
      } else {
        break;
      }
    }

    // assign columns in cluster (greedy)
    const cols: { end: number }[] = [];
    const assigned = cluster.map((ev) => {
      const s = new Date(ev.start).getTime();
      const e = new Date(ev.end).getTime();

      let colIndex = 0;
      for (; colIndex < cols.length; colIndex++) {
        if (s >= cols[colIndex].end) break;
      }
      if (colIndex === cols.length) cols.push({ end: e });
      cols[colIndex].end = e;

      return { ev, colIndex };
    });

    const colCount = cols.length;

    const visibleStartMin = dayStartHour * 60;
    const visibleEndMin = dayEndHour * 60;

    for (const a of assigned) {
      const s = new Date(a.ev.start);
      const e = new Date(a.ev.end);

      // clip to day boundaries
      const clippedStart = new Date(Math.max(s.getTime(), dayStart.getTime()));
      const clippedEnd = new Date(Math.min(e.getTime(), dayEnd.getTime()));

      const minutesFromMidnightStart = clippedStart.getHours() * 60 + clippedStart.getMinutes();
      const minutesFromMidnightEnd = clippedEnd.getHours() * 60 + clippedEnd.getMinutes();

      const topMin = clamp(minutesFromMidnightStart, visibleStartMin, visibleEndMin);
      const botMin = clamp(minutesFromMidnightEnd, visibleStartMin, visibleEndMin);

      if (botMin <= visibleStartMin || topMin >= visibleEndMin) continue;

      const topPx = (topMin - visibleStartMin) * pxPerMinute;
      const heightPxRaw = (botMin - topMin) * pxPerMinute;

      // ✅ TIME-ACCURATE: allow small blocks; no forced "fat" minimum
      const heightPx = Math.max(12, heightPxRaw);

      positioned.push({
        ev: a.ev,
        topPx,
        heightPx,
        colIndex: a.colIndex,
        colCount,
      });
    }

    i = j;
  }

  // ✅ IMPORTANT: do NOT apply any post-clamp that inflates heights (that caused the weird overlaps)
  return positioned;
}

// ---- Compact block for schedule ----
function ScheduleEventBlock({ ev, onClick }: { ev: ScoredEvent; onClick: () => void }) {
  const score = Number.isFinite(ev.impact_score) ? ev.impact_score : 0;
  const time = fmtTimeRange(ev.start, ev.end);
  const bg = colorForScore(score);

  const type = String((ev as any).event_type ?? "");
  const attendeesRaw = (ev as any).attendee_count;
  const attendees = Number.isFinite(Number(attendeesRaw)) ? Number(attendeesRaw) : 0;

  const metaParts: string[] = [];
  if (type) metaParts.push(type);
  if (attendees > 0) metaParts.push(`${attendees} attendee${attendees === 1 ? "" : "s"}`);
  const meta = metaParts.join(" • ");

  return (
    <button
      type="button"
      onClick={onClick}
      className="h-full w-full overflow-hidden schedule-sticker border-2 border-[var(--ink)] px-3 py-2 text-left"
      style={{ backgroundColor: bg }}
      title={`Edit: ${ev.title} • ${ev.impact_label} (${score.toFixed(2)})`}
    >
      <div className="font-bold text-sm leading-tight truncate">{ev.title}</div>
      {meta ? <div className="text-[11px] opacity-85 truncate">{meta}</div> : null}
      <div className="text-xs opacity-90 truncate">
        {ev.impact_label} ({score.toFixed(2)})
      </div>
      <div className="text-[11px] opacity-80 truncate">{time}</div>
    </button>
  );
}

export type ScheduleClickSlot = {
  day: Date;
  start: Date;
  end: Date;
};

type DragPreview = {
  day: Date;
  topPx: number;
  heightPx: number;
  start: Date;
  end: Date;
  score: number;
  label: string;
  valid: boolean;
};

export function Schedule3Day({
  events,
  onCreateAt,
  onEditEvent,
  onMoveEvent,
}: {
  events: ScoredEvent[];
  onCreateAt: (slot: ScheduleClickSlot) => void;
  onEditEvent: (ev: ScoredEvent) => void;
  onMoveEvent?: (id: string, start: Date, end: Date) => void;
}) {
  const now = new Date();
  const today = startOfDay(now);

  const days: Date[] = [today, startOfDay(addDays(today, 1)), startOfDay(addDays(today, 2))];

  // visible hours
  const DAY_START_HOUR = 7;
  const DAY_END_HOUR = 22;
  const PX_PER_MINUTE = 1.2;

  const totalMinutes = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const gridHeight = totalMinutes * PX_PER_MINUTE;

  const hourTicks: number[] = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) hourTicks.push(h);

  const [dragging, setDragging] = React.useState<ScoredEvent | null>(null);
  const [dragPreview, setDragPreview] = React.useState<DragPreview | null>(null);

  const perDay = days.map((d) => {
    const dayStart = startOfDay(d);
    const dayEnd = addDays(dayStart, 1);

    const list = events.filter((ev) => {
      const s = new Date(ev.start);
      const e = new Date(ev.end);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return false;
      return s < dayEnd && e > dayStart;
    });

    const dayTotal = list.reduce((acc, ev) => acc + (Number.isFinite(ev.impact_score) ? ev.impact_score : 0), 0);

    return {
      day: d,
      dayTotal,
      positioned: computePositionsForDay(d, list, DAY_START_HOUR, DAY_END_HOUR, PX_PER_MINUTE),
    };
  });

  function handleDayClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const y = e.clientY - rect.top;

    const minutesFromVisibleStart = clamp(Math.round(y / PX_PER_MINUTE), 0, totalMinutes);
    const dayMinutes = DAY_START_HOUR * 60 + minutesFromVisibleStart;
    const snapped = Math.round(dayMinutes / 15) * 15;

    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    start.setMinutes(snapped);

    const end = new Date(start.getTime() + 30 * 60 * 1000);

    onCreateAt({ day, start, end });
  }

  function computePreviewForPointer(day: Date, container: HTMLDivElement, clientY: number, dragged: ScoredEvent): DragPreview {
    const rect = container.getBoundingClientRect();
    const y = clientY - rect.top;

    const minutesFromVisibleStart = clamp(Math.round(y / PX_PER_MINUTE), 0, totalMinutes);
    const dayMinutes = DAY_START_HOUR * 60 + minutesFromVisibleStart;
    const snapped = Math.round(dayMinutes / 15) * 15;

    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    start.setMinutes(snapped);

    const draggedStart = new Date(dragged.start);
    const draggedEnd = new Date(dragged.end);
    const durMinRaw = Math.round((draggedEnd.getTime() - draggedStart.getTime()) / 60000);
    const durMin = Math.max(15, durMinRaw);

    const end = new Date(start.getTime() + durMin * 60000);

    const topPx = (snapped - DAY_START_HOUR * 60) * PX_PER_MINUTE;
    const heightPx = Math.max(12, durMin * PX_PER_MINUTE);

    const score = Number.isFinite(dragged.impact_score) ? dragged.impact_score : 0;
    const label = dragged.impact_label ?? "impact";

    const valid = snapped >= DAY_START_HOUR * 60 && snapped + durMin <= DAY_END_HOUR * 60;

    return { day, topPx, heightPx, start, end, score, label, valid };
  }

  return (
    <div className="mt-6">
      {/* headers */}
      <div className="grid grid-cols-[80px_1fr_1fr_1fr] gap-3 items-end">
        <div />
        {perDay.map(({ day, dayTotal }) => (
          <div key={day.toISOString()} className="sticker px-3 py-2 border-2 border-[var(--ink)]">
            <div className="font-bold">{fmtHeader(day)}</div>
            <div className="text-xs opacity-70">{isSameDay(day, today) ? "Today" : ""}</div>
            <DayBatteryMini dayTotal={dayTotal} />
          </div>
        ))}
      </div>

      {/* grid */}
      <div className="mt-3 grid grid-cols-[80px_1fr_1fr_1fr] gap-3">
        {/* time rail */}
        <div className="relative" style={{ height: gridHeight }}>
          {hourTicks.map((h) => {
            const y = (h - DAY_START_HOUR) * 60 * PX_PER_MINUTE;
            return (
              <div key={h} className="absolute left-0 right-0" style={{ top: y }}>
                <div className="text-xs opacity-70">{fmtHourLabel(h)}</div>
              </div>
            );
          })}
        </div>

        {/* day columns */}
        {perDay.map(({ day, positioned }) => (
          <div
            key={day.toISOString()}
            className="relative sticker border-2 border-[var(--ink)] overflow-hidden cursor-crosshair"
            style={{ height: gridHeight }}
            onClick={(e) => handleDayClick(day, e)}
            title="Click empty space to add an event"
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              const container = e.currentTarget as HTMLDivElement;
              setDragPreview(computePreviewForPointer(day, container, e.clientY, dragging));
            }}
            onDrop={(e) => {
              if (!dragging || !dragPreview) return;
              e.preventDefault();
              if ((dragging as any).source === "google") return;
              if (!dragPreview.valid) return;

              onMoveEvent?.(dragging.id, dragPreview.start, dragPreview.end);
              setDragging(null);
              setDragPreview(null);
            }}
          >
            {/* hour lines */}
            {hourTicks.map((h) => {
              const y = (h - DAY_START_HOUR) * 60 * PX_PER_MINUTE;
              return (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-white/10"
                  style={{ top: y, zIndex: 1 }}
                />
              );
            })}

            {/* ghost preview */}
            {dragPreview && isSameDay(dragPreview.day, day) && dragging ? (
              <div
                className="absolute pointer-events-none"
                style={{
                  zIndex: 50,
                  top: dragPreview.topPx,
                  left: 6,
                  right: 6,
                  height: dragPreview.heightPx,
                  opacity: dragPreview.valid ? 0.9 : 0.55,
                }}
              >
                <div
                  className="h-full w-full schedule-sticker border-2 border-dashed border-[var(--pop)] px-3 py-2 overflow-hidden"
                  style={{ backgroundColor: colorForScore(dragPreview.score) }}
                >
                  <div className="font-bold text-sm leading-tight truncate">{dragging.title}</div>
                  <div className="text-xs opacity-90 truncate">
                    {dragPreview.label} ({dragPreview.score.toFixed(2)})
                  </div>
                  <div className="text-[11px] opacity-80 truncate">
                    {fmtTimeRange(dragPreview.start.toISOString(), dragPreview.end.toISOString())}
                  </div>
                </div>
              </div>
            ) : null}

            {positioned.length === 0 ? (
              <div className="p-3 text-sm opacity-70">No events. Click to add.</div>
            ) : (
              positioned.map((p) => {
                const gap = 6;
                const colWidthPct = 100 / p.colCount;
                const leftPct = p.colIndex * colWidthPct;
                const isReadOnly = (p.ev as any).source === "google";

                return (
                  <div
                    key={p.ev.id}
                    className="absolute overflow-hidden"
                    style={{
                      zIndex: 10,
                      top: p.topPx,
                      left: `calc(${leftPct}% + ${gap}px)`,
                      width: `calc(${colWidthPct}% - ${gap * 2}px)`,
                      height: p.heightPx,
                    }}
                    draggable={!isReadOnly}
                    onDragStart={(e) => {
                      if (isReadOnly) return;
                      setDragging(p.ev);
                      e.dataTransfer.setData("text/plain", p.ev.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDragPreview(null);
                    }}
                  >
                    <ScheduleEventBlock ev={p.ev} onClick={() => onEditEvent(p.ev)} />
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 text-xs opacity-60">
        Tip: click an event to edit • click empty space to add • drag local events to move • Showing {DAY_START_HOUR}:00–
        {DAY_END_HOUR}:00 local time.
      </div>
    </div>
  );
}
