from __future__ import annotations

from enum import Enum
from datetime import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, Field


class EventType(str, Enum):
    meeting = "meeting"
    one_on_one = "one_on_one"
    social = "social"
    call = "call"
    async_ = "async"
    solo = "solo"
    custom = "custom"


class Role(str, Enum):
    lead = "lead"
    participant = "participant"
    listening = "listening"


class Control(str, Enum):
    optional = "optional"
    mandatory = "mandatory"


class Environment(str, Enum):
    low_stim = "low_stim"
    med_stim = "med_stim"
    high_stim = "high_stim"


class ScoringModifiers(BaseModel):
    role: Role = Role.participant
    control: Control = Control.mandatory
    environment: Environment = Environment.med_stim
    familiarity: float = Field(0.5, ge=0.0, le=1.0, description="0=strangers, 1=trusted")
    back_to_back: bool = False


class NormalizedEvent(BaseModel):
    id: str
    title: str
    start: datetime
    end: datetime
    event_type: EventType
    attendee_count: int = 0

    has_video: bool = False
    has_conference_link: bool = False
    user_override_type: Optional[EventType] = None
    modifiers: ScoringModifiers = ScoringModifiers()


ImpactLabel = Literal["Low", "Medium", "High", "Extreme"]


class ScoreResult(BaseModel):
    impact_score: float  # negative = draining, positive = recharging
    impact_label: ImpactLabel
    reasons: List[str] = []
