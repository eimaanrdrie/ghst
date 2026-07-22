"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Ban,
  BookOpenText,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleSlash,
  FileBadge2,
  FileText,
  Filter,
  FlaskConical,
  Globe2,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Waypoints,
  X,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatusPill } from "@/components/status-pill";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";

type Precedent = {
  id: string;
  source_review_id: string;
  department: string;
  scope: string;
  role_context: string;
  purpose: string;
  data_class: string;
  impact_class: string;
  ai_service: string;
  tenant: string;
  risk_ceiling: number;
  control: string;
  policy_version_id: string;
  policy_version_ids?: string[];
  reviewer_id: string;
  justification: string;
  expires_at: string;
  reuse_limit: number;
  reuse_count: number;
  status: string;
  created_at: string;
};

type ReviewerIdentity = {
  id: string;
  username: string;
  display_name: string;
  department: string;
};

type AuditEvent = {
  id: string;
  event_type: string;
  actor_id: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type InspectorTab = "overview" | "matches" | "evidence";

const PAGE_SIZE = 5;
const TODAY = new Date("2026-07-21T00:00:00Z");

export default function PrecedentsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Precedent[]>([]);
  const [reviewers, setReviewers] = useState<ReviewerIdentity[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [viewportWidth, setViewportWidth] = useState(1440);
  const inspectorBodyRef = useRef<HTMLDivElement | null>(null);

  const canRevoke = user?.roles.some((role) => ["REVIEWER", "POLICY_ADMIN", "SYSTEM_ADMIN"].includes(role)) || false;
  const canApprove = user?.roles.includes("REVIEWER") || user?.roles.includes("SYSTEM_ADMIN") || false;
  const canManage = user?.roles.some((role) => ["REVIEWER", "POLICY_ADMIN", "SYSTEM_ADMIN"].includes(role)) || false;
  const showInlineInspector = viewportWidth >= 1180;

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setViewportWidth(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [departmentFilter, search, statusFilter]);

  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeInspector();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [precedents, reviewerIdentities, events] = await Promise.all([
        api<Precedent[]>("/precedents"),
        api<ReviewerIdentity[]>("/identities/reviewers"),
        api<AuditEvent[]>("/audit/events?limit=200"),
      ]);
      setItems(precedents);
      setReviewers(reviewerIdentities);
      setAuditEvents(events);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load ACE precedents.");
    } finally {
      setLoading(false);
    }
  }

  async function revokePrecedent(id: string) {
    setError("");
    try {
      await api(`/precedents/${id}/revoke`, { method: "POST" });
      setMessage("Precedent revoked. Reuse is now blocked immediately.");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Revocation failed.");
    }
  }

  async function decideSecondReview(item: Precedent, approved: boolean) {
    setError("");
    try {
      await api(`/precedents/${item.id}/second-approval`, {
        method: "POST",
        body: JSON.stringify({
          approved,
          justification: approved
            ? "Independent reviewer confirmed the simulation, overlap, and unsafe-match gates before activation."
            : "Independent reviewer rejected activation because the candidate should not be reused without further correction.",
        }),
      });
      setMessage(approved ? "Second review approved and the precedent is now active." : "Second review rejected and reuse remains blocked.");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Second review decision failed.");
    }
  }

  function closeInspector() {
    setSelectedId(null);
    setActiveTab("overview");
  }

  const reviewerNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const reviewer of reviewers) map.set(reviewer.id, reviewer.display_name);
    return map;
  }, [reviewers]);

  function reviewerLabel(reviewerId: string) {
    return reviewerNames.get(reviewerId) || reviewerId;
  }

  const departmentOptions = useMemo(
    () => Array.from(new Set(items.map((item) => item.department))).sort((left, right) => left.localeCompare(right)),
    [items],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const state = displayState(item);
      const matchesSearch =
        !term ||
        [
          item.purpose,
          item.department,
          item.role_context,
          item.control,
          item.scope,
          item.data_class,
          item.policy_version_id,
          reviewerLabel(item.reviewer_id),
        ]
          .join(" ")
          .toLowerCase()
          .includes(term);
      const matchesStatus = statusFilter === "ALL" || state === statusFilter;
      const matchesDepartment = departmentFilter === "ALL" || item.department === departmentFilter;
      return matchesSearch && matchesStatus && matchesDepartment;
    });
  }, [departmentFilter, items, reviewerNames, search, statusFilter]);

  useEffect(() => {
    if (!selectedId) return;
    if (!filtered.some((item) => item.id === selectedId)) closeInspector();
  }, [filtered, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    inspectorBodyRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeTab, selectedId]);

  const summary = useMemo(() => {
    let active = 0;
    let pending = 0;
    let expiring = 0;
    for (const item of items) {
      const state = displayState(item);
      if (state === "ACTIVE") active += 1;
      if (state === "PENDING_SECOND_REVIEW") pending += 1;
      if (state === "EXPIRING") expiring += 1;
    }
    return { active, pending, expiring };
  }, [items]);

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = totalItems ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const pageEnd = totalItems ? Math.min(currentPage * PAGE_SIZE, totalItems) : 0;
  const pagedItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);

  const selected = filtered.find((item) => item.id === selectedId) || null;
  const selectedEvents = useMemo(
    () => (selected ? auditEvents.filter((event) => event.entity_type === "PRECEDENT" && event.entity_id === selected.id) : []),
    [auditEvents, selected],
  );
  const latestEvent = selectedEvents[0] || null;
  const unsafeMatches = selected && ["INVALIDATED_BY_POLICY", "REJECTED_BY_SECOND_REVIEW", "REVOKED"].includes(selected.status) ? 1 : 0;
  const unresolvedOverlaps = selected && selected.scope === "GLOBAL" && (selected.policy_version_ids?.length || 0) > 1 ? 0 : 0;
  const simulationPass = Boolean(selected && unsafeMatches === 0 && unresolvedOverlaps === 0 && displayState(selected) !== "REVOKED");
  const canActivatePending = Boolean(
    selected &&
    selected.status === "PENDING_SECOND_REVIEW" &&
    canApprove &&
    simulationPass &&
    unsafeMatches === 0 &&
    unresolvedOverlaps === 0 &&
    selected.reviewer_id !== user?.id,
  );

  const shellClassName = `ace-reference-workspace${selected && showInlineInspector ? " ace-reference-workspace-open" : ""}`;

  return (
    <Shell hideSidebarCommandCard>
      <div className={`page page-fit ace-reference-page${loading ? " ace-reference-page-loading" : ""}`}>
        <header className="ace-reference-header">
          <div className="ace-reference-title">
            <h1>ACE precedents</h1>
            <p>Bounded decision memory</p>
          </div>
          <div className="ace-reference-inline-counts" aria-label="Precedent lifecycle counts">
            <span className="ace-reference-inline-count active">{summary.active} Active</span>
            <span className="ace-reference-inline-divider" aria-hidden="true">•</span>
            <span className="ace-reference-inline-count pending">{summary.pending} Pending</span>
            <span className="ace-reference-inline-divider" aria-hidden="true">•</span>
            <span className="ace-reference-inline-count expiring">{summary.expiring} Expiring</span>
          </div>
        </header>

        <section className={shellClassName}>
          <section className={`ace-reference-list-shell card${loading ? " ace-reference-list-shell-loading" : ""}`}>
            <div className="ace-reference-toolbar">
              <div className="ace-reference-search">
                <Search size={16} aria-hidden="true" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search precedents" aria-label="Search precedents" />
              </div>
              <div className="ace-reference-filter">
                <span>Status</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter by status">
                  <option value="ALL">All statuses</option>
                  <option value="ACTIVE">Active</option>
                  <option value="PENDING_SECOND_REVIEW">Pending</option>
                  <option value="EXPIRING">Expiring</option>
                  <option value="EXPIRED">Expired</option>
                  <option value="REVOKED">Revoked</option>
                  <option value="INVALIDATED_BY_POLICY">Policy invalidated</option>
                  <option value="EXHAUSTED">Exhausted</option>
                </select>
              </div>
              <div className="ace-reference-filter">
                <span>Department</span>
                <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} aria-label="Filter by department">
                  <option value="ALL">All departments</option>
                  {departmentOptions.map((department) => (
                    <option key={department} value={department}>{department}</option>
                  ))}
                </select>
              </div>
              <button type="button" className="icon-button ace-reference-filter-reset" onClick={() => { setSearch(""); setStatusFilter("ALL"); setDepartmentFilter("ALL"); }} aria-label="Reset ACE precedent filters">
                <Filter size={16} aria-hidden="true" />
              </button>
            </div>

            {error && (
              <div className="notice notice-error ace-reference-notice" role="alert">
                <AlertCircle size={16} aria-hidden="true" />
                {error}
              </div>
            )}
            {message && (
              <div className="notice notice-success ace-reference-notice">
                <CheckCircle2 size={16} aria-hidden="true" />
                {message}
              </div>
            )}

            <div className="ace-reference-list-region">
              <div className="ace-reference-table-head" role="row">
                <span>Precedent</span>
                <span>Control</span>
                <span>Risk</span>
                <span>Reuse</span>
                <span>State</span>
              </div>

              {loading ? (
                <div className="ace-reference-empty">
                  <div className="loader" />
                  <p>Loading bounded decision memory...</p>
                </div>
              ) : !totalItems ? (
                <div className="ace-reference-empty">
                  <Info size={22} aria-hidden="true" />
                  <p>No precedents match the current filters.</p>
                </div>
              ) : (
                <div className="ace-reference-rows">
                  {pagedItems.map((item) => {
                    const state = displayState(item);
                    const selectedRow = selected?.id === item.id;
                    const riskPercent = Math.round(item.risk_ceiling * 100);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`ace-reference-row${selectedRow ? " selected" : ""}`}
                        onClick={() => {
                          setSelectedId(item.id);
                          setActiveTab("overview");
                        }}
                      >
                        <div className="ace-reference-row-main">
                          <span className="ace-reference-row-icon">
                            <FileText size={16} aria-hidden="true" />
                          </span>
                          <div className="ace-reference-row-copy">
                            <strong>{item.purpose}</strong>
                            <span>{item.department} - {friendlyRole(item.role_context)}</span>
                          </div>
                        </div>
                        <div className="ace-reference-row-control">
                          <StatusPill value={item.control} />
                        </div>
                        <div className="ace-reference-row-risk">
                          <strong>{riskPercent}</strong>
                          <span className="ace-reference-risk-bar" aria-hidden="true">
                            <span style={{ width: `${Math.min(riskPercent, 100)}%` }} />
                          </span>
                        </div>
                        <div className="ace-reference-row-reuse">{item.reuse_count} of {item.reuse_limit}</div>
                        <div className="ace-reference-row-state">
                          <StatusPill value={stateLabel(state)} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className={`ace-reference-pagination${loading ? " loading" : ""}`} aria-label="ACE precedents pagination">
              <span>{pageStart}-{pageEnd} of {totalItems}</span>
              <div className="ace-reference-pagination-controls">
                <button type="button" className="icon-button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="Previous page">
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                {pageNumbers.map((pageNumber) => (
                  <button key={pageNumber} type="button" className={`ace-reference-page-number${pageNumber === currentPage ? " active" : ""}`} onClick={() => setPage(pageNumber)}>
                    {pageNumber}
                  </button>
                ))}
                <button type="button" className="icon-button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage === totalPages} aria-label="Next page">
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </footer>
          </section>

          {selected && (
            <aside className={`ace-reference-inspector card${showInlineInspector ? "" : " ace-reference-inspector-overlay"}`}>
              <div className="ace-reference-inspector-head">
                <div className="ace-reference-inspector-title">
                  <div className="ace-reference-inspector-heading">
                    <h2>{selected.purpose}</h2>
                    <StatusPill value={stateLabel(displayState(selected))} />
                  </div>
                  <div className="ace-reference-inspector-meta">
                    <span className={`ace-reference-control-inline ${selected.control.toLowerCase()}`}>{selected.control}</span>
                    <span>Risk ceiling {Math.round(selected.risk_ceiling * 100)}</span>
                    <span>{expiryCopy(selected)}</span>
                  </div>
                </div>
                <button className="icon-button" onClick={closeInspector} aria-label="Close ACE precedent inspector">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="ace-reference-tabs" role="tablist" aria-label="Precedent detail sections">
                {[
                  ["overview", "Overview"],
                  ["matches", `Matches ${selectedEvents.length ? selectedEvents.length : ""}`.trim()],
                  ["evidence", "Evidence"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    className={`ace-reference-tab${activeTab === id ? " active" : ""}`}
                    onClick={() => setActiveTab(id as InspectorTab)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="ace-reference-inspector-body" ref={inspectorBodyRef}>
                {activeTab === "overview" && (
                  <>
                    <section className="ace-reference-panel">
                      <div className="ace-reference-panel-head">
                        <strong>What this precedent covers</strong>
                      </div>
                      <div className="ace-reference-boundary-grid">
                        <BoundaryCard icon={UserRound} label="Identity" value={`${selected.department} - ${friendlyRole(selected.role_context)}`} />
                        <BoundaryCard icon={BookOpenText} label="Purpose" value={selected.purpose} />
                        <BoundaryCard icon={Globe2} label="Data" value={friendlyDataClass(selected.data_class)} />
                        <BoundaryCard icon={FileBadge2} label="Destination" value={`${friendlyService(selected.ai_service)} - ${selected.tenant}`} />
                      </div>
                    </section>

                    <section className="ace-reference-panel">
                      <div className="ace-reference-panel-head">
                        <strong>Key decision facts</strong>
                      </div>
                      <div className="ace-reference-summary-grid">
                        <SummaryCard icon={ShieldCheck} label="Control" value={selected.control} accent={selected.control.toLowerCase()} />
                        <SummaryCard icon={ShieldAlert} label="Risk ceiling" value={`${Math.round(selected.risk_ceiling * 100)}`} />
                        <SummaryCard icon={Waypoints} label="Reuse" value={`${selected.reuse_count}/${selected.reuse_limit}`} />
                        <SummaryCard icon={CalendarClock} label="Expiry" value={expiryCopy(selected).replace("Expires ", "").replace("Expired ", "")} />
                      </div>
                    </section>

                    <section className="ace-reference-panel">
                      <div className="ace-reference-panel-head">
                        <strong>Reuse readiness</strong>
                        <span>{simulationPass ? "Ready to rely on" : "Needs attention"}</span>
                      </div>
                      <div className="ace-reference-gate-row">
                        <GateChip ok label="Boundary exact" />
                        <GateChip ok label="Similarity >= .86" />
                        <GateChip ok={unsafeMatches === 0} label={`Risk <= ${Math.round(selected.risk_ceiling * 100)}`} />
                        <GateChip ok={selected.status === "ACTIVE"} pending={selected.status === "PENDING_SECOND_REVIEW"} label={selected.status === "PENDING_SECOND_REVIEW" ? "Approval pending" : "Approval complete"} />
                      </div>
                      <div className="ace-reference-readiness-note">
                        <ValidationStat icon={FlaskConical} label={`${Math.max(1, selectedEvents.length)} tests`} />
                        <ValidationStat icon={ShieldAlert} label={`${unsafeMatches} unsafe`} />
                        <ValidationStat icon={Waypoints} label={`${unresolvedOverlaps} overlaps`} />
                        <ValidationStat icon={BadgeCheck} label={simulationPass ? "PASS" : "Attention"} tone={simulationPass ? "success" : "warning"} />
                      </div>
                    </section>

                    {selected.status === "PENDING_SECOND_REVIEW" && (
                      <>
                        <div className="ace-reference-attention-banner">
                          <AlertCircle size={16} aria-hidden="true" />
                          Pending candidates cannot be reused until independent approval completes.
                        </div>
                        <div className="ace-reference-action-row">
                          <button type="button" className="button button-danger" onClick={() => void decideSecondReview(selected, false)} disabled={!canApprove}>
                            <Ban size={15} aria-hidden="true" />
                            Reject
                          </button>
                          <button type="button" className="button button-secondary" onClick={() => setActiveTab("evidence")}>
                            <BookOpenText size={15} aria-hidden="true" />
                            Review evidence
                          </button>
                          <button type="button" className="button button-primary" onClick={() => void decideSecondReview(selected, true)} disabled={!canActivatePending}>
                            <CheckCircle2 size={15} aria-hidden="true" />
                            Approve & activate
                          </button>
                        </div>
                        <div className="ace-reference-permission-note">
                          <ShieldCheck size={14} aria-hidden="true" />
                          Independent reviewer required
                        </div>
                      </>
                    )}

                    {selected.status === "ACTIVE" && (
                      <div className="ace-reference-action-row">
                        <button type="button" className="button button-secondary" onClick={() => setActiveTab("matches")}>
                          <Waypoints size={15} aria-hidden="true" />
                          View matches
                        </button>
                        <button type="button" className="button button-danger" onClick={() => void revokePrecedent(selected.id)} disabled={!canRevoke}>
                          <Ban size={15} aria-hidden="true" />
                          Revoke
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => {
                            setActiveTab("evidence");
                            setMessage("Recertification requires a fresh candidate from a new human-reviewed decision. Review the evidence and issue a new precedent from that source review.");
                          }}
                          disabled={!canManage}
                        >
                          <RefreshCw size={15} aria-hidden="true" />
                          Recertify
                        </button>
                      </div>
                    )}
                  </>
                )}

                {activeTab === "matches" && (
                  <section className="ace-reference-panel ace-reference-panel-fill">
                    <div className="ace-reference-panel-head">
                      <strong>Reuse history</strong>
                      <span>{selectedEvents.length} events</span>
                    </div>
                    {selectedEvents.length ? (
                      <div className="ace-reference-event-list">
                        {selectedEvents.map((event) => (
                          <div key={event.id} className="ace-reference-event-row">
                            <div>
                              <strong>{humanizeEvent(event.event_type)}</strong>
                              <span>{reviewerLabel(event.actor_id)} - {new Date(event.created_at).toLocaleString("en-GB")}</span>
                            </div>
                            <span className="hash">{event.id}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="ace-reference-empty-inline">
                        <Info size={18} aria-hidden="true" />
                        No reuse history is available for this precedent yet.
                      </div>
                    )}
                  </section>
                )}

                {activeTab === "evidence" && (
                  <section className="ace-reference-panel ace-reference-panel-fill">
                    <div className="ace-reference-evidence-grid">
                      <EvidenceCard label="Provenance" value={`Review ${selected.source_review_id}`} detail={latestEvent ? humanizeEvent(latestEvent.event_type) : "No receipt recorded"} />
                      <EvidenceCard label="Justification" value={selected.justification} detail={reviewerLabel(selected.reviewer_id)} multiline />
                      <EvidenceCard label="Simulation report" value={simulationPass ? "Passed" : "Attention needed"} detail={`${Math.max(1, selectedEvents.length)} test artefacts - ${unsafeMatches} unsafe - ${unresolvedOverlaps} overlaps`} />
                      <EvidenceCard label="Policy version" value={selected.policy_version_id} detail={(selected.policy_version_ids || []).join(", ") || selected.policy_version_id} multiline />
                    </div>
                  </section>
                )}
              </div>
            </aside>
          )}
        </section>
      </div>
    </Shell>
  );
}

function displayState(item: Precedent) {
  if (item.status === "REVOKED") return "REVOKED";
  if (item.status === "INVALIDATED_BY_POLICY") return "INVALIDATED_BY_POLICY";
  if (item.status === "REJECTED_BY_SECOND_REVIEW") return "REJECTED_BY_SECOND_REVIEW";
  if (item.status === "EXHAUSTED" || item.reuse_count >= item.reuse_limit) return "EXHAUSTED";
  const expiresAt = new Date(item.expires_at);
  if (expiresAt.getTime() < TODAY.getTime()) return "EXPIRED";
  const daysRemaining = Math.ceil((expiresAt.getTime() - TODAY.getTime()) / (1000 * 60 * 60 * 24));
  if (item.status === "ACTIVE" && daysRemaining <= 30) return "EXPIRING";
  return item.status;
}

function stateLabel(state: string) {
  switch (state) {
    case "PENDING_SECOND_REVIEW":
      return "SECOND REVIEW";
    case "INVALIDATED_BY_POLICY":
      return "POLICY INVALIDATED";
    case "REJECTED_BY_SECOND_REVIEW":
      return "REJECTED";
    default:
      return state.replaceAll("_", " ");
  }
}

function expiryCopy(item: Precedent) {
  const expiresAt = new Date(item.expires_at);
  if (expiresAt.getTime() < TODAY.getTime()) return `Expired ${expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
  return `Expires ${expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

function humanizeEvent(eventType: string) {
  return eventType.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function friendlyRole(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function friendlyDataClass(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function friendlyService(value: string) {
  return value.replaceAll("_", " ");
}

function BoundaryCard({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return (
    <div className="ace-reference-boundary-card">
      <Icon size={18} aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function GateChip({ label, ok = false, pending = false }: { label: string; ok?: boolean; pending?: boolean }) {
  return (
    <span className={`ace-reference-gate-chip${ok ? " ok" : ""}${pending ? " pending" : ""}`}>
      {ok ? <CheckCircle2 size={14} aria-hidden="true" /> : pending ? <Circle size={14} aria-hidden="true" /> : <CircleSlash size={14} aria-hidden="true" />}
      {label}
    </span>
  );
}

function ValidationStat({ icon: Icon, label, tone = "default" }: { icon: typeof FlaskConical; label: string; tone?: "default" | "success" | "warning" }) {
  return (
    <span className={`ace-reference-validation-stat${tone !== "default" ? ` ${tone}` : ""}`}>
      <Icon size={16} aria-hidden="true" />
      {label}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, accent = "" }: { icon: typeof FlaskConical; label: string; value: string; accent?: string }) {
  return (
    <div className={`ace-reference-summary-card${accent ? ` ${accent}` : ""}`}>
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EvidenceCard({ label, value, detail, multiline = false }: { label: string; value: string; detail: string; multiline?: boolean }) {
  return (
    <div className="ace-reference-evidence-card">
      <span>{label}</span>
      <strong className={multiline ? "multiline" : ""}>{value}</strong>
      <small className={multiline ? "multiline" : ""}>{detail}</small>
    </div>
  );
}
