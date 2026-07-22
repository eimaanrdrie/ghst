"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  Bot,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  EyeOff,
  Filter,
  Hand,
  LockKeyhole,
  RefreshCw,
  Shield,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { api } from "@/lib/api";

type Summary = {
  total_evaluations: number;
  actions: Record<string, number>;
  departments: Record<string, number>;
  department_alerts?: Record<string, number>;
  pending_reviews: number;
  active_precedents: number;
  active_policies?: number;
  approved_destinations?: number;
  audit_events?: number;
  local_classifier_latency_ms?: number | null;
  raw_prompt_storage: boolean;
};

type Health = {
  status: string;
  dependencies: {
    database: string;
    database_provider: string;
    policy_store: string;
    local_model: string;
  };
  external_release_enabled: boolean;
  demo_mode: boolean;
};

type DecisionKey = "ALLOW" | "REDACT" | "BLOCK" | "REVIEW";

const decisionConfig: Array<{
  key: DecisionKey;
  label: string;
  icon: typeof CheckCircle2;
  tone: "allow" | "redact" | "block" | "review";
}> = [
  { key: "ALLOW", label: "Allowed", icon: CheckCircle2, tone: "allow" },
  { key: "REDACT", label: "Redacted", icon: Filter, tone: "redact" },
  { key: "BLOCK", label: "Blocked", icon: Hand, tone: "block" },
  { key: "REVIEW", label: "Reviewed", icon: UserRoundCheck, tone: "review" },
];

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedDecision, setSelectedDecision] = useState<DecisionKey>("ALLOW");
  const [selectedDepartment, setSelectedDepartment] = useState("");
  const [selectedComponent, setSelectedComponent] = useState("gateway");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextHealth] = await Promise.all([
        api<Summary>("/dashboard/summary"),
        api<Health>("/health/ready"),
      ]);
      setSummary(nextSummary);
      setHealth(nextHealth);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load control-plane telemetry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const actionCounts = summary?.actions || { ALLOW: 0, REDACT: 0, REDIRECT: 0, REVIEW: 0, BLOCK: 0 };
  const totalTracked = Math.max(
    1,
    (actionCounts.ALLOW || 0) + (actionCounts.REDACT || 0) + (actionCounts.BLOCK || 0) + (actionCounts.REVIEW || 0),
  );

  const decisionItems = useMemo(() => {
    return decisionConfig.map((item) => ({
      ...item,
      count: actionCounts[item.key] || 0,
      percent: ((actionCounts[item.key] || 0) / totalTracked) * 100,
    }));
  }, [actionCounts, totalTracked]);

  useEffect(() => {
    const strongest = decisionItems.slice().sort((left, right) => right.count - left.count)[0];
    if (strongest) setSelectedDecision(strongest.key);
  }, [decisionItems]);

  const departmentRows = useMemo(() => {
    const alerts = summary?.department_alerts || {};
    return Object.entries(summary?.departments || {})
      .sort((left, right) => right[1] - left[1])
      .map(([department, total]) => ({
        department,
        total,
        alerts: alerts[department] || 0,
      }));
  }, [summary]);

  useEffect(() => {
    if (!selectedDepartment && departmentRows[0]) {
      setSelectedDepartment(departmentRows[0].department);
    }
  }, [departmentRows, selectedDepartment]);

  const maxDepartmentTotal = Math.max(1, ...departmentRows.map((row) => row.total));

  const componentItems = useMemo(() => {
    const gatewayHealthy = health?.status === "ready" && Boolean(health?.external_release_enabled);
    return [
      {
        key: "browser",
        label: "Browser",
        icon: Shield,
        metric: `${summary?.total_evaluations ? "100%" : "Idle"}`,
        tone: summary?.total_evaluations ? "ok" : "neutral",
      },
      {
        key: "dlp",
        label: "DLP",
        icon: Filter,
        metric: summary?.local_classifier_latency_ms ? `${Math.round(summary.local_classifier_latency_ms)} ms` : "Ready",
        tone: health?.dependencies.local_model?.includes("configured") ? "ok" : "warn",
      },
      {
        key: "policy",
        label: "Policy memory",
        icon: BookOpenCheck,
        metric: `${summary?.active_policies || 0} active`,
        tone: health?.dependencies.policy_store === "ready" ? "ok" : "warn",
      },
      {
        key: "ace",
        label: "ACE",
        icon: BrainCircuit,
        metric: `${summary?.active_precedents || 0} reuses`,
        tone: (summary?.active_precedents || 0) > 0 ? "ok" : "neutral",
      },
      {
        key: "gateway",
        label: "Signed gateway",
        icon: LockKeyhole,
        metric: gatewayHealthy ? "100%" : "Degraded",
        tone: gatewayHealthy ? "ok" : "degraded",
      },
      {
        key: "approved-ai",
        label: "Approved AI",
        icon: Bot,
        metric: `${summary?.approved_destinations || 0} approved`,
        tone: (summary?.approved_destinations || 0) > 0 ? "ok" : "warn",
      },
    ];
  }, [health, summary]);

  const postureItems = useMemo(() => {
    return [
      { key: "identity", label: "Identity trusted", value: "100%", tone: "ok" },
      { key: "browser", label: "Browser enforcement", value: summary ? "Online" : "Waiting", tone: "ok" },
      { key: "policy", label: "Policy memory", value: `Synced · ${summary?.active_policies || 0} active`, tone: health?.dependencies.policy_store === "ready" ? "ok" : "warn" },
      { key: "classifier", label: "Local classifier", value: summary?.local_classifier_latency_ms ? `Ready · ${Math.round(summary.local_classifier_latency_ms)} ms` : "Ready", tone: health?.dependencies.local_model?.includes("configured") ? "ok" : "warn" },
      { key: "gateway", label: "Signed gateway", value: health?.status === "ready" ? "Online" : "Degraded", tone: health?.status === "ready" ? "ok" : "degraded" },
      { key: "audit", label: "Audit chain", value: `Valid · ${summary?.audit_events || 0} events`, tone: "ok" },
    ];
  }, [health, summary]);

  const attentionItems = useMemo(() => {
    const items: Array<{ key: string; label: string; tone: "warn" | "ok" | "degraded" }> = [];
    if (health?.status !== "ready") {
      items.push({ key: "gateway", label: "Investigate signed gateway readiness", tone: "degraded" });
    }
    if ((summary?.pending_reviews || 0) > 0) {
      items.push({ key: "reviews", label: `${summary?.pending_reviews} human reviews require action`, tone: "warn" });
    }
    if (summary && summary.raw_prompt_storage === false) {
      items.push({ key: "raw-prompts", label: "No raw prompts retained", tone: "ok" });
    }
    if (!items.length) {
      items.push({ key: "steady", label: "No bypass attempts detected", tone: "ok" });
    }
    return items;
  }, [health, summary]);

  const selectedDecisionItem = decisionItems.find((item) => item.key === selectedDecision) || decisionItems[0];

  return (
    <Shell hideSidebarCommandCard compactSystemBar>
      <div className="page control-plane-page">
        <header className="control-plane-header">
          <div className="control-plane-title">
            <h1>Control plane</h1>
            <p>Live governance posture</p>
          </div>
          <div className="control-plane-toolbar">
            <button type="button" className="control-plane-toolbar-chip">
              <span className={`control-plane-live-dot${health?.status === "ready" ? " live" : " degraded"}`} />
              {health?.status === "ready" ? "Live" : "Degraded"}
            </button>
            <button type="button" className="control-plane-toolbar-chip">
              <CalendarDays size={16} aria-hidden="true" />
              Last 24 hours
            </button>
            <button type="button" className="control-plane-toolbar-icon" onClick={() => void load()} title="Refresh control plane">
              <RefreshCw size={16} aria-hidden="true" />
            </button>
            <button type="button" className="control-plane-toolbar-chip">
              <EyeOff size={16} aria-hidden="true" />
              Raw prompts: {summary?.raw_prompt_storage === false ? "OFF" : "ON"}
            </button>
          </div>
        </header>

        {loading ? (
          <section className="control-plane-skeleton" aria-label="Loading control plane">
            <div className="control-plane-summary-strip control-plane-skeleton-strip">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="control-plane-skeleton-card">
                  <span className="control-plane-skeleton-dot" />
                  <div className="control-plane-skeleton-lines">
                    <span className="control-plane-skeleton-line short" />
                    <span className="control-plane-skeleton-line" />
                  </div>
                </div>
              ))}
            </div>

            <div className="control-plane-enforcement control-plane-skeleton-enforcement">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="control-plane-skeleton-step-wrap">
                  <div className="control-plane-skeleton-step">
                    <span className="control-plane-skeleton-node" />
                    <span className="control-plane-skeleton-line medium" />
                    <span className="control-plane-skeleton-line short" />
                  </div>
                  {index < 5 && <span className="control-plane-enforcement-line" aria-hidden="true" />}
                </div>
              ))}
            </div>

            <div className="control-plane-workspace control-plane-skeleton-workspace">
              <section className="control-plane-outcomes">
                <div className="control-plane-skeleton-panel-head">
                  <span className="control-plane-skeleton-line medium" />
                  <span className="control-plane-skeleton-line short" />
                </div>
                <div className="control-plane-skeleton-bar" />
                <div className="control-plane-skeleton-grid">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="control-plane-skeleton-legend">
                      <span className="control-plane-skeleton-dot small" />
                      <div className="control-plane-skeleton-lines">
                        <span className="control-plane-skeleton-line short" />
                        <span className="control-plane-skeleton-line" />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="control-plane-skeleton-list">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="control-plane-skeleton-row">
                      <span className="control-plane-skeleton-line medium" />
                      <span className="control-plane-skeleton-bar inline" />
                      <span className="control-plane-skeleton-line tiny" />
                    </div>
                  ))}
                </div>
              </section>

              <section className="control-plane-posture">
                <div className="control-plane-skeleton-panel-head">
                  <span className="control-plane-skeleton-line medium" />
                </div>
                <div className="control-plane-skeleton-list">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="control-plane-skeleton-row compact">
                      <span className="control-plane-skeleton-line medium" />
                      <span className="control-plane-skeleton-line short" />
                      <span className="control-plane-skeleton-dot small" />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </section>
        ) : error ? (
          <section className="control-plane-state">
            <AlertTriangle size={18} aria-hidden="true" />
            <p>{error}</p>
          </section>
        ) : !summary || !health ? (
          <section className="control-plane-state">
            <AlertTriangle size={18} aria-hidden="true" />
            <p>No control-plane telemetry available.</p>
          </section>
        ) : (
          <>
            <section className="control-plane-summary-strip" aria-label="Decision summary">
              <button type="button" className="control-plane-summary-item">
                <span className="control-plane-summary-icon neutral">
                  <Shield size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>{summary.total_evaluations}</strong>
                  <span>Evaluations</span>
                </div>
              </button>
              {decisionItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    type="button"
                    key={item.key}
                    className={`control-plane-summary-item${selectedDecision === item.key ? " active" : ""}`}
                    onClick={() => setSelectedDecision(item.key)}
                  >
                    <span className={`control-plane-summary-icon ${item.tone}`}>
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>{item.count}</strong>
                      <span>{item.label}</span>
                    </div>
                  </button>
                );
              })}
              <button type="button" className="control-plane-summary-item">
                <span className="control-plane-summary-icon neutral">
                  <UserRoundCheck size={18} aria-hidden="true" />
                </span>
                <div>
                  <strong>{summary.pending_reviews}</strong>
                  <span>Pending</span>
                </div>
              </button>
            </section>

            <section className="control-plane-enforcement">
              {componentItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div className="control-plane-enforcement-step-wrap" key={item.key}>
                    <button
                      type="button"
                      className={`control-plane-enforcement-step${selectedComponent === item.key ? " active" : ""}`}
                      onClick={() => setSelectedComponent(item.key)}
                    >
                      <span className={`control-plane-enforcement-node ${item.tone}`}>
                        <Icon size={26} aria-hidden="true" />
                        <i className={`control-plane-node-indicator ${item.tone}`} aria-hidden="true" />
                      </span>
                      <strong>{item.label}</strong>
                      <small>{item.metric}</small>
                    </button>
                    {index < componentItems.length - 1 && <span className="control-plane-enforcement-line" aria-hidden="true" />}
                  </div>
                );
              })}
            </section>

            <section className="control-plane-workspace">
              <section className="control-plane-outcomes">
                <div className="control-plane-panel-head">
                  <div className="control-plane-panel-title">
                    <h2>Decision outcomes</h2>
                    <span>{summary.total_evaluations} total</span>
                  </div>
                </div>

                <div className="control-plane-outcome-bar" aria-label="Decision mix">
                  {decisionItems.map((item) => (
                    <button
                      type="button"
                      key={item.key}
                      className={`control-plane-outcome-segment ${item.tone}${selectedDecision === item.key ? " active" : ""}`}
                      style={{ width: `${Math.max(item.percent, item.count > 0 ? 3 : 0)}%` }}
                      onClick={() => setSelectedDecision(item.key)}
                      title={`${item.label}: ${item.count}`}
                    />
                  ))}
                </div>

                <div className="control-plane-outcome-legend">
                  {decisionItems.map((item) => (
                    <button type="button" key={item.key} className="control-plane-legend-item" onClick={() => setSelectedDecision(item.key)}>
                      <span className={`control-plane-legend-dot ${item.tone}`} />
                      <strong>{item.label}</strong>
                      <span>
                        {item.count} ({item.percent.toFixed(1)}%)
                      </span>
                    </button>
                  ))}
                </div>

                <div className="control-plane-department-block">
                  <h3>Department activity</h3>
                  <div className="control-plane-department-list">
                    {departmentRows.length ? (
                      departmentRows.map((row) => (
                        <button
                          type="button"
                          key={row.department}
                          className={`control-plane-department-row${selectedDepartment === row.department ? " active" : ""}`}
                          onClick={() => setSelectedDepartment(row.department)}
                        >
                          <span className="control-plane-department-name">{row.department}</span>
                          <span className="control-plane-department-bar">
                            <span style={{ width: `${(row.total / maxDepartmentTotal) * 100}%` }} />
                          </span>
                          <strong>{row.total}</strong>
                          <span className={`control-plane-department-alert${row.alerts > 0 ? " visible" : ""}`}>{row.alerts || 0}</span>
                        </button>
                      ))
                    ) : (
                      <div className="control-plane-inline-empty">No department activity</div>
                    )}
                  </div>
                </div>

                <button type="button" className="control-plane-inline-action">
                  <span>View decisions</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </section>

              <section className="control-plane-posture">
                <div className="control-plane-panel-head">
                  <div className="control-plane-panel-title">
                    <h2>System posture</h2>
                  </div>
                </div>

                <div className="control-plane-posture-list">
                  {postureItems.map((item) => (
                    <button
                      type="button"
                      key={item.key}
                      className={`control-plane-posture-row${selectedComponent === item.key ? " active" : ""}`}
                      onClick={() => setSelectedComponent(item.key)}
                    >
                      <span className="control-plane-posture-label">
                        {iconForPosture(item.key)}
                        {item.label}
                      </span>
                      <span className="control-plane-posture-value">{item.value}</span>
                      <span className={`control-plane-posture-dot ${item.tone}`} />
                    </button>
                  ))}
                </div>

                <div className="control-plane-attention">
                  <h3>Attention</h3>
                  <div className="control-plane-attention-list">
                    {attentionItems.map((item) => (
                      <button type="button" key={item.key} className="control-plane-attention-row">
                        <span className={`control-plane-attention-icon ${item.tone}`}>
                          {item.tone === "ok" ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
                        </span>
                        <span className="control-plane-attention-label">{item.label}</span>
                        <span className={`control-plane-posture-dot ${item.tone === "degraded" ? "degraded" : item.tone === "warn" ? "warn" : "ok"}`} />
                        <ChevronRight size={16} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>

                <button type="button" className="control-plane-inline-action">
                  <span>Open system health</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </section>
            </section>

            <footer className="control-plane-trustbar">
              <span><EyeOff size={16} aria-hidden="true" />No raw prompts</span>
              <span><Filter size={16} aria-hidden="true" />Local classification</span>
              <span><UserRoundCheck size={16} aria-hidden="true" />Human authority</span>
              <span><ShieldCheck size={16} aria-hidden="true" />Hash-linked audit</span>
            </footer>
          </>
        )}
      </div>
    </Shell>
  );
}

function iconForPosture(key: string) {
  if (key === "identity") return <UserRoundCheck size={18} aria-hidden="true" />;
  if (key === "browser") return <Shield size={18} aria-hidden="true" />;
  if (key === "policy") return <BookOpenCheck size={18} aria-hidden="true" />;
  if (key === "classifier") return <BrainCircuit size={18} aria-hidden="true" />;
  if (key === "gateway") return <LockKeyhole size={18} aria-hidden="true" />;
  return <ShieldCheck size={18} aria-hidden="true" />;
}
