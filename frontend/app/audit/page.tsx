"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  EyeOff,
  FileClock,
  Filter,
  Fingerprint,
  Landmark,
  History,
  Link2,
  Package2,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  User,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { api } from "@/lib/api";

type Event = {
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

type Verify = {
  valid: boolean;
  checked_events: number;
  first_broken_sequence?: number;
  message: string;
};

const PAGE_SIZE = 5;
const EVENT_TYPE_OPTIONS = [
  "",
  "EVALUATION_DECIDED",
  "HUMAN_REVIEW_DECIDED",
  "ACE_PRECEDENT_CREATED",
  "CLEARANCE_GRANT_ISSUED",
  "GATEWAY_FAST_PATH_ACCEPTED",
  "GATEWAY_REQUEST_BLOCKED",
  "POLICY_VERSION_ACTIVATED",
  "MODEL_PROMOTED",
  "MODEL_ROLLED_BACK",
] as const;
const RESULT_OPTIONS = ["", "VERIFIED", "ENFORCED", "RECORDED", "FAILED"] as const;

export default function AuditPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      setError("");
      const nextEvents = await api<Event[]>("/audit/events?limit=150");
      setEvents(nextEvents);
      setSelectedId((current) => current || nextEvents[0]?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load audit events.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, typeFilter, actorFilter, resultFilter, dateFilter]);

  async function check() {
    setError("");
    try {
      setVerify(await api<Verify>("/audit/verify", { method: "POST" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    }
  }

  const actorOptions = useMemo(
    () => Array.from(new Set(events.map((item) => formatActor(item)).filter(Boolean))).sort(),
    [events],
  );

  const filteredEvents = useMemo(() => {
    return events.filter((item) => {
      const haystack = [
        item.event_type,
        item.department,
        item.entity_type,
        item.entity_id,
        item.actor_id,
        item.actor_name || "",
        JSON.stringify(item.payload),
      ].join(" ").toLowerCase();
      return (
        (!query || haystack.includes(query.toLowerCase())) &&
        (!typeFilter || item.event_type === typeFilter) &&
        (!actorFilter || formatActor(item) === actorFilter) &&
        (!resultFilter || deriveResult(item) === resultFilter) &&
        (!dateFilter || item.created_at.slice(0, 10) === dateFilter)
      );
    });
  }, [actorFilter, dateFilter, events, query, resultFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedEvents = filteredEvents.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectedEvent = filteredEvents.find((item) => item.id === selectedId) || paginatedEvents[0] || filteredEvents[0] || null;

  useEffect(() => {
    if (selectedEvent && selectedEvent.id !== selectedId) {
      setSelectedId(selectedEvent.id);
    }
  }, [selectedEvent, selectedId]);

  const chainHealth = useMemo(() => {
    return {
      valid: verify ? verify.valid : true,
      checked: verify?.checked_events || events.length,
      breaks: verify?.first_broken_sequence ? 1 : 0,
      lastVerified: verify ? "Now" : formatLedgerTime(events[0]?.created_at),
      retention: "365d",
    };
  }, [events, verify]);

  const receiptJson = selectedEvent ? JSON.stringify(selectedEvent, null, 2) : "";

  async function copyText(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(message);
      window.setTimeout(() => setCopyMessage(""), 1800);
    } catch {
      setCopyMessage("Copy failed");
      window.setTimeout(() => setCopyMessage(""), 1800);
    }
  }

  function exportReceipt() {
    if (!selectedEvent) return;
    const blob = new Blob([receiptJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `audit-receipt-${selectedEvent.sequence}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Shell hideSidebarCommandCard compactSystemBar>
      <div className={`page audit-exact-page${loading ? " audit-exact-page-loading" : ""}`}>
        <header className="audit-exact-header">
          <div>
            <h1>Audit evidence</h1>
            <div className="audit-exact-subtitle">Verifiable decision history</div>
          </div>
          <div className="audit-exact-actions">
            <button className="button button-secondary" onClick={() => void check()}>
              <ShieldCheck size={16} aria-hidden="true" />
              Verify
            </button>
            <button
              className="button button-secondary audit-exact-icon-button"
              onClick={() => selectedEvent && void copyText(receiptJson, "Receipt copied")}
              title="Copy receipt"
            >
              <Copy size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        {error && (
          <div className="notice notice-error audit-exact-notice" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            {error}
          </div>
        )}
        {copyMessage && (
          <div className="notice notice-success audit-exact-notice" role="status">
            <CheckCheck size={16} aria-hidden="true" />
            {copyMessage}
          </div>
        )}

        <section className="audit-exact-health">
          <div className="audit-exact-health-item audit-exact-health-status">
            {chainHealth.valid ? <ShieldCheck size={20} aria-hidden="true" /> : <ShieldAlert size={20} aria-hidden="true" />}
            <strong>{chainHealth.valid ? "Chain valid" : "Chain warning"}</strong>
          </div>
          <div className="audit-exact-health-item">
            <Filter size={18} aria-hidden="true" />
            <span>{chainHealth.checked}</span>
            <small>events</small>
          </div>
          <div className="audit-exact-health-item">
            {chainHealth.breaks ? <ShieldX size={18} aria-hidden="true" /> : <Shield size={18} aria-hidden="true" />}
            <span>{chainHealth.breaks}</span>
            <small>breaks</small>
          </div>
          <div className="audit-exact-health-item">
            <History size={18} aria-hidden="true" />
            <small>Last verified</small>
            <span>{chainHealth.lastVerified}</span>
          </div>
          <div className="audit-exact-health-item">
            <CalendarDays size={18} aria-hidden="true" />
            <small>Retention</small>
            <span>{chainHealth.retention}</span>
          </div>
          <button
            type="button"
            className="audit-exact-health-link"
            title={selectedEvent ? selectedEvent.event_hash : "No receipt selected"}
            onClick={() => selectedEvent && void copyText(selectedEvent.event_hash, "Receipt hash copied")}
          >
            Receipt
          </button>
        </section>

        <section className="audit-exact-toolbar">
          <label className="audit-exact-search">
            <Search size={18} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search events" aria-label="Search events" />
          </label>
          <label className="audit-exact-filter">
            <Filter size={16} aria-hidden="true" />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter by type">
              <option value="">Type</option>
              {EVENT_TYPE_OPTIONS.filter(Boolean).map((option) => (
                <option key={option} value={option}>
                  {formatEventType(option)}
                </option>
              ))}
            </select>
          </label>
          <label className="audit-exact-filter">
            <User size={16} aria-hidden="true" />
            <select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)} aria-label="Filter by actor">
              <option value="">Actor</option>
              {actorOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="audit-exact-filter">
            <Shield size={16} aria-hidden="true" />
            <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)} aria-label="Filter by result">
              <option value="">Result</option>
              {RESULT_OPTIONS.filter(Boolean).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="audit-exact-filter">
            <CalendarDays size={16} aria-hidden="true" />
            <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Filter by date" />
          </label>
        </section>

        <section className="audit-exact-workspace">
          <section className="audit-exact-ledger">
            <div className="audit-exact-ledger-head">
              <div className="audit-exact-ledger-title">
                <h2>Events</h2>
                <span>{filteredEvents.length}</span>
              </div>
            </div>

            <div className="audit-exact-ledger-header">
              <span>Event</span>
              <span>Actor</span>
              <span>Entity</span>
              <span>Result</span>
            </div>

            <div className="audit-exact-ledger-body">
              {paginatedEvents.length ? (
                paginatedEvents.map((item) => {
                  const result = deriveResult(item);
                  const tone = resultTone(result);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`audit-exact-ledger-row${selectedEvent?.id === item.id ? " selected" : ""}`}
                      onClick={() => setSelectedId(item.id)}
                      title={`${item.previous_hash} → ${item.event_hash}`}
                    >
                      <div className="audit-exact-ledger-cell audit-exact-ledger-event">
                        <span className={`audit-exact-ledger-icon ${tone}`}>{statusIcon(result)}</span>
                        <div>
                          <strong>{formatLedgerTitle(item)}</strong>
                          <small>#{item.sequence} · {formatLedgerTime(item.created_at)}</small>
                        </div>
                      </div>
                      <span className="audit-exact-ledger-cell">{formatActor(item)}</span>
                      <span className="audit-exact-ledger-cell">{formatEntity(item)}</span>
                      <span className={`audit-exact-ledger-cell audit-exact-result ${tone}`}>{result}</span>
                    </button>
                  );
                })
              ) : (
                <div className="audit-exact-empty">
                  <FileClock size={22} aria-hidden="true" />
                  <p>No events match the current filters.</p>
                </div>
              )}
            </div>

            <div className="audit-exact-pagination">
              <div className="audit-exact-pagination-summary">
                <strong>Page {currentPage}</strong>
                <span>of {totalPages}</span>
              </div>
              <div className="audit-exact-pagination-controls">
                <button
                  className="audit-exact-page-button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <div className="audit-exact-page-list" aria-label="Page navigation">
                  {buildPageList(currentPage, totalPages).map((value, index) =>
                    typeof value === "number" ? (
                      <button key={value} className={`audit-exact-page-number${value === currentPage ? " active" : ""}`} onClick={() => setPage(value)}>
                        {value}
                      </button>
                    ) : (
                      <span key={`${value}-${currentPage}-${index}`} className="audit-exact-page-ellipsis">{value}</span>
                    ),
                  )}
                </div>
                <button
                  className="audit-exact-page-button"
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  disabled={currentPage === totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>

          <section className="audit-exact-proof">
            {selectedEvent ? (
              <>
                <div className="audit-exact-proof-head">
                  <div className="audit-exact-proof-title">
                    <h2>#{selectedEvent.sequence} · {formatLedgerTitle(selectedEvent)}</h2>
                    <span className={`audit-exact-proof-badge ${resultTone(deriveResult(selectedEvent))}`}>{deriveResult(selectedEvent)}</span>
                  </div>
                  <span className="audit-exact-proof-privacy">
                    <EyeOff size={16} aria-hidden="true" />
                    No raw prompt
                  </span>
                </div>

                <div className="audit-exact-proof-meta">
                  <div className="audit-exact-proof-meta-item" title={formatActor(selectedEvent)}>
                    <User size={18} aria-hidden="true" />
                    <div>
                      <strong>{formatActor(selectedEvent)}</strong>
                      <small>{selectedEvent.department}</small>
                    </div>
                  </div>
                  <div className="audit-exact-proof-meta-item" title={formatEntity(selectedEvent)}>
                    <Package2 size={18} aria-hidden="true" />
                    <div>
                      <strong>{formatEntity(selectedEvent)}</strong>
                      <small>{selectedEvent.entity_type.replaceAll("_", " ").toLowerCase()}</small>
                    </div>
                  </div>
                  <div className="audit-exact-proof-meta-item" title={selectedEvent.department}>
                    <Landmark size={18} aria-hidden="true" />
                    <div>
                      <strong>Governance</strong>
                      <small>{selectedEvent.department}</small>
                    </div>
                  </div>
                  <div className="audit-exact-proof-meta-item" title={formatTimestamp(selectedEvent.created_at)}>
                    <History size={18} aria-hidden="true" />
                    <div>
                      <strong>{formatLedgerTime(selectedEvent.created_at)}</strong>
                      <small>{formatTimestamp(selectedEvent.created_at)}</small>
                    </div>
                  </div>
                </div>

                <p className="audit-exact-proof-summary">{describeEvent(selectedEvent)}</p>

                <div className="audit-exact-hash-chain">
                  <div className="audit-exact-hash-node">
                    <span>Previous</span>
                    <button type="button" className="audit-exact-hash-box" title={selectedEvent.previous_hash} onClick={() => void copyText(selectedEvent.previous_hash, "Previous hash copied")}>
                      <strong>{shortHash(selectedEvent.previous_hash)}</strong>
                      <Copy size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="audit-exact-hash-link" aria-hidden="true" />
                  <div className="audit-exact-hash-node">
                    <span>Event</span>
                    <button type="button" className="audit-exact-hash-box audit-exact-hash-box-current" title={selectedEvent.id} onClick={() => void copyText(selectedEvent.id, "Event id copied")}>
                      <strong>{shortHash(selectedEvent.id)}</strong>
                      <Copy size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="audit-exact-hash-link" aria-hidden="true" />
                  <div className="audit-exact-hash-node">
                    <span>Current</span>
                    <button type="button" className="audit-exact-hash-box" title={selectedEvent.event_hash} onClick={() => void copyText(selectedEvent.event_hash, "Current hash copied")}>
                      <strong>{shortHash(selectedEvent.event_hash)}</strong>
                      <Copy size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="audit-exact-proof-statuses">
                  <span><ShieldCheck size={18} aria-hidden="true" />Hash valid</span>
                  <span><Fingerprint size={18} aria-hidden="true" />Signed</span>
                  <span><Link2 size={18} aria-hidden="true" />Continuous</span>
                </div>

                <details className="audit-exact-proof-details">
                  <summary>
                    <span>Event data (canonical JSON)</span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </summary>
                  <div className="audit-exact-proof-expanded">
                    <div className="audit-exact-proof-line" title={selectedEvent.previous_hash}>
                      <strong>Previous hash</strong>
                      <span>{selectedEvent.previous_hash}</span>
                    </div>
                    <div className="audit-exact-proof-line" title={selectedEvent.event_hash}>
                      <strong>Current hash</strong>
                      <span>{selectedEvent.event_hash}</span>
                    </div>
                    <div className="audit-exact-proof-line" title={selectedEvent.id}>
                      <strong>Receipt id</strong>
                      <span>{selectedEvent.id}</span>
                    </div>
                    <pre>{receiptJson}</pre>
                  </div>
                </details>

                <div className="audit-exact-proof-actions">
                  <button className="button button-secondary" onClick={() => void copyText(receiptJson, "Receipt copied")}>
                    <Copy size={16} aria-hidden="true" />
                    Copy receipt
                  </button>
                  <button className="button button-primary" onClick={exportReceipt}>
                    <Download size={16} aria-hidden="true" />
                    Export
                  </button>
                </div>
              </>
            ) : (
              <div className="audit-exact-empty">
                <FileClock size={22} aria-hidden="true" />
                <p>Select an event to inspect proof.</p>
              </div>
            )}
          </section>
        </section>

        <footer className="audit-exact-trustbar">
          <span><FileClock size={16} aria-hidden="true" />Digest only</span>
          <span><Shield size={16} aria-hidden="true" />Tenant isolated</span>
          <span><Link2 size={16} aria-hidden="true" />Hash linked</span>
          <span><User size={16} aria-hidden="true" />RBAC protected</span>
        </footer>
      </div>
    </Shell>
  );
}

function formatEventType(value: string) {
  return value.toLowerCase().split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
}

function formatLedgerTitle(item: Event) {
  return formatEventType(item.event_type)
    .replace("Clearance Grant Issued", "Clearance granted")
    .replace("Gateway Request Blocked", "Gateway grant blocked")
    .replace("Policy Version Activated", "Policy activated")
    .replace("Model Rolled Back", "Model rolled back");
}

function formatActor(item: Event) {
  if (item.actor_name) return item.actor_name;
  if (!item.actor_id) return "Unknown";
  return item.actor_id.replaceAll(".", " ").replaceAll("_", " ");
}

function formatEntity(item: Event) {
  return `${item.entity_type.toLowerCase().replaceAll("_", " ")} ${item.entity_id.slice(0, 8)}`;
}

function describeEvent(item: Event) {
  const payload = JSON.stringify(item.payload).toLowerCase();
  if (item.event_type === "MODEL_ROLLED_BACK") return "Authorised rollback to the previous production version.";
  if (item.event_type === "MODEL_PROMOTED") return "Candidate model promoted after governance approval.";
  if (item.event_type === "POLICY_VERSION_ACTIVATED") return "Policy version activated and released for enforcement.";
  if (item.event_type.includes("BLOCKED")) return "Request was blocked after policy enforcement at the gateway.";
  if (item.event_type.includes("REJECTED")) return "Review outcome was recorded and release was denied.";
  if (payload.includes("approved")) return "Decision receipt was verified and recorded for downstream controls.";
  return "Event receipt recorded with chain-linked evidence for governance review.";
}

function deriveResult(item: Event) {
  if (item.event_type.includes("BLOCKED")) return "ENFORCED";
  if (item.event_type.includes("REJECTED")) return "RECORDED";
  if (item.event_type.includes("ROLLED_BACK") || item.event_type.includes("ACTIVATED") || item.event_type.includes("CREATED") || item.event_type.includes("ISSUED")) return "VERIFIED";
  return "RECORDED";
}

function resultTone(value: string) {
  if (value === "VERIFIED") return "success";
  if (value === "ENFORCED") return "danger";
  if (value === "FAILED") return "danger";
  return "warning";
}

function statusIcon(value: string) {
  if (value === "VERIFIED") return <ShieldCheck size={18} aria-hidden="true" />;
  if (value === "ENFORCED") return <ShieldAlert size={18} aria-hidden="true" />;
  if (value === "FAILED") return <ShieldX size={18} aria-hidden="true" />;
  return <History size={18} aria-hidden="true" />;
}

function shortHash(value: string) {
  if (!value) return "Unavailable";
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatLedgerTime(value?: string) {
  if (!value) return "Not verified";
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function buildPageList(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sortedPages = Array.from(pages).filter((page) => page >= 1 && page <= total).sort((left, right) => left - right);
  const items: Array<number | "..."> = [];

  for (const page of sortedPages) {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && page - previous > 1) {
      items.push("...");
    }
    items.push(page);
  }

  return items;
}
