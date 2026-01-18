from __future__ import annotations

from datetime import datetime
from .schemas import NormalizedEvent, ScoreResult, EventType
from .personality import personality_multiplier

# Base energy cost per event type (positive = recharge, negative = drain)
BASE_COST = {
    EventType.meeting: -10.0,
    EventType.one_on_one: -6.0,
    EventType.social: -8.0,
    EventType.call: -7.0,
    EventType.async_: -2.0,
    EventType.solo: +6.0,
    EventType.custom: -5.0,
}


def minutes_between(a: datetime, b: datetime) -> int:
    return max(0, int((b - a).total_seconds() // 60))


def _label_for_impact(impact: float) -> str:
    """
    Frontend expects: Low | Medium | High | Extreme
    Label is intensity based on |impact|, regardless of sign.
    Sign lives in impact_score (negative = drain, positive = boost).
    """
    mag = abs(impact)
    if mag >= 12:
        return "Extreme"
    if mag >= 6:
        return "High"
    if mag >= 2:
        return "Medium"
    return "Low"


def score_event(event: NormalizedEvent, personality_score: int) -> ScoreResult:
    etype = event.user_override_type or event.event_type
    base = BASE_COST.get(etype, -6.0)

    duration_min = minutes_between(event.start, event.end)
    duration_factor = 1.0 + 0.4 * (duration_min / 60)

    b2b_factor = 1.3 if event.modifiers.back_to_back else 1.0

    role_factor = {
        "lead": 1.25,
        "participant": 1.0,
        "listening": 0.85,
    }[event.modifiers.role.value]

    familiarity_factor = 1.0 - 0.25 * event.modifiers.familiarity

    control_factor = 0.85 if event.modifiers.control.value == "optional" else 1.0

    environment_factor = {
        "low_stim": 0.8,
        "med_stim": 1.0,
        "high_stim": 1.25,
    }[event.modifiers.environment.value]

    video_factor = 1.15 if event.has_video else 1.0

    p_mult = max(0.6, float(personality_multiplier(personality_score)))

    raw = (
        base
        * duration_factor
        * b2b_factor
        * role_factor
        * familiarity_factor
        * control_factor
        * environment_factor
        * video_factor
        * p_mult
    )

    impact = round(raw, 2)

    # Prevent negative zero and tiny noise
    if abs(impact) < 0.5:
        impact = 0.0

    reasons = []
    reasons.append(f"Base {etype.value} cost")
    if duration_min > 30:
        reasons.append("Long duration increases intensity")
    if event.modifiers.back_to_back:
        reasons.append("Back-to-back fatigue")
    if event.has_video:
        reasons.append("Video fatigue")
    reasons.append("Personality factor applied")

    label = _label_for_impact(impact)

    return ScoreResult(
        impact_score=impact,
        impact_label=label,
        reasons=reasons,
    )
