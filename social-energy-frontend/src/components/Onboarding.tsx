import React from "react";


type Props = {
  onSubmit: (answers: number[]) => Promise<void>;
  submitting: boolean;
  error?: string | null;
};

const QUESTIONS: string[] = [
  "I feel energized after group conversations.",
  "Long meetings drain me quickly.",
  "I enjoy being the center of attention.",
  "I need quiet time alone to recharge after social events.",
  "I prefer collaborative work over solo work.",
  "Video calls feel more tiring than in-person conversations.",
  "I seek out opportunities to meet new people.",
  "I feel comfortable leading discussions or meetings.",
  "Too much social interaction makes me feel overstimulated.",
  "I like working in lively, energetic environments.",
  "I would rather communicate by message than by call.",
  "I gain energy from brainstorming with others.",
  "I feel exhausted after back-to-back meetings.",
  "I enjoy spontaneous social interactions at work.",
  "I find it easy to start conversations with strangers.",
];

function ScaleButton({
  value,
  selected,
  onClick,
}: {
  value: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={[
        "btn-comic sticker px-4 py-2 text-sm md:text-base transition-all",
        "hover:scale-105 active:scale-95",
        selected
          ? "ring-4 ring-[var(--zap)] bg-[var(--zap)] text-black shadow-lg"
          : "opacity-80 hover:opacity-100",
      ].join(" ")}
    >
      {value}
    </button>
  );
}

export default function Onboarding({ onSubmit, submitting, error }: Props) {
  const [idx, setIdx] = React.useState(0);
  const [answers, setAnswers] = React.useState<number[]>(Array(QUESTIONS.length).fill(0));

  const current = QUESTIONS[idx];
  const selected = answers[idx];

  const canNext = selected >= 1 && selected <= 5;
  const allAnswered = answers.every((a) => a >= 1 && a <= 5);

  const progress = Math.round(((idx + 1) / QUESTIONS.length) * 100);

  async function handleFinish() {
    if (!allAnswered) return;
    await onSubmit(answers);
  }

  return (
    <div className="sticker p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl md:text-3xl" style={{ fontFamily: "Bangers, Comic Neue, sans-serif" }}>
            Personality Setup
          </div>
          <div className="text-sm opacity-80 mt-1">
            Answer 15 quick questions. We’ll personalize your social drain predictions.
          </div>
        </div>

        <div className="text-right text-sm opacity-80">
          <div>
            {idx + 1} / {QUESTIONS.length}
          </div>
          <div className="mt-1">{progress}%</div>
        </div>
      </div>

      <div className="mt-4 h-3 rounded-full border-2 border-[var(--ink)] overflow-hidden">
        <div className="h-full" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-6 sticker p-5">
        <div className="text-lg md:text-xl font-bold">{current}</div>
        <div className="mt-3 text-xs opacity-70">
          1 = Strongly Disagree · 3 = Neutral · 5 = Strongly Agree
        </div>

        <div className="mt-4 flex gap-3 flex-wrap">
          {[1, 2, 3, 4, 5].map((v) => (
            <ScaleButton
              key={v}
              value={v}
              selected={selected === v}
              onClick={() => {
                const next = [...answers];
                next[idx] = v;
                setAnswers(next);
              }}
            />
          ))}
        </div>
      </div>

      {error ? (
        <div className="mt-4 sticker p-4 border-2 border-[var(--pop)]">
          <div className="font-bold">BONK!</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          className="btn-comic sticker"
          type="button"
          onClick={() => setIdx((n) => Math.max(0, n - 1))}
          disabled={idx === 0 || submitting}
        >
          Back
        </button>

        <div className="flex gap-3">
          {idx < QUESTIONS.length - 1 ? (
            <button
              className="btn-comic sticker"
              type="button"
              onClick={() => setIdx((n) => Math.min(QUESTIONS.length - 1, n + 1))}
              disabled={!canNext || submitting}
            >
              Next
            </button>
          ) : (
            <button
              className="btn-comic sticker"
              type="button"
              onClick={handleFinish}
              disabled={!allAnswered || submitting}
            >
              {submitting ? "Saving..." : "Finish"}
            </button>
          )}
        </div>
      </div>

      {idx === QUESTIONS.length - 1 && !submitting && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            className="btn-comic sticker border-2 border-[var(--pop)]"
            onClick={() => {
              setAnswers(Array(QUESTIONS.length).fill(0));
              setIdx(0);
            }}
          >
            Retake Questionnaire
          </button>
        </div>
      )}

      <div className="mt-4 text-xs opacity-70">
        Tip: Don’t overthink it—go with your first instinct.
      </div>
    </div>
  );
}
