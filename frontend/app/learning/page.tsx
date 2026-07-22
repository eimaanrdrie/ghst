"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ChevronRight,
  Eye,
  FileChartColumnIncreasing,
  FileClock,
  FileSearch,
  FileText,
  FlaskConical,
  FolderTree,
  Gauge,
  Lock,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Timer,
  TriangleAlert,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";
import { deriveLearningOverviewState, type LearningCalibration, type LearningModel } from "@/lib/learning-overview";

type Calibration = LearningCalibration & {
  source_review_ids?: string[];
  proposed_config: Record<string, number>;
};

type Model = LearningModel & {
  model_digest?: string;
  dataset_digest?: string;
  base_model?: string;
};

type Job = {
  id: string;
  model_name: string;
  backend: string;
  dataset_digest: string;
  status: string;
  config: Record<string, unknown>;
  report: Record<string, unknown>;
  output_path?: string;
  created_at?: string;
};

type AuditEvent = {
  sequence: number;
  id: string;
  event_type: string;
  actor_id: string;
  actor_name?: string | null;
  department: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  previous_hash: string;
  event_hash: string;
  created_at: string;
};

type QueueItem =
  | { kind: "calibration"; id: string; title: string; subtitle: string; owner: string; metric: string; tone: "warning" | "success" }
  | { kind: "candidate"; id: string; title: string; subtitle: string; owner: string; metric: string; tone: "warning" | "success" }
  | { kind: "precedent"; id: string; title: string; subtitle: string; owner: string; metric: string; tone: "warning" | "success" };

type PendingPrecedent = {
  id: string;
  department: string;
  purpose: string;
  data_class: string;
  impact_class: string;
  risk_ceiling: number;
  status: string;
  created_at: string;
  justification: string;
};

type ImpactRow = {
  key: string;
  icon: typeof Target;
  label: string;
  left: string;
  right: string;
  leftGauge: number;
  rightGauge: number;
  delta: string;
  deltaTone: "positive" | "negative" | "neutral";
};

type ImpactView = {
  heading: string;
  subtitle: string;
  leftLabel: string;
  leftTitle: string;
  leftBadge: { label: string; tone: "success" | "warning" | "danger" };
  rightLabel: string;
  rightTitle: string;
  rightBadge: { label: string; tone: "success" | "warning" | "danger" };
  rows: ImpactRow[];
  note: string;
};

const TODAY = new Date("2026-07-21T00:00:00Z");
const QUEUE_PAGE_SIZE = 6;

export default function LearningPage() {
  const { user } = useAuth();
  const canGovern = user?.roles.includes("POLICY_ADMIN") || user?.roles.includes("SYSTEM_ADMIN") || false;
  const canSeeJobs = user?.roles.some((role) => ["POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN"].includes(role)) || false;

  const [calibrations, setCalibrations] = useState<Calibration[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pendingPrecedents, setPendingPrecedents] = useState<PendingPrecedent[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [calibrationModalId, setCalibrationModalId] = useState<string | null>(null);
  const [candidateModalId, setCandidateModalId] = useState<string | null>(null);
  const [precedentModalId, setPrecedentModalId] = useState<string | null>(null);
  const [queuePage, setQueuePage] = useState(0);
  const [learningPulse, setLearningPulse] = useState<string | null>(null);
  const [comparisonFocusId, setComparisonFocusId] = useState<string | null>(null);
  const [rollbackOpen, setRollbackOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [canSeeJobs]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (calibrationModalId) setCalibrationModalId(null);
      if (candidateModalId) setCandidateModalId(null);
      if (precedentModalId) setPrecedentModalId(null);
      if (rollbackOpen) setRollbackOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [calibrationModalId, candidateModalId, precedentModalId, rollbackOpen]);

  useEffect(() => {
    if (!learningPulse) return;
    const timer = window.setTimeout(() => setLearningPulse(null), 4200);
    return () => window.clearTimeout(timer);
  }, [learningPulse]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [nextCalibrations, nextModels, nextPendingPrecedents, nextAuditEvents] = await Promise.all([
        api<Calibration[]>("/learning/calibrations"),
        api<Model[]>("/learning/models"),
        api<PendingPrecedent[]>("/precedents?status_filter=PENDING_SECOND_REVIEW"),
        api<AuditEvent[]>("/audit/events?limit=200"),
      ]);
      setCalibrations(nextCalibrations);
      setModels(nextModels);
      setPendingPrecedents(nextPendingPrecedents);
      setAuditEvents(nextAuditEvents);
      if (canSeeJobs) {
        setJobs(await api<Job[]>("/learning/model-jobs"));
      } else {
        setJobs([]);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load governed learning.");
    } finally {
      setLoading(false);
    }
  }

  async function act(path: string, body?: object, successMessage?: string, learningMessage?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      setMessage(successMessage || "Governed learning action completed.");
      if (learningMessage) {
        setLearningPulse(learningMessage);
      }
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The governed learning action failed safely.");
    } finally {
      setBusy(false);
    }
  }

  const overview = useMemo(() => deriveLearningOverviewState(calibrations, models), [calibrations, models]);
  const { latestCalibrationDraft, latestCandidate, lifecycle, productionModel, shadowModel, summary } = overview;

  const latestCalibration = calibrations.find((item) => item.id === latestCalibrationDraft?.id) || null;
  const activeCalibration = calibrations.find((item) => item.status === "ACTIVE") || null;
  const challenger = shadowModel || latestCandidate || null;
  const selectedCalibration = calibrations.find((item) => item.id === calibrationModalId) || null;
  const selectedCandidate = models.find((item) => item.id === candidateModalId) || null;
  const selectedPrecedent = pendingPrecedents.find((item) => item.id === precedentModalId) || null;

  const learningEvents = useMemo(
    () =>
      auditEvents
        .filter((event) =>
          ["CALIBRATION", "MODEL_VERSION", "MODEL_TRAINING_JOB", "REVIEW"].includes(event.entity_type) ||
          [
            "CALIBRATION_RECOMMENDED",
            "CALIBRATION_ACTIVATED",
            "MODEL_CANDIDATE_CREATED",
            "MODEL_CANDIDATE_EVALUATED",
            "MODEL_SHADOW_DEPLOYED",
            "MODEL_PROMOTED",
            "MODEL_ROLLED_BACK",
          ].includes(event.event_type),
        )
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [auditEvents],
  );

  const approvalQueue = useMemo<QueueItem[]>(() => {
    const queue: QueueItem[] = [];
    for (const precedent of pendingPrecedents) {
      queue.push({
        kind: "precedent",
        id: precedent.id,
        title: `Auto-proposed precedent · ${precedent.purpose}`,
        subtitle: `${precedent.department} · ${friendlyDataClass(precedent.data_class)}`,
        owner: "AI",
        metric: `Risk ${Math.round(precedent.risk_ceiling * 100)}% ceiling`,
        tone: "warning",
      });
    }
    if (latestCalibration) {
      queue.push({
        kind: "calibration",
        id: latestCalibration.id,
        title: inferCalibrationTitle(latestCalibration),
        subtitle: `${Number(latestCalibration.evidence.validated_reviews || 0)} verified cases`,
        owner: initials(user?.display_name || "Policy Admin"),
        metric: `${formatThreshold(latestCalibration.proposed_config.local_model_confidence_threshold)} → ${formatThreshold(latestCalibration.proposed_config.ace_similarity_threshold)}`,
        tone: Number(latestCalibration.evidence.projected_false_allows || 0) > 0 ? "warning" : "success",
      });
    }
    if (challenger) {
      queue.push({
        kind: "candidate",
        id: challenger.id,
        title: challenger.model_name,
        subtitle: `${summary.verifiedCases} verified cases`,
        owner: initials(actorNameForEntity(learningEvents, challenger.id) || "Approver"),
        metric: safetyGatePassCount(challenger) >= 5 ? "5/5 gates" : `${safetyGatePassCount(challenger)}/5 gates`,
        tone: safetyGatePassCount(challenger) >= 5 ? "success" : "warning",
      });
    }
    return queue;
  }, [challenger, latestCalibration, learningEvents, pendingPrecedents, summary.verifiedCases, user?.display_name]);
  const approvalPageCount = Math.max(1, Math.ceil(approvalQueue.length / QUEUE_PAGE_SIZE));
  const safeQueuePage = Math.min(queuePage, approvalPageCount - 1);
  const approvalQueuePreview = approvalQueue.slice(
    safeQueuePage * QUEUE_PAGE_SIZE,
    safeQueuePage * QUEUE_PAGE_SIZE + QUEUE_PAGE_SIZE,
  );
  const previewStart = approvalQueue.length ? safeQueuePage * QUEUE_PAGE_SIZE + 1 : 0;
  const previewEnd = approvalQueue.length ? Math.min(approvalQueue.length, previewStart + approvalQueuePreview.length - 1) : 0;
  const focusedQueueItem = approvalQueue.find((item) => item.id === comparisonFocusId) || approvalQueue[0] || null;

  useEffect(() => {
    if (queuePage !== safeQueuePage) {
      setQueuePage(safeQueuePage);
    }
  }, [queuePage, safeQueuePage]);

  useEffect(() => {
    if (!comparisonFocusId && approvalQueue[0]) {
      setComparisonFocusId(approvalQueue[0].id);
      return;
    }
    if (comparisonFocusId && !approvalQueue.some((item) => item.id === comparisonFocusId)) {
      setComparisonFocusId(approvalQueue[0]?.id || null);
    }
  }, [approvalQueue, comparisonFocusId]);

  const lifecycleNodes = useMemo(() => {
    const counts = [summary.verifiedCases, calibrations.length, latestCandidate ? 1 : 0, challenger?.metrics?.evaluated ? "PASS" : "WAIT", shadowModel ? shadowDays(shadowModel) : null, approvalQueue.length];
    const icons = [FolderTree, SlidersHorizontal, BrainCircuit, FileSearch, Eye, UserCheck];
    const labels = ["Evidence", "Calibrate", "Candidate", "Evaluate", "Shadow", "Approve"];
    return lifecycle.map((step, index) => ({
      key: labels[index],
      label: labels[index],
      count: counts[index],
      complete: step.complete,
      current: step.current,
      disabled: step.disabled,
      icon: icons[index],
    }));
  }, [approvalQueue.length, calibrations.length, challenger, latestCandidate, lifecycle, shadowModel, summary.verifiedCases]);

  const comparisonView = buildApprovalImpactView({
    focusedItem: focusedQueueItem,
    productionModel,
    challenger,
    activeCalibration,
    latestCalibration,
    pendingPrecedents,
  });
  const queueCount = approvalQueue.length;
  const departmentsCount = new Set(calibrations.flatMap((item) => item.source_review_ids || []).length ? learningEvents.map((event) => event.department).filter(Boolean) : []).size;
  const unsafeReleases = learningEvents.filter((event) => event.event_type === "MODEL_CANDIDATE_EVALUATED" && event.payload.status === "REJECTED").length;
  const rollbackReady = Boolean(productionModel?.previous_model_id);
  const rollbackState = learningEvents.find((event) => event.event_type === "MODEL_ROLLED_BACK");
  const driftValue = deriveDriftValue(productionModel, challenger);
  const failedEvaluation = Boolean(challenger && challenger.status === "REJECTED");
  const rejectedCandidate = Boolean(challenger && challenger.status === "REJECTED");
  const driftAlert = driftValue >= 2.5;
  const evidenceReady = summary.verifiedCases > 0;
  const noLiveTraining = true;
  const canRollback = canGovern && rollbackReady;
  const candidateCreatedBy = selectedCandidate ? actorIdForEntity(learningEvents, selectedCandidate.id) : null;
  const independentApprovalSatisfied = Boolean(selectedCandidate && candidateCreatedBy && candidateCreatedBy !== user?.id);
  const candidateCanPromote =
    Boolean(selectedCandidate && selectedCandidate.status === "SHADOW" && safetyGatePassCount(selectedCandidate) >= 5 && independentApprovalSatisfied);

  function openQueueItem(item: QueueItem) {
    setComparisonFocusId(item.id);
    if (item.kind === "calibration") {
      setCalibrationModalId(item.id);
      return;
    }
    if (item.kind === "candidate") {
      setCandidateModalId(item.id);
      return;
    }
    setPrecedentModalId(item.id);
  }

  async function decidePrecedent(precedentId: string, approved: boolean) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/precedents/${precedentId}/second-approval`, {
        method: "POST",
        body: JSON.stringify({
          approved,
          justification: approved
            ? "Independent governed learning approval confirmed the proposed precedent boundary."
            : "Independent governed learning approval rejected the proposed precedent boundary.",
        }),
      });
      setMessage(approved ? "Precedent approved and activated." : "Precedent rejected.");
      if (approved) {
        setLearningPulse("Learning memory updated from approved precedent");
      }
      await load();
      setPrecedentModalId(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Precedent approval failed safely.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell hideSidebarCommandCard compactSystemBar>
      <div className={`page learning-ref-page${loading ? " learning-ref-page-loading" : ""}`}>
        <header className="learning-ref-header">
          <div className="learning-ref-title">
            <h1>Governed learning</h1>
            <p>Human-controlled adaptation</p>
          </div>
          <div className="learning-ref-header-actions">
            <button className="button button-secondary learning-ref-icon-button" onClick={() => void load()} disabled={busy} aria-label="Refresh governed learning">
              <RefreshCw size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        {learningPulse && (
          <section className="learning-ref-learning-banner" role="status" aria-live="polite">
            <div className="learning-ref-learning-badge">
              <BrainCircuit size={16} aria-hidden="true" />
              Learning synced
            </div>
            <strong>{learningPulse}</strong>
            <div className="learning-ref-learning-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </section>
        )}

        {error && (
          <div className="notice notice-error learning-ref-notice" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            {error}
          </div>
        )}
        {message && (
          <div className="notice notice-success learning-ref-notice" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            {message}
          </div>
        )}

        <section className="learning-ref-lifecycle">
          <div className="learning-ref-lifecycle-rail">
            {lifecycleNodes.map((node, index) => {
              const Icon = node.icon;
              return (
                <div className="learning-ref-lifecycle-node" key={node.key}>
                  <div className={`learning-ref-lifecycle-orbit${node.complete ? " complete" : node.current ? " current" : " blocked"}`}>
                    <Icon size={22} aria-hidden="true" />
                    {(node.complete || node.current) && <span className="learning-ref-lifecycle-check"><CheckCircle2 size={14} aria-hidden="true" /></span>}
                  </div>
                  {index < lifecycleNodes.length - 1 && (
                    <div className={`learning-ref-lifecycle-line${node.complete ? " complete" : node.current ? " current" : " blocked"}${node.key === "Shadow" ? " warn" : ""}`} />
                  )}
                  <span>{node.label}</span>
                  <strong>{node.count ?? "—"}</strong>
                </div>
              );
            })}
          </div>
          <div className="learning-ref-lifecycle-lock">
            <Lock size={16} aria-hidden="true" />
            No live-request training
          </div>
        </section>

        <section className="learning-ref-main">
          <section className="learning-ref-queue card">
            <div className="learning-ref-section-head">
              <div className="learning-ref-section-title">
                <h2>Approval queue</h2>
                <span>{queueCount}</span>
              </div>
              <div className="learning-ref-queue-nav">
                <button
                  type="button"
                  className="learning-ref-queue-nav-button"
                  onClick={() => setQueuePage((current) => Math.max(0, current - 1))}
                  disabled={safeQueuePage === 0}
                  aria-label="Previous queue items"
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                </button>
                <span>{previewStart}-{previewEnd} of {approvalQueue.length}</span>
                <button
                  type="button"
                  className="learning-ref-queue-nav-button"
                  onClick={() => setQueuePage((current) => Math.min(approvalPageCount - 1, current + 1))}
                  disabled={safeQueuePage >= approvalPageCount - 1}
                  aria-label="Next queue items"
                >
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="learning-ref-queue-list">
              {loading ? (
                <div className="learning-ref-empty">
                  <div className="loader" />
                  <p>Loading approval queue…</p>
                </div>
              ) : approvalQueuePreview.length ? (
                approvalQueuePreview.map((item) => (
                  <article
                    className="learning-ref-queue-row learning-ref-queue-row-button"
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openQueueItem(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openQueueItem(item);
                      }
                    }}
                  >
                    <div className="learning-ref-queue-icon">
                      {item.kind === "calibration" ? <SlidersHorizontal size={30} aria-hidden="true" /> : item.kind === "candidate" ? <BrainCircuit size={30} aria-hidden="true" /> : <BookOpenText size={30} aria-hidden="true" />}
                    </div>
                    <div className="learning-ref-queue-copy">
                      <strong>{item.title}</strong>
                      <span>{item.subtitle}</span>
                      <div className="learning-ref-queue-metrics">
                        <span className={`learning-ref-chip ${item.tone}`}>{item.metric}</span>
                        {item.kind === "candidate" && challenger?.status === "SHADOW" && <span className="learning-ref-chip success">Shadow complete</span>}
                        {item.kind === "candidate" && challenger?.status === "REJECTED" && <span className="learning-ref-chip warning">Failed evaluation</span>}
                        {item.kind === "precedent" && <span className="learning-ref-chip warning">Needs approval</span>}
                      </div>
                    </div>
                    <div className="learning-ref-queue-owner">{item.owner}</div>
                    <button
                      type="button"
                      className={`learning-ref-queue-action ${item.kind === "calibration" ? "teal" : item.kind === "candidate" ? "gold" : "teal"}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        openQueueItem(item);
                      }}
                    >
                      <span>{item.kind === "calibration" ? "Review" : item.kind === "candidate" ? "Approve" : "Open"}</span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </article>
                ))
              ) : (
                <div className="learning-ref-empty">
                  <ShieldCheck size={22} aria-hidden="true" />
                  <p>No approvals are waiting.</p>
                </div>
              )}
            </div>
          </section>

          <div>
          <section className="learning-ref-impact card">
            <div className="learning-ref-section-head">
              <div className="learning-ref-section-stack">
                <h2>{comparisonView?.heading || "Approval impact"}</h2>
                <p>{comparisonView?.subtitle || "Select a governed approval item to see what changes after approval."}</p>
              </div>
            </div>
            {loading ? (
              <div className="learning-ref-empty">
                <div className="loader" />
                <p>Loading approval impact…</p>
              </div>
            ) : comparisonView ? (
              <>
                <div className="learning-ref-model-head">
                  <div className="learning-ref-model-card">
                    <span>{comparisonView.leftLabel}</span>
                    <strong>{comparisonView.leftTitle}</strong>
                    <StatusBadge label={comparisonView.leftBadge.label} tone={comparisonView.leftBadge.tone} />
                  </div>
                  <div className="learning-ref-model-card">
                    <span>{comparisonView.rightLabel}</span>
                    <strong>{comparisonView.rightTitle}</strong>
                    <StatusBadge label={comparisonView.rightBadge.label} tone={comparisonView.rightBadge.tone} />
                  </div>
                </div>
                <div className="learning-ref-compare-head" aria-hidden="true">
                  <span>Metric</span>
                  <span>Before</span>
                  <span>After</span>
                  <span>Change</span>
                </div>
                <div className="learning-ref-compare-metrics">
                  {comparisonView.rows.map((row) => (
                    <div className="learning-ref-compare-row" key={row.key}>
                      <div className="learning-ref-compare-label">
                        <row.icon size={18} aria-hidden="true" />
                        <span>{row.label}</span>
                      </div>
                      <div className="learning-ref-compare-side">
                        <strong>{row.left}</strong>
                        <div className="learning-ref-compare-bar"><span style={{ width: `${row.leftGauge}%` }} /></div>
                      </div>
                      <div className="learning-ref-compare-side">
                        <strong>{row.right}</strong>
                        <div className="learning-ref-compare-bar"><span style={{ width: `${row.rightGauge}%` }} /></div>
                      </div>
                      <span className={`learning-ref-delta ${row.deltaTone}`}>{row.delta}</span>
                    </div>
                  ))}
                </div>
                <div className="learning-ref-gates">
                  <ShieldCheck size={16} aria-hidden="true" />
                  {comparisonView.note}
                </div>
              </>
            ) : (
              <div className="learning-ref-empty">
                <BookOpenText size={22} aria-hidden="true" />
                <p>No approval impact is available yet.</p>
              </div>
            )}
          </section>
          </div>
        </section>

        <section className="learning-ref-summary card">
          <SummaryStat icon={FolderTree} value={`${summary.verifiedCases}`} label="Verified cases" tone="success" />
          <SummaryStat icon={Building2} value={`${departmentsCount || 0}`} label="Departments" />
          <SummaryStat icon={Gauge} value={`${driftValue.toFixed(1)}%`} label={driftAlert ? "Drift alert" : "Drift · Stable"} tone={driftAlert ? "warning" : "default"} />
          <SummaryStat icon={ShieldAlert} value={`${unsafeReleases}`} label="Unsafe releases" tone={unsafeReleases ? "danger" : "default"} />
          <SummaryStat icon={RotateCcw} value={rollbackState ? "Rolled back" : rollbackReady ? "Rollback ready" : "No rollback"} label="Rollback status" tone={rollbackState ? "warning" : "default"} />
        </section>

        {selectedCalibration && (
          <ModalFrame title={inferCalibrationTitle(selectedCalibration)} subtitle={selectedCalibration.version} onClose={() => setCalibrationModalId(null)}>
            <div className="learning-modal-grid">
              <div className="learning-modal-card">
                <span>Evidence</span>
                <strong>{Number(selectedCalibration.evidence.validated_reviews || 0)} verified cases</strong>
                <small>{Number(selectedCalibration.evidence.allow_count || 0)} allows · {Number(selectedCalibration.evidence.block_count || 0)} blocks</small>
              </div>
              <div className="learning-modal-card">
                <span>Threshold impact</span>
                <strong>{formatThreshold(selectedCalibration.proposed_config.local_model_confidence_threshold)} → {formatThreshold(selectedCalibration.proposed_config.ace_similarity_threshold)}</strong>
                <small>{Number(selectedCalibration.evidence.projected_false_allows || 0)} projected false allows</small>
              </div>
            </div>
            <div className="learning-modal-panel">
              <strong>Approval controls</strong>
              <p>Only validated reviewer evidence enters calibration. Activation retires the previous calibration and creates an immutable audit event.</p>
            </div>
            <div className="learning-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setCalibrationModalId(null)}>Cancel</button>
              <button
                type="button"
                className="button button-primary"
                disabled={!canGovern || busy}
                onClick={() => void act(`/learning/calibrations/${selectedCalibration.id}/activate`, { justification: "Validated reviewer evidence and threshold impact reviewed; calibration approved." }, "Calibration approved and activated.", "Learning thresholds updated from governed approval")}
              >
                <CheckCircle2 size={15} aria-hidden="true" />
                Review calibration
              </button>
            </div>
          </ModalFrame>
        )}

        {selectedCandidate && (
          <ModalFrame title={selectedCandidate.model_name} subtitle={selectedCandidate.status} onClose={() => setCandidateModalId(null)}>
            <div className="learning-modal-grid">
              <div className="learning-modal-card">
                <span>Dataset lineage</span>
                <strong>{selectedCandidate.dataset_digest || matchingJob(jobs, selectedCandidate)?.dataset_digest || "Unavailable"}</strong>
                <small>{matchingJob(jobs, selectedCandidate)?.backend || selectedCandidate.adapter_type}</small>
              </div>
              <div className="learning-modal-card">
                <span>Held-out tests</span>
                <strong>{metricValue(selectedCandidate.metrics.held_out_recall, true)}</strong>
                <small>Recall · schema validity {metricValue(selectedCandidate.metrics.schema_validity, true)}</small>
              </div>
              <div className="learning-modal-card">
                <span>Adversarial evaluation</span>
                <strong>{selectedCandidate.metrics.adversarial_passed ? "Passed" : selectedCandidate.status === "REJECTED" ? "Failed" : "Pending"}</strong>
                <small>Regression {selectedCandidate.metrics.regression_passed ? "passed" : "pending"}</small>
              </div>
              <div className="learning-modal-card">
                <span>Calibration</span>
                <strong>{activeCalibration?.version || "No active calibration"}</strong>
                <small>Validated reviewer evidence only</small>
              </div>
              <div className="learning-modal-card">
                <span>Shadow results</span>
                <strong>{selectedCandidate.status === "SHADOW" || selectedCandidate.status === "PRODUCTION" ? "Available" : "Awaiting shadow"}</strong>
                <small>{safetyGatePassCount(selectedCandidate)}/5 safety gates passed</small>
              </div>
              <div className="learning-modal-card">
                <span>Model card</span>
                <strong>{selectedCandidate.base_model || "Private adapter"}</strong>
                <small>{selectedCandidate.model_digest || "Digest unavailable"}</small>
              </div>
            </div>
            {failedEvaluation && selectedCandidate.id === challenger?.id && (
              <div className="learning-modal-state danger">
                <TriangleAlert size={16} aria-hidden="true" />
                Failed evaluation. Unsafe releases remain blocked and the candidate cannot promote.
              </div>
            )}
            <div className="learning-modal-panel">
              <strong>Human approval</strong>
              <p>Promotion requires safety gates, independent approval, shadow validation, tenant isolation, immutable version lineage, and zero live-request weight updates.</p>
            </div>
            <div className="learning-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setCandidateModalId(null)}>Close</button>
              {selectedCandidate.status === "EVALUATED" && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!canGovern || busy || safetyGatePassCount(selectedCandidate) < 5}
                  onClick={() => void act(`/learning/models/${selectedCandidate.id}/shadow`, { justification: "All held-out, adversarial, calibration and safety gates reviewed before governed shadow deployment." }, "Candidate deployed to governed shadow.")}
                >
                  <Eye size={15} aria-hidden="true" />
                  Send to shadow
                </button>
              )}
              {selectedCandidate.status === "SHADOW" && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!canGovern || busy || !candidateCanPromote}
                  onClick={() => void act(`/learning/models/${selectedCandidate.id}/promote`, { justification: "Independent authorised approval confirmed the shadow results and every safety gate before production promotion." }, "Candidate approved and promoted to production.", "Learning model promoted after governed approval")}
                >
                  <ShieldCheck size={15} aria-hidden="true" />
                  Approve candidate
                </button>
              )}
            </div>
          </ModalFrame>
        )}

        {selectedPrecedent && (
          <ModalFrame
            title="Approve precedent"
            subtitle={`${selectedPrecedent.purpose} · ${selectedPrecedent.department}`}
            onClose={() => setPrecedentModalId(null)}
          >
            <div className="learning-modal-grid">
              <div className="learning-modal-card">
                <span>Data class</span>
                <strong>{friendlyDataClass(selectedPrecedent.data_class)}</strong>
                <small>{selectedPrecedent.impact_class === "HIGH_IMPACT" ? "High impact" : "Standard impact"}</small>
              </div>
              <div className="learning-modal-card">
                <span>Risk ceiling</span>
                <strong>{Math.round(selectedPrecedent.risk_ceiling * 100)}%</strong>
                <small>Bounded reusable threshold</small>
              </div>
              <div className="learning-modal-card">
                <span>Status</span>
                <strong>{humanizeLearningEvent(selectedPrecedent.status)}</strong>
                <small>Waiting for independent approval</small>
              </div>
              <div className="learning-modal-card">
                <span>Origin</span>
                <strong>Auto-proposed</strong>
                <small>Generated from repeated approved reviews</small>
              </div>
            </div>
            <div className="learning-modal-panel">
              <strong>Reviewer note</strong>
              <p>{selectedPrecedent.justification}</p>
            </div>
            <div className="learning-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setPrecedentModalId(null)}>Cancel</button>
              <button
                type="button"
                className="button button-danger"
                disabled={busy}
                onClick={() => void decidePrecedent(selectedPrecedent.id, false)}
              >
                <X size={15} aria-hidden="true" />
                Reject
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => void decidePrecedent(selectedPrecedent.id, true)}
              >
                <ShieldCheck size={15} aria-hidden="true" />
                Approve and learn
              </button>
            </div>
          </ModalFrame>
        )}

        {rollbackOpen && productionModel && (
          <ModalFrame title="Rollback production model" subtitle={productionModel.model_name} onClose={() => setRollbackOpen(false)}>
            <div className="learning-modal-panel">
              <strong>Rollback confirmation</strong>
              <p>Rollback restores the preserved signed previous version, records an audit event, and does not alter immutable lineage.</p>
            </div>
            <div className={`learning-modal-state${rollbackReady ? "" : " danger"}`}>
              {rollbackReady ? <RotateCcw size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
              {rollbackReady ? "Previous approved version is available for restore." : "No rollback target is available for this production model."}
            </div>
            <div className="learning-modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setRollbackOpen(false)}>Cancel</button>
              <button
                type="button"
                className="button button-danger"
                disabled={!canRollback || busy}
                onClick={() => void act(`/learning/models/${productionModel.id}/rollback`, { justification: "Authorised rollback restored the signed previous production version after governance confirmation." }, "Rollback completed and audit recorded.")}
              >
                <RotateCcw size={15} aria-hidden="true" />
                Confirm rollback
              </button>
            </div>
          </ModalFrame>
        )}
      </div>
    </Shell>
  );
}

function buildApprovalImpactView({
  focusedItem,
  productionModel,
  challenger,
  activeCalibration,
  latestCalibration,
  pendingPrecedents,
}: {
  focusedItem: QueueItem | null;
  productionModel: Model | null;
  challenger: Model | null;
  activeCalibration: Calibration | null;
  latestCalibration: Calibration | null;
  pendingPrecedents: PendingPrecedent[];
}): ImpactView | null {
  if (!focusedItem) return null;
  if (focusedItem.kind === "precedent") {
    const precedent = pendingPrecedents.find((item) => item.id === focusedItem.id);
    if (!precedent) return null;
    return {
      heading: "After precedent approval",
      subtitle: "What changes after learning",
      leftLabel: "Before approval",
      leftTitle: "Similar prompts require review",
      leftBadge: { label: "PENDING", tone: "warning" },
      rightLabel: "After learning",
      rightTitle: "Similar prompts can reuse learned precedent",
      rightBadge: { label: "ACTIVE", tone: "success" },
      rows: [
        impactRow("path", BookOpenText, "Prompt path", "REVIEW", "ALLOW", 28, 90, "Faster", "positive"),
        impactRow("human", UserCheck, "Human review", "Required", "Not required", 22, 88, "Reduced", "positive"),
        impactRow("memory", BrainCircuit, "Learning source", "POLICY", "ACE precedent", 18, 82, "Stored", "positive"),
        impactRow("risk", ShieldAlert, "Risk ceiling", "None", `${Math.round(precedent.risk_ceiling * 100)}%`, 0, clamp(precedent.risk_ceiling * 100), "Bounded", "neutral"),
      ],
      note: "Approval adds reusable memory without changing model weights.",
    };
  }
  if (focusedItem.kind === "calibration") {
    if (!latestCalibration) return null;
    const currentConfidence = Number(activeCalibration?.proposed_config.local_model_confidence_threshold ?? 0.78);
    const currentAce = Number(activeCalibration?.proposed_config.ace_similarity_threshold ?? 0.72);
    const nextConfidence = Number(latestCalibration.proposed_config.local_model_confidence_threshold ?? currentConfidence);
    const nextAce = Number(latestCalibration.proposed_config.ace_similarity_threshold ?? currentAce);
    return {
      heading: "Before approval vs after approval",
      subtitle: "What changes when this calibration is activated",
      leftLabel: "Before approval",
      leftTitle: activeCalibration?.version || "Current thresholds",
      leftBadge: { label: activeCalibration ? "ACTIVE" : "DEFAULT", tone: "success" },
      rightLabel: "After approval",
      rightTitle: latestCalibration.version,
      rightBadge: { label: "PROPOSED", tone: "warning" },
      rows: [
        impactRow("confidence", BrainCircuit, "Model confidence", formatThreshold(currentConfidence), formatThreshold(nextConfidence), clamp(currentConfidence * 100), clamp(nextConfidence * 100), signedThresholdDelta(nextConfidence - currentConfidence), nextConfidence >= currentConfidence ? "positive" : "negative"),
        impactRow("ace", SlidersHorizontal, "ACE similarity", formatThreshold(currentAce), formatThreshold(nextAce), clamp(currentAce * 100), clamp(nextAce * 100), signedThresholdDelta(nextAce - currentAce), nextAce >= currentAce ? "positive" : "negative"),
        impactRow("reviews", FolderTree, "Validated reviews", `${Number(activeCalibration?.evidence.validated_reviews || 0)}`, `${Number(latestCalibration.evidence.validated_reviews || 0)}`, clamp(Number(activeCalibration?.evidence.validated_reviews || 0) / 3), clamp(Number(latestCalibration.evidence.validated_reviews || 0) / 3), "Evidence", "neutral"),
        impactRow("false-allow", ShieldAlert, "Projected false allows", "Current", `${Number(latestCalibration.evidence.projected_false_allows || 0)}`, 55, Number(latestCalibration.evidence.projected_false_allows || 0) === 0 ? 85 : 42, Number(latestCalibration.evidence.projected_false_allows || 0) === 0 ? "Safer" : "Watch", Number(latestCalibration.evidence.projected_false_allows || 0) === 0 ? "positive" : "negative"),
      ],
      note: "Approval changes thresholds, not model weights or policy boundaries.",
    };
  }
  if (focusedItem.kind === "candidate" && productionModel && challenger) {
    return {
      heading: "Before approval vs after approval",
      subtitle: "What changes if this trained model is promoted",
      leftLabel: "Before approval",
      leftTitle: productionModel.model_name,
      leftBadge: { label: "ACTIVE", tone: "success" },
      rightLabel: "After approval",
      rightTitle: challenger.model_name,
      rightBadge: { label: candidateStatusLabel(challenger.status), tone: challenger.status === "REJECTED" ? "danger" : "warning" },
      rows: buildComparisonRows(productionModel, challenger),
      note: `Promotion replaces the live model and preserves rollback. Safety gates ${safetyGatePassCount(challenger)}/5 passed.`,
    };
  }
  return null;
}

function buildComparisonRows(champion: Model | null, challenger: Model | null) {
  const recallChampion = metricNumber(champion?.metrics.held_out_recall ?? champion?.metrics.recall);
  const recallChallenger = metricNumber(challenger?.metrics.held_out_recall ?? challenger?.metrics.recall);
  const falseAllowChampion = metricNumber(champion?.metrics.secret_false_allows);
  const falseAllowChallenger = metricNumber(challenger?.metrics.secret_false_allows);
  const macroChampion = metricNumber(champion?.metrics.macro_f1);
  const macroChallenger = metricNumber(challenger?.metrics.macro_f1);
  const latencyChampion = metricNumber(champion?.metrics.p95_latency_ms ?? champion?.metrics.median_latency_ms);
  const latencyChallenger = metricNumber(challenger?.metrics.p95_latency_ms ?? challenger?.metrics.median_latency_ms);

  return [
    comparisonRow("recall", Target, "Sensitive recall", recallChampion, recallChallenger, true, false),
    comparisonRow("false-allow", ShieldAlert, "False-allow rate", falseAllowChampion, falseAllowChallenger, false, true),
    comparisonRow("macro-f1", Gauge, "Macro-F1", macroChampion, macroChallenger, true, false),
    comparisonRow("latency", Timer, "P95 latency", latencyChampion, latencyChallenger, false, true, " ms"),
  ];
}

function impactRow(
  key: string,
  icon: typeof Target,
  label: string,
  left: string,
  right: string,
  leftGauge: number,
  rightGauge: number,
  delta: string,
  deltaTone: "positive" | "negative" | "neutral",
): ImpactRow {
  return { key, icon, label, left, right, leftGauge: clamp(leftGauge), rightGauge: clamp(rightGauge), delta, deltaTone };
}

function comparisonRow(
  key: string,
  icon: typeof Target,
  label: string,
  left: number | null,
  right: number | null,
  percent = false,
  lowerIsBetter = false,
  suffix = "",
): ImpactRow {
  const leftDisplay = left === null ? "N/A" : percent ? `${formatMaybePercent(left)}` : `${Math.round(left)}${suffix}`;
  const rightDisplay = right === null ? "N/A" : percent ? `${formatMaybePercent(right)}` : `${Math.round(right)}${suffix}`;
  const deltaNumber = left !== null && right !== null ? right - left : null;
  const deltaTone: "positive" | "negative" | "neutral" =
    deltaNumber === null ? "neutral" : lowerIsBetter ? (deltaNumber <= 0 ? "positive" : "negative") : deltaNumber >= 0 ? "positive" : "negative";
  return {
    key,
    icon,
    label,
    left: leftDisplay,
    right: rightDisplay,
    leftGauge: toGauge(left, percent, lowerIsBetter),
    rightGauge: toGauge(right, percent, lowerIsBetter),
    delta: deltaNumber === null ? "—" : `${deltaNumber > 0 ? "+" : ""}${percent ? formatDeltaPercent(deltaNumber) : `${Math.round(deltaNumber)}${suffix}`}`,
    deltaTone,
  };
}

function toGauge(value: number | null, percent: boolean, lowerIsBetter: boolean) {
  if (value === null) return 0;
  if (percent) return clamp(value <= 1 ? value * 100 : value);
  const normalized = lowerIsBetter ? 100 - Math.min(value, 1000) / 10 : Math.min(value, 100);
  return clamp(normalized);
}

function safetyGatePassCount(model: Model | null) {
  if (!model) return 0;
  const metrics = model.metrics || {};
  const gates = metrics.gates as Record<string, unknown> | undefined;
  if (gates) return Object.values(gates).filter(Boolean).length;
  let count = 0;
  if ((metricNumber(metrics.held_out_recall) ?? 0) >= 0.95) count += 1;
  if ((metricNumber(metrics.schema_validity) ?? 0) >= 0.98) count += 1;
  if ((metricNumber(metrics.secret_false_allows) ?? 99) === 0) count += 1;
  if (metrics.adversarial_passed === true) count += 1;
  if (metrics.regression_passed === true) count += 1;
  return count;
}

function deriveDriftValue(production: Model | null, challenger: Model | null) {
  const productionMacro = metricNumber(production?.metrics.macro_f1);
  const challengerMacro = metricNumber(challenger?.metrics.macro_f1);
  if (productionMacro !== null && challengerMacro !== null) return Math.abs((challengerMacro - productionMacro) * 100);
  const meanUncertainty = metricNumber(production?.metrics.mean_uncertainty);
  if (meanUncertainty !== null) return meanUncertainty * 100;
  return 1.8;
}

function matchingJob(jobs: Job[], model: Model | null) {
  if (!model) return null;
  return jobs.find((job) => job.model_name === model.model_name || job.dataset_digest === model.dataset_digest) || null;
}

function inferCalibrationTitle(calibration: Calibration) {
  const blocks = Number(calibration.evidence.block_count || 0);
  return blocks >= 1 ? "Finance calibration" : "Policy calibration";
}

function actorNameForEntity(events: AuditEvent[], entityId: string) {
  return events.find((event) => event.entity_id === entityId)?.actor_name || null;
}

function actorIdForEntity(events: AuditEvent[], entityId: string) {
  return events.find((event) => event.entity_id === entityId)?.actor_id || null;
}

function humanizeLearningEvent(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function eventOutcome(event: AuditEvent) {
  if (typeof event.payload.status === "string") return String(event.payload.status).replaceAll("_", " ");
  if (typeof event.payload.approved === "boolean") return event.payload.approved ? "Approved" : "Rejected";
  if (event.event_type.includes("ROLLED_BACK")) return "Rollback";
  return "Recorded";
}

function entityLabel(event: AuditEvent) {
  if (event.entity_type === "CALIBRATION") return `Calibration ${event.entity_id}`;
  if (event.entity_type === "MODEL_VERSION") return `Model ${event.entity_id}`;
  if (event.entity_type === "MODEL_TRAINING_JOB") return `Training ${event.entity_id}`;
  return event.entity_id;
}

function metricNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metricValue(value: unknown, percent = false) {
  const parsed = metricNumber(value);
  if (parsed === null) return "N/A";
  return percent ? formatMaybePercent(parsed) : `${parsed}`;
}

function formatMaybePercent(value: number) {
  return value <= 1 ? `${(value * 100).toFixed(1)}%` : `${value.toFixed(1)}%`;
}

function formatDeltaPercent(value: number) {
  return value <= 1 && value >= -1 ? `${(value * 100).toFixed(1)}` : `${value.toFixed(1)}`;
}

function formatThreshold(value: unknown) {
  return typeof value === "number" ? value.toFixed(2) : "0.00";
}

function signedThresholdDelta(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function friendlyDataClass(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function candidateStatusLabel(status: string) {
  if (status === "SHADOW") return "SHADOW";
  if (status === "REJECTED") return "REJECTED";
  if (status === "EVALUATED") return "EVALUATED";
  if (status === "CANDIDATE") return "CANDIDATE";
  return humanizeLearningEvent(status);
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function formatDateTime(value?: string) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function shadowDays(model: Model) {
  const basis = model.deployed_at || model.created_at;
  if (!basis) return "—";
  const ms = Math.max(0, TODAY.getTime() - new Date(basis).getTime());
  return `${Math.max(1, Math.round(ms / 86400000))}d`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function SummaryStat({ icon: Icon, value, label, tone = "default" }: { icon: typeof FolderTree; value: string; label: string; tone?: "default" | "success" | "warning" | "danger" }) {
  return (
    <div className={`learning-summary-stat${tone !== "default" ? ` ${tone}` : ""}`}>
      <Icon size={34} aria-hidden="true" />
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: "success" | "warning" | "danger" }) {
  return <span className={`learning-status-badge ${tone}`}>{label}</span>;
}

function ModalFrame({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="learning-modal-backdrop" role="presentation" onClick={onClose}>
      <section className={`learning-modal card${wide ? " learning-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="learning-modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="learning-modal-head">
          <div>
            <h2 id="learning-modal-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close governed learning modal">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="learning-modal-body">{children}</div>
      </section>
    </div>
  );
}

function InfoRow({ icon: Icon, label }: { icon: typeof FileClock; label: string }) {
  return (
    <span className="learning-inline-info">
      <Icon size={18} aria-hidden="true" />
      {label}
    </span>
  );
}
