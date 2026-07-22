export type User = {
  id: string;
  username: string;
  display_name: string;
  organisation_id: string;
  department: string;
  roles: string[];
};

export type Finding = {
  category: string;
  severity: string;
  confidence: number;
  detector: string;
  source: string;
  start: number;
  end: number;
  masked_preview: string;
  redactable: boolean;
  confirmed: boolean;
};

export type PolicyMatch = {
  clause_id: string;
  policy: string;
  policy_version_id: string;
  policy_version: string;
  clause: string;
  scope: string;
  action: string;
  score: number;
  text: string;
};

export type Evaluation = {
  evaluation_id: string;
  state: string;
  action: "ALLOW" | "REDACT" | "REDIRECT" | "REVIEW" | "BLOCK";
  department: string;
  purpose: string;
  destination_origin: string;
  risk: { score: number; level: string; uncertainty: number };
  findings: Finding[];
  policy_matches: PolicyMatch[];
  reason_codes: string[];
  learning_source: string;
  precedent_id?: string;
  message: string;
  review_id?: string;
  redirect_origin?: string;
  redacted_text?: string;
  model_evidence: Record<string, unknown>;
  created_at: string;
};

