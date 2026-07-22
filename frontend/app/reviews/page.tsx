"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BellRing,
  BookOpenText,
  Bot,
  CircleAlert,
  Clock3,
  ExternalLink,
  Loader2,
  Lock,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { api } from "@/lib/api";
import { useAuth } from "@/components/auth-provider";

type ReviewItem = {
  id: string;
  evaluation_id: string;
  department: string;
  status: string;
  severity: string;
  requested_by_name?: string | null;
  purpose: string;
  destination_origin: string;
  risk_score: number;
  created_at: string;
  expires_at: string;
};

type ReviewDetail = ReviewItem & {
  prompt: string;
  findings: Array<Record<string, unknown>>;
  policy_matches: Array<{
    clause_id: string;
    policy: string;
    policy_version: string;
    policy_version_id?: string;
    clause: string;
    text: string;
    page_number?: number;
    action?: string;
  }>;
  model_evidence: Record<string, unknown>;
};

type PendingPrecedent = {
  id: string;
  department: string;
  purpose: string;
  data_class: string;
  risk_ceiling: number;
  reviewer_id: string;
  status: string;
  expires_at: string;
};

type ReviewAction = "BLOCK" | "REDACT" | "ALLOW";
type DrawerKind = "evidence" | "rationale" | null;
type QueueMode = "mine" | "team";

const REVIEWER_THRESHOLD = 0.6;
export default function ReviewsPage() {
  return (
    <Suspense fallback={<ReviewsLoadingState />}>
      <ReviewsScreen />
    </Suspense>
  );
}

function ReviewsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const queueRegionRef = useRef<HTMLDivElement | null>(null);
  const suppressUrlReviewIdRef = useRef<string | null>(null);
  const reviewRequestIdRef = useRef(0);

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [pendingPrecedents, setPendingPrecedents] = useState<PendingPrecedent[]>([]);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [severity, setSeverity] = useState("");
  const [age, setAge] = useState("all");
  const [search, setSearch] = useState("");
  const [queueMode, setQueueMode] = useState<QueueMode>("mine");
  const [selectedAction, setSelectedAction] = useState<ReviewAction>("BLOCK");
  const [justification, setJustification] = useState("Sensitive context confirmed; this request must not be released externally.");
  const [riskCeiling, setRiskCeiling] = useState(0.45);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const canDecide = Boolean(user?.roles.includes("REVIEWER") || user?.roles.includes("SYSTEM_ADMIN"));
  const selectedId = activeReviewId;

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [reviews, precedents] = await Promise.all([
        api<ReviewItem[]>(`/reviews?status_filter=PENDING${severity ? `&severity=${severity}` : ""}`),
        api<PendingPrecedent[]>("/precedents?status_filter=PENDING_SECOND_REVIEW"),
      ]);
      setItems(reviews);
      setPendingPrecedents(precedents);
    } catch (failure) {
      setItems([]);
      setPendingPrecedents([]);
      setError(failure instanceof Error ? failure.message : "Could not load the review queue.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [severity]);

  const queueItems = useMemo(() => {
    const now = Date.now();
    return items.filter((item) => {
      const matchesSearch =
        !search.trim() ||
        `${item.purpose} ${item.department} ${item.requested_by_name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase());
      const matchesAge = age === "all" || now - new Date(item.created_at).getTime() >= Number(age) * 60_000;
      const matchesMine =
        queueMode === "team" ||
        item.department === user?.department ||
        user?.roles.includes("POLICY_ADMIN") ||
        user?.roles.includes("SYSTEM_ADMIN");
      return matchesSearch && matchesAge && matchesMine;
    });
  }, [age, items, queueMode, search, user?.department, user?.roles]);

  const selectedIndex = useMemo(
    () => (selectedId ? queueItems.findIndex((item) => item.id === selectedId) : -1),
    [queueItems, selectedId],
  );

  const oldestMinutes = useMemo(() => {
    if (!queueItems.length) return 0;
    return Math.max(...queueItems.map((item) => Math.max(1, Math.round((Date.now() - new Date(item.created_at).getTime()) / 60000))));
  }, [queueItems]);

  function updateSelectionInUrl(reviewId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (reviewId) {
      params.set("review", reviewId);
    } else {
      params.delete("review");
    }
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }

  async function openReview(item: ReviewItem, focusPanel = true) {
    const requestId = reviewRequestIdRef.current + 1;
    reviewRequestIdRef.current = requestId;
    setActiveReviewId(item.id);
    setLoadingDetailId(item.id);
    setDetail((current) => (current?.id === item.id ? current : null));
    setError("");
    setMessage("");
    suppressUrlReviewIdRef.current = null;
    updateSelectionInUrl(item.id);
    try {
      const response = await api<ReviewDetail>(`/reviews/${item.id}`);
      if (reviewRequestIdRef.current !== requestId) return;
      setDetail(response);
      setRiskCeiling(Math.min(0.95, response.risk_score + 0.05));
      setSelectedAction(response.risk_score >= 0.7 ? "BLOCK" : "REDACT");
      setJustification(
        response.risk_score >= 0.7
          ? "Sensitive context confirmed; this request must not be released externally."
          : "The request can proceed only after a safer version removes or redacts the risky context.",
      );
      if (focusPanel) {
        requestAnimationFrame(() => panelHeadingRef.current?.focus());
      }
    } catch (failure) {
      if (reviewRequestIdRef.current !== requestId) return;
      setError(failure instanceof Error ? failure.message : "Review evidence is unavailable.");
    } finally {
      if (reviewRequestIdRef.current === requestId) {
        setLoadingDetailId(null);
      }
    }
  }

  function closeReview() {
    reviewRequestIdRef.current += 1;
    suppressUrlReviewIdRef.current = searchParams.get("review");
    setDrawer(null);
    setActiveReviewId(null);
    setDetail(null);
    updateSelectionInUrl(null);
    requestAnimationFrame(() => queueRegionRef.current?.focus());
  }

  async function moveSelection(step: -1 | 1) {
    if (!queueItems.length) return;
    const nextIndex = selectedIndex === -1 ? 0 : Math.min(queueItems.length - 1, Math.max(0, selectedIndex + step));
    const target = queueItems[nextIndex];
    if (target && target.id !== selectedId) {
      await openReview(target, true);
    }
  }

  useEffect(() => {
    const reviewId = searchParams.get("review");
    if (!reviewId) {
      suppressUrlReviewIdRef.current = null;
    }
    if (!reviewId) {
      if (activeReviewId !== null && !loadingDetailId) {
        setActiveReviewId(null);
        setDetail(null);
      }
      return;
    }
    if (suppressUrlReviewIdRef.current === reviewId) return;
    if (activeReviewId) return;
    if (loadingDetailId === reviewId) return;
    const item = queueItems.find((entry) => entry.id === reviewId) ?? items.find((entry) => entry.id === reviewId);
    if (item) {
      void openReview(item, false);
    }
  }, [activeReviewId, items, loadingDetailId, queueItems, searchParams]);

  useEffect(() => {
    if (!loadingDetailId && !activeReviewId && !searchParams.get("review") && queueItems.length > 0) {
      void openReview(queueItems[0], false);
    }
  }, [activeReviewId, loadingDetailId, queueItems, searchParams]);

  useEffect(() => {
    if (selectedId && !queueItems.some((item) => item.id === selectedId)) {
      closeReview();
    }
  }, [queueItems, selectedId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inInput = !!target?.closest("input, textarea, select, [contenteditable='true']");
      if (event.key === "Escape") {
        if (drawer) {
          setDrawer(null);
          return;
        }
        if (selectedId) {
          event.preventDefault();
          closeReview();
        }
      }
      if (!selectedId || inInput) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        void moveSelection(1);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        void moveSelection(-1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawer, selectedId, selectedIndex, queueItems]);

  async function submitDecision() {
    if (!detail || !canDecide) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const decision = selectedAction;
      const response = await api<{ message: string; precedent_id?: string; precedent_status?: string }>(`/reviews/${detail.id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          justification,
          create_precedent: decision === "ALLOW",
          precedent_scope:
            decision === "ALLOW"
              ? {
                  role_context: "EMPLOYEE",
                  purpose: detail.purpose,
                  data_class: precedentDataClass(detail),
                  risk_ceiling: riskCeiling,
                  control: "ALLOW",
                  reuse_limit: 25,
                  validity_days: 90,
                }
              : null,
        }),
      });
      setMessage(`${response.message}${response.precedent_id ? ` ACE precedent ${response.precedent_id} is ${response.precedent_status}.` : ""}`);
      setDrawer(null);
      setDetail(null);
      updateSelectionInUrl(null);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Decision was rejected safely.");
    } finally {
      setBusy(false);
    }
  }

  async function secondApprove(precedent: PendingPrecedent, approved: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/precedents/${precedent.id}/second-approval`, {
        method: "POST",
        body: JSON.stringify({
          approved,
          justification: approved
            ? "Independent reviewer verified the high-impact precedent boundary and supporting policy."
            : "Independent reviewer rejected the proposed high-impact precedent boundary.",
        }),
      });
      setMessage(`Independent second review ${approved ? "approved" : "rejected"} precedent ${precedent.id}.`);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Second review failed safely.");
    } finally {
      setBusy(false);
    }
  }

  const secondReviewQueue = pendingPrecedents.filter((item) => item.reviewer_id !== user?.id);

  const permissionState = !canDecide
    ? "This role can inspect evidence but cannot submit a human decision."
    : null;

  return (
    <Shell hideSidebarCommandCard compactSystemBar>
      <div className="page app-page-fit review-reference-page">
        <header className="review-reference-header">
          <div className="review-reference-title">
            <div>
              <div className="review-reference-title-row">
                <h1>Human review</h1>
                <span className="review-reference-pending">{loading ? "Loading..." : `${queueItems.length} pending`}</span>
              </div>
              <p>Department-scoped decisions</p>
            </div>
          </div>

          <div className="review-reference-header-actions">
            <button
              className={`review-reference-queue-toggle${queueMode === "mine" ? " active" : ""}`}
              onClick={() => setQueueMode("mine")}
              aria-pressed={queueMode === "mine"}
            >
              <UserRound size={18} aria-hidden="true" />
              My queue
            </button>
            <button className="review-reference-icon-button" onClick={() => void load()} aria-label="Refresh queue">
              <RefreshCw size={18} aria-hidden="true" />
            </button>
            <div className="review-reference-age-chip">
              <Clock3 size={17} aria-hidden="true" />
              Oldest {loading ? "--" : oldestMinutes}m
            </div>
          </div>
        </header>

        {(error || message) && (
          <div className="review-reference-status-row">
            {error && (
              <div className="review-reference-notice review-reference-notice-error" role="alert">
                <AlertCircle size={16} aria-hidden="true" />
                {error}
              </div>
            )}
            {message && (
              <div className="review-reference-notice review-reference-notice-success" role="status">
                <ShieldCheck size={16} aria-hidden="true" />
                {message}
              </div>
            )}
          </div>
        )}

        <section className="review-reference-inline-shell" ref={queueRegionRef} tabIndex={-1}>
          {loading ? (
            <ReviewsWorkspaceSkeleton label="Loading human review" />
          ) : loadingDetailId ? (
            <ReviewsWorkspaceSkeleton label="Loading review evidence" />
          ) : !queueItems.length ? (
            <div className="review-reference-empty">
              <ShieldCheck size={22} aria-hidden="true" />
              <h3>No pending reviews</h3>
              <p>No authorised pending reviews are waiting for human approval.</p>
            </div>
          ) : !detail ? null : (
            <>
              <aside className="review-reference-inline-list">
                <div className="review-reference-inline-list-header">
                  <strong>Review list</strong>
                  <span>{queueItems.length} cases</span>
                </div>
                <div className="review-reference-inline-list-items" role="list">
                  {queueItems.map((item) => {
                    const minutesLeft = Math.max(1, Math.round((new Date(item.expires_at).getTime() - Date.now()) / 60000));
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`review-reference-inline-item${selectedId === item.id ? " selected" : ""}`}
                        onClick={() => void openReview(item)}
                        aria-pressed={selectedId === item.id}
                      >
                        <div className="review-reference-inline-item-copy">
                          <strong>{item.purpose}</strong>
                          <span>{item.department} · {item.requested_by_name ?? "Unknown requestor"}</span>
                        </div>
                        <div className="review-reference-inline-item-meta">
                          <span className={`review-reference-severity ${item.severity.toLowerCase()}`}>{item.severity}</span>
                          <small>{minutesLeft}m</small>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="review-reference-direct-nav">
                  <button
                    className="review-reference-direct-nav-button"
                    onClick={() => void moveSelection(-1)}
                    disabled={selectedIndex <= 0}
                  >
                    <ArrowLeft size={14} aria-hidden="true" />
                    Previous
                  </button>
                  <div className="review-reference-direct-nav-status">
                    <span>{selectedIndex + 1} of {queueItems.length}</span>
                  </div>
                  <button
                    className="review-reference-direct-nav-button"
                    onClick={() => void moveSelection(1)}
                    disabled={selectedIndex === -1 || selectedIndex >= queueItems.length - 1}
                  >
                    Next
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </aside>

              <div className="review-reference-inline-detail">
                <div className="review-reference-direct-nav review-reference-direct-nav-top">
                  <div className="review-reference-direct-nav-status">
                    <span>{selectedIndex + 1} of {queueItems.length}</span>
                    <strong>{detail.department}</strong>
                  </div>
                  <div className="review-reference-direct-nav-actions">
                    <button
                      className="review-reference-direct-nav-button"
                      onClick={() => void moveSelection(-1)}
                      disabled={selectedIndex <= 0}
                    >
                      <ArrowLeft size={14} aria-hidden="true" />
                      Previous review
                    </button>
                    <button
                      className="review-reference-direct-nav-button"
                      onClick={() => void moveSelection(1)}
                      disabled={selectedIndex === -1 || selectedIndex >= queueItems.length - 1}
                    >
                      Next review
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="review-reference-panel-scroll">
                  <div className="review-reference-panel-header">
                    <div className="review-reference-panel-heading">
                      <div className="review-reference-panel-heading-icon">
                        <Scale size={24} aria-hidden="true" />
                      </div>
                      <div>
                        <h2 ref={panelHeadingRef} tabIndex={-1}>{detail.purpose}</h2>
                        <p className="review-reference-panel-meta">{detail.department} · {detail.requested_by_name ?? "Unknown requestor"} · Legal research</p>
                      </div>
                    </div>

                    <div className="review-reference-panel-actions">
                      <span className={`review-reference-severity outlined ${detail.severity.toLowerCase()}`}>{detail.severity}</span>
                      <span className="review-reference-mini-chip">
                        <Clock3 size={15} aria-hidden="true" />
                        Expires {Math.max(1, Math.round((new Date(detail.expires_at).getTime() - Date.now()) / 60000))}m
                      </span>
                      <button className="review-reference-text-button" onClick={() => setDrawer("evidence")}>
                        Full evidence
                        <ExternalLink size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="review-reference-panel-grid">
                    <section className="review-reference-card review-reference-request-card">
                      <h3>Request</h3>
                      <p>{detail.prompt}</p>
                      <div className="review-reference-chip-row">
                        <span className="review-reference-chip">
                          <Bot size={15} aria-hidden="true" />
                          {originLabel(detail.destination_origin)}
                        </span>
                        <span className="review-reference-chip">
                          <Lock size={15} aria-hidden="true" />
                          Encrypted
                        </span>
                        <span className="review-reference-chip">
                          <Clock3 size={15} aria-hidden="true" />
                          Deletes in {Math.max(1, Math.round((new Date(detail.expires_at).getTime() - Date.now()) / 60000))}m
                        </span>
                      </div>
                    </section>

                    <section className="review-reference-card review-reference-risk-card">
                      <h3>Why GHST paused it</h3>
                      <div className="review-reference-risk-layout">
                        <div className="review-reference-risk-ring" style={{ ["--risk-value" as string]: `${Math.round(detail.risk_score * 100)}` }}>
                          <span>{Math.round(detail.risk_score * 100)}</span>
                        </div>
                        <div className="review-reference-risk-copy">
                          <div className="review-reference-finding-line">
                            <span>Finding</span>
                            <strong>{primaryFinding(detail)} · {Math.round(detail.risk_score * 100)}%</strong>
                          </div>
                          <div className="review-reference-risk-reasons">
                            <span><ShieldAlert size={16} aria-hidden="true" /> Sensitive context</span>
                            <span><ExternalLink size={16} aria-hidden="true" /> External destination</span>
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>

                  <section className="review-reference-citation-bar">
                    <div className="review-reference-citation-status">
                      <ShieldX size={18} aria-hidden="true" />
                      <span>{selectedAction === "ALLOW" ? "Potential false positive under review" : "External disclosure prohibited"}</span>
                    </div>
                    <div className="review-reference-citation-chips">
                      {detail.policy_matches.slice(0, 2).map((item) => (
                        <span key={item.clause_id} className="review-reference-citation-chip">
                          <BookOpenText size={15} aria-hidden="true" />
                          {item.policy_version} §{item.clause}
                        </span>
                      ))}
                    </div>
                    <button className="review-reference-text-button" onClick={() => setDrawer("rationale")}>
                      View rationale
                      <ExternalLink size={15} aria-hidden="true" />
                    </button>
                  </section>

                  <section className="review-reference-decision-zone">
                    <div className="review-reference-decision-main">
                      <h3>Decision</h3>
                      <div className="review-reference-action-row">
                        <button
                          className={`review-reference-action danger${selectedAction === "BLOCK" ? " active" : ""}`}
                          onClick={() => {
                            setSelectedAction("BLOCK");
                            setJustification("Sensitive context confirmed; this request must not be released externally.");
                          }}
                          aria-pressed={selectedAction === "BLOCK"}
                        >
                          <ShieldX size={18} aria-hidden="true" />
                          Block
                        </button>
                        <button
                          className={`review-reference-action warning${selectedAction === "REDACT" ? " active" : ""}`}
                          onClick={() => {
                            setSelectedAction("REDACT");
                            setJustification("The request can proceed only after a safer version removes or redacts the risky context.");
                          }}
                          aria-pressed={selectedAction === "REDACT"}
                        >
                          <TriangleAlert size={18} aria-hidden="true" />
                          Request safer version
                        </button>
                        <button
                          className={`review-reference-action subtle${selectedAction === "ALLOW" ? " active" : ""}`}
                          onClick={() => {
                            setSelectedAction("ALLOW");
                            setJustification("False positive confirmed; the request is bounded to the reviewed purpose and approved destination.");
                          }}
                          aria-pressed={selectedAction === "ALLOW"}
                        >
                          <ShieldCheck size={18} aria-hidden="true" />
                          False positive
                        </button>
                      </div>
                      <label className="review-reference-reason">
                        <span>Add reviewer reason</span>
                        <textarea value={justification} onChange={(event) => setJustification(event.target.value)} />
                      </label>
                    </div>

                    <aside className="review-reference-submit-rail">
                      <div className="review-reference-rail-note">
                        <Lock size={17} aria-hidden="true" />
                        <span>{detail.risk_score >= REVIEWER_THRESHOLD ? "Second reviewer required" : "Single reviewer decision allowed"}</span>
                      </div>
                      <button
                        className="review-reference-submit"
                        onClick={() => void submitDecision()}
                        disabled={busy || !canDecide || justification.trim().length < 10}
                      >
                        {busy ? <><Loader2 className="review-reference-spin" size={16} aria-hidden="true" />Submitting</> : "Submit"}
                      </button>
                      <div className="review-reference-rail-note">
                        <BellRing size={17} aria-hidden="true" />
                        <span>Employee will be notified</span>
                      </div>
                      {permissionState && (
                        <div className="review-reference-permission">
                          <CircleAlert size={16} aria-hidden="true" />
                          {permissionState}
                        </div>
                      )}
                    </aside>
                  </section>
                </div>
              </div>
            </>
          )}
        </section>

        {drawer && detail && (
          <div className="review-reference-drawer-backdrop" onClick={() => setDrawer(null)}>
            <div className="review-reference-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <div className="review-reference-drawer-header">
                <div>
                  <h3>{drawer === "evidence" ? "Full evidence" : "View rationale"}</h3>
                  <p>{drawer === "evidence" ? "Protected review payload and model evidence." : "Policy citations and enforcement rationale."}</p>
                </div>
                <button className="review-reference-icon-button" onClick={() => setDrawer(null)} aria-label="Close drawer">
                  <X size={17} aria-hidden="true" />
                </button>
              </div>

              {drawer === "evidence" ? (
                <div className="review-reference-drawer-grid">
                  <section className="review-reference-drawer-card">
                    <h4>Encrypted prompt</h4>
                    <pre>{detail.prompt}</pre>
                  </section>
                  <section className="review-reference-drawer-card">
                    <h4>Findings</h4>
                    <pre>{JSON.stringify(detail.findings, null, 2)}</pre>
                  </section>
                  <section className="review-reference-drawer-card full">
                    <h4>Model evidence</h4>
                    <pre>{JSON.stringify(detail.model_evidence, null, 2)}</pre>
                  </section>
                </div>
              ) : (
                <div className="review-reference-rationale-list">
                  {detail.policy_matches.map((item) => (
                    <article key={item.clause_id} className="review-reference-rationale-card">
                      <div className="review-reference-rationale-top">
                        <strong>{item.policy}</strong>
                        <span>{item.policy_version} §{item.clause}{item.page_number ? ` · p.${item.page_number}` : ""}</span>
                      </div>
                      <p>{item.text}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function ReviewsLoadingState() {
  return (
    <Shell hideSidebarCommandCard compactSystemBar>
      <div className="page app-page-fit review-reference-page">
        <ReviewsWorkspaceSkeleton label="Loading human review" />
      </div>
    </Shell>
  );
}

function ReviewsWorkspaceSkeleton({ label }: { label: string }) {
  return (
    <section className="review-reference-skeleton" aria-label={label}>
      <aside className="review-reference-skeleton-list">
        <div className="review-reference-skeleton-list-head">
          <span className="review-reference-skeleton-line short" />
          <span className="review-reference-skeleton-line tiny" />
        </div>
        <div className="review-reference-skeleton-list-items">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className={`review-reference-skeleton-item${index === 0 ? " active" : ""}`}>
              <div className="review-reference-skeleton-copy">
                <span className="review-reference-skeleton-line medium" />
                <span className="review-reference-skeleton-line short" />
              </div>
              <div className="review-reference-skeleton-meta">
                <span className="review-reference-skeleton-chip" />
                <span className="review-reference-skeleton-line tiny" />
              </div>
            </div>
          ))}
        </div>
        <div className="review-reference-skeleton-nav">
          <span className="review-reference-skeleton-button" />
          <span className="review-reference-skeleton-line tiny" />
          <span className="review-reference-skeleton-button" />
        </div>
      </aside>

      <div className="review-reference-skeleton-detail">
        <div className="review-reference-skeleton-topbar">
          <div className="review-reference-skeleton-copy">
            <span className="review-reference-skeleton-line tiny" />
            <span className="review-reference-skeleton-line short" />
          </div>
          <div className="review-reference-skeleton-actions">
            <span className="review-reference-skeleton-button" />
            <span className="review-reference-skeleton-button" />
          </div>
        </div>

        <div className="review-reference-skeleton-panel">
          <div className="review-reference-skeleton-panel-head">
            <span className="review-reference-skeleton-icon" />
            <div className="review-reference-skeleton-copy">
              <span className="review-reference-skeleton-line medium" />
              <span className="review-reference-skeleton-line short" />
            </div>
            <div className="review-reference-skeleton-actions">
              <span className="review-reference-skeleton-chip" />
              <span className="review-reference-skeleton-chip" />
            </div>
          </div>

          <div className="review-reference-skeleton-grid">
            <div className="review-reference-skeleton-card">
              <span className="review-reference-skeleton-line short" />
              <span className="review-reference-skeleton-line medium" />
              <span className="review-reference-skeleton-line medium" />
              <div className="review-reference-skeleton-chip-row">
                <span className="review-reference-skeleton-chip" />
                <span className="review-reference-skeleton-chip" />
                <span className="review-reference-skeleton-chip" />
              </div>
            </div>
            <div className="review-reference-skeleton-card">
              <span className="review-reference-skeleton-line short" />
              <div className="review-reference-skeleton-risk">
                <span className="review-reference-skeleton-ring" />
                <div className="review-reference-skeleton-copy">
                  <span className="review-reference-skeleton-line medium" />
                  <span className="review-reference-skeleton-line short" />
                  <span className="review-reference-skeleton-line short" />
                </div>
              </div>
            </div>
          </div>

          <div className="review-reference-skeleton-strip">
            <span className="review-reference-skeleton-line medium" />
            <div className="review-reference-skeleton-chip-row">
              <span className="review-reference-skeleton-chip" />
              <span className="review-reference-skeleton-chip" />
            </div>
            <span className="review-reference-skeleton-button" />
          </div>

          <div className="review-reference-skeleton-decision">
            <div className="review-reference-skeleton-card">
              <span className="review-reference-skeleton-line short" />
              <div className="review-reference-skeleton-action-row">
                <span className="review-reference-skeleton-button wide" />
                <span className="review-reference-skeleton-button wide" />
                <span className="review-reference-skeleton-button wide" />
              </div>
              <span className="review-reference-skeleton-textarea" />
            </div>
            <div className="review-reference-skeleton-sidecard">
              <span className="review-reference-skeleton-line short" />
              <span className="review-reference-skeleton-button wide" />
              <span className="review-reference-skeleton-line short" />
              <span className="review-reference-skeleton-line short" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function primaryFinding(detail: ReviewDetail) {
  const first = detail.findings[0];
  if (first?.category && typeof first.category === "string") {
    return first.category.replaceAll("_", " ").toLowerCase();
  }
  return detail.department === "Legal" ? "privileged matter" : "sensitive context";
}

function precedentDataClass(detail: ReviewDetail) {
  const modelEvidence = detail.model_evidence as {
    local_model?: { data_class?: unknown };
  };
  const localModelClass = modelEvidence.local_model?.data_class;
  if (typeof localModelClass === "string" && localModelClass.trim()) {
    return localModelClass;
  }
  const firstFinding = detail.findings.find((item) => typeof item?.category === "string");
  if (typeof firstFinding?.category === "string" && firstFinding.category.trim()) {
    return firstFinding.category;
  }
  return "PUBLIC_OR_INTERNAL_SAFE";
}

function originLabel(origin: string) {
  if (!origin) return "External destination";
  try {
    const host = new URL(origin).hostname.replace(/^www\./, "");
    if (host.includes("chatgpt")) return "ChatGPT external";
    return host;
  } catch {
    return origin;
  }
}
