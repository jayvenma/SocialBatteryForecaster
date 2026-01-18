function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function DayBatteryMini({ dayTotal }: { dayTotal: number }) {
  // Your scoring currently shows drains as NEGATIVE (e.g., -12.33)
  // So drain points should be positive:
  const drain = Math.max(0, -dayTotal);

  const maxDrain = 40; // tune as needed
  const remaining = clamp(100 - (drain / maxDrain) * 100, 0, 100);

  const mood =
    remaining >= 75 ? "ZIPPY" :
    remaining >= 45 ? "OKAY" :
    remaining >= 20 ? "WOBBLY" : "CRITICAL";

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[11px] opacity-80">
        <span className="font-bold">{Math.round(remaining)}%</span>
        <span className="font-bold">{mood}</span>
      </div>

      <div className="mt-1 h-3 rounded-full border-2 border-[color:var(--ink)] bg-[color:var(--paper)] overflow-hidden">
        <div
          className="h-full"
          style={{
            width: `${remaining}%`,
            background:
              "repeating-linear-gradient(45deg, rgba(251,191,36,0.9) 0 10px, rgba(96,165,250,0.9) 10px 20px)",
          }}
        />
      </div>

      <div className="mt-1 text-[11px] opacity-70">
        Drain: {drain.toFixed(1)}
      </div>
    </div>
  );
}
