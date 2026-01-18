// components/BatteryMeter.tsx
import { clamp } from "../utils";

type Props = {
  totalDrain: number; // negative = draining, positive = recharging
};

export function BatteryMeter({ totalDrain }: Props) {
  // Convert negative totals into positive "drain points"
  const drain = Math.max(0, -totalDrain);

  // Map drain -> remaining battery (simple, tweak as you like)
  const maxDrain = 40; // "worst day" drain scale
  const remaining = clamp(100 - (drain / maxDrain) * 100, 0, 100);

  const mood =
    remaining >= 75 ? "ZIPPY!" :
    remaining >= 45 ? "OKAY…" :
    remaining >= 20 ? "WOBBLY…" : "CRITICAL!";

  return (
    <div className="sticker p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="comic-title text-3xl">Today’s Battery</div>
          <div className="text-sm opacity-80">How much social juice you’ve got left today.</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black">{Math.round(remaining)}%</div>
          <div className="text-sm font-bold">{mood}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="h-6 rounded-full border-[3px] border-[color:var(--ink)] bg-[color:var(--paper)] overflow-hidden">
          <div
            className="h-full"
            style={{
              width: `${remaining}%`,
              background:
                "repeating-linear-gradient(45deg, rgba(251,191,36,0.9) 0 10px, rgba(96,165,250,0.9) 10px 20px)",
            }}
          />
        </div>

        <div className="mt-3 bubble p-3">
          <div className="font-bold">
            Today’s drain score: <span className="text-[color:var(--pop)]">{totalDrain.toFixed(1)}</span>
          </div>
          <div className="text-sm opacity-80">Tip: Add buffer time between high-drain events.</div>
        </div>
      </div>
    </div>
  );
}
