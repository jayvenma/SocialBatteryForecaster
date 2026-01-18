export type ImpactLabel = "Low" | "Medium" | "High" | "Extreme";

export type EventSource = "google" | "local";

export type ScoredEvent = {
  id: string;
  title: string;
  start: string;
  end: string;

  location?: string | null;

  // base fields (may be overridden in backend merge)
  event_type?: string | null;
  attendee_count?: number;          // ✅ added
  has_video?: boolean;              // ✅ added
  has_conference_link?: boolean;    // ✅ added
  source?: EventSource;             // ✅ added

  // scoring
  impact_score: number;
  impact_label: ImpactLabel;
  reasons?: string[];
};

export type EventsResponse = {
  count: number;
  window_hours: number;
  personality_score_used?: number;
  events: ScoredEvent[];
};

export type Profile = {
  personality_score: number;
  label: "Introvert" | "Omnivert" | "Extrovert";
  raw_score?: number;
};

export type MeResponse = {
  authenticated: boolean;
  onboarded: boolean;
  profile?: Profile;
};
