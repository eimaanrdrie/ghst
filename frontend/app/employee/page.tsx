"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Bookmark,
  CheckCircle2,
  FileText,
  LockKeyhole,
  MessageSquareWarning,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatusPill } from "@/components/status-pill";
import { api } from "@/lib/api";
import type { Evaluation } from "@/lib/types";

const APPROVED = "https://chatgpt.com";
const samples = [
  ["Safe legal research", "Summarise the public Federal Court decision in a neutral briefing for our legal research team.", "Legal research"],
  ["Personal data", "Draft a response to nur.aisha@example.com and call her at +6012 345 6789 about the public seminar.", "Routine drafting"],
  ["Hard secret", "Debug this API call. The key is sk-demoSECRET1234567890abcdef and it returns 401.", "Software troubleshooting"],
  ["Ambiguous context", "Summarise the public launch notes for Project Aurora for the legal knowledge team.", "Legal research"],
] as const;

export default function EmployeePage() {
  const [prompt, setPrompt] = useState<string>(samples[0][1]);
  const [purpose, setPurpose] = useState<string>(samples[0][2]);
  const [destination, setDestination] = useState<string>(APPROVED);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downstream, setDownstream] = useState("");
  const [challengeReason, setChallengeReason] = useState("I believe this classification is a false positive because the content is synthetic or public.");
  const [challengeMessage, setChallengeMessage] = useState("");
  const sessionId = "employee-managed-browser-session";

  async function evaluateRequest(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    setDownstream("");
    try {
      const body = new FormData();
      body.append("prompt", prompt);
      body.append("purpose", purpose);
      body.append("destination_origin", destination);
      body.append("session_id", sessionId);
      body.append("device_id", "managed-demo-device");
      if (file) body.append("file", file);
      setResult(await api<Evaluation>("/evaluations", { method: "POST", body }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Evaluation failed safely.");
    } finally {
      setBusy(false);
    }
  }

  async function applyRedaction() {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const next = await api<Evaluation>(`/evaluations/${result.evaluation_id}/redact`, {
        method: "POST",
        body: JSON.stringify({ prompt, purpose, destination_origin: destination, session_id: sessionId, device_id: "managed-demo-device" }),
      });
      if (next.redacted_text) setPrompt(next.redacted_text);
      setFile(null);
      setResult(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Redaction failed safely.");
    } finally {
      setBusy(false);
    }
  }

  async function useRedirect() {
    if (!result?.redirect_origin) return;
    const approvedOrigin = result.redirect_origin;
    setDestination(approvedOrigin);
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const body = new FormData();
      body.append("prompt", prompt);
      body.append("purpose", purpose);
      body.append("destination_origin", approvedOrigin);
      body.append("session_id", sessionId);
      body.append("device_id", "managed-demo-device");
      if (file) body.append("file", file);
      setResult(await api<Evaluation>("/evaluations", { method: "POST", body }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Redirect evaluation failed safely.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshReview() {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      setResult(await api<Evaluation>(`/evaluations/${result.evaluation_id}`));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not refresh review outcome.");
    } finally {
      setBusy(false);
    }
  }

  async function releaseThroughGateway() {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const finalBody = new FormData();
      finalBody.append("prompt", prompt);
      finalBody.append("purpose", purpose);
      finalBody.append("destination_origin", destination);
      finalBody.append("session_id", sessionId);
      finalBody.append("device_id", "managed-demo-device");
      const finalEvaluation = await api<Evaluation>("/evaluations", { method: "POST", body: finalBody });
      if (finalEvaluation.action !== "ALLOW") {
        setResult(finalEvaluation);
        throw new Error("The complete final evaluation no longer permits release.");
      }
      setResult(finalEvaluation);
      const grant = await api<{ clearance_grant: string }>(`/evaluations/${finalEvaluation.evaluation_id}/clearance-grant`, {
        method: "POST",
        body: JSON.stringify({ prompt, device_id: "managed-demo-device" }),
      });
      const response = await api<{ choices: { message: { content: string } }[] }>("/gateway/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "mock-approved-model",
          messages: [{ role: "user", content: prompt }],
          clearance_grant: grant.clearance_grant,
          device_id: "managed-demo-device",
        }),
      });
      setDownstream(response.choices[0].message.content);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Gateway release was blocked.");
    } finally {
      setBusy(false);
    }
  }

  async function challengeClassification() {
    if (!result) return;
    setBusy(true);
    setError("");
    setChallengeMessage("");
    try {
      const response = await api<{ message: string }>(`/evaluations/${result.evaluation_id}/challenge`, {
        method: "POST",
        body: JSON.stringify({ reason: challengeReason }),
      });
      setChallengeMessage(response.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The challenge could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="page app-page-fit app-page-fit-with-toolbar">
        <header className="page-header page-header-compact">
          <div>
            <div className="eyebrow">
              <ShieldCheck size={14} aria-hidden="true" />
              Employee policy enforcement point
            </div>
            <h1>Protected Prompt Composer</h1>
            <p>GHST evaluates the request inside the organisation before anything reaches the chosen AI destination.</p>
          </div>
          <div className="header-actions">
            <span className="trust-chip">
              <LockKeyhole size={14} aria-hidden="true" />
              Managed session · governance active
            </span>
          </div>
        </header>

        <section className="metrics-strip">
          <article className="metric metric-compact">
            <div className="metric-top">
              <div>
                <span className="metric-label">Active destination</span>
                <div className="metric-value" style={{ fontSize: 24 }}>
                  {destination.includes("chatgpt.com") ? "APPROVED" : "UNAPPROVED"}
                </div>
              </div>
              <span className="metric-icon">
                <Send size={18} aria-hidden="true" />
              </span>
            </div>
          </article>
          <article className="metric metric-compact">
            <div className="metric-top">
              <div>
                <span className="metric-label">Prompt length</span>
                <div className="metric-value" style={{ fontSize: 24 }}>
                  {prompt.length.toLocaleString()}
                </div>
              </div>
              <span className="metric-icon">
                <MessageSquareWarning size={18} aria-hidden="true" />
              </span>
            </div>
          </article>
          <article className="metric metric-compact">
            <div className="metric-top">
              <div>
                <span className="metric-label">Attachment state</span>
                <div className="metric-value" style={{ fontSize: 24 }}>
                  {file ? "PDF LOADED" : "NONE"}
                </div>
              </div>
              <span className="metric-icon">
                <FileText size={18} aria-hidden="true" />
              </span>
            </div>
          </article>
          <article className="metric metric-compact">
            <div className="metric-top">
              <div>
                <span className="metric-label">Last decision</span>
                <div className="metric-value" style={{ fontSize: 24 }}>
                  {result?.action || "PENDING"}
                </div>
              </div>
              <span className="metric-icon">
                <ShieldCheck size={18} aria-hidden="true" />
              </span>
            </div>
          </article>
        </section>

        <div className="fit-grid-2 fit-panel">
          <form className="card card-pad stack-16 fit-card-scroll" onSubmit={evaluateRequest}>
            <div className="section-title">
              <h2>Request context</h2>
              <span className="reason-code">Department from trusted identity</span>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="purpose">Business purpose</label>
                <select id="purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)}>
                  <option>Legal research</option>
                  <option>Routine drafting</option>
                  <option>Financial analysis</option>
                  <option>Software troubleshooting</option>
                  <option>Customer communication</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="destination">AI destination</label>
                <select id="destination" value={destination} onChange={(event) => setDestination(event.target.value)}>
                  <option value={APPROVED}>ChatGPT · approved</option>
                  <option value="https://unapproved-ai.example">Unapproved public AI · blocked</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label htmlFor="prompt">Prompt</label>
              <textarea
                id="prompt"
                value={prompt}
                maxLength={12000}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setResult(null);
                }}
                aria-describedby="prompt-hint"
              />
              <span className="hint" id="prompt-hint">
                {prompt.length.toLocaleString()} / 12,000 characters · raw content is not retained in standard records
              </span>
            </div>
            <div className="field">
              <label>Optional PDF</label>
              <div className="file-drop">
                <FileText size={19} aria-hidden="true" />
                <div style={{ flex: 1 }}>
                  <strong>{file ? file.name : "Upload one PDF for bounded classification"}</strong>
                  <div className="hint">One PDF · 5 MB · 25 pages · encrypted or unclassifiable files fail closed.</div>
                </div>
                <input
                  aria-label="Upload one PDF"
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] || null);
                    setResult(null);
                  }}
                />
                {file && (
                  <button type="button" className="icon-button" aria-label="Remove PDF" onClick={() => setFile(null)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            <div className="section-title">
              <h3>Sample scenarios</h3>
            </div>
            <div className="button-row">
              {samples.map(([label, text, use]) => (
                <button
                  type="button"
                  key={label}
                  className="button button-secondary"
                  onClick={() => {
                    setPrompt(text);
                    setPurpose(use);
                    setFile(null);
                    setResult(null);
                  }}
                >
                  <Bookmark size={14} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
            {error && (
              <div className="notice notice-error" role="alert">
                <AlertCircle size={17} aria-hidden="true" />
                {error}
              </div>
            )}
            <button className="button button-primary button-block" disabled={busy || (!prompt.trim() && !file)}>
              {busy ? <><span className="loader" />Evaluating governance boundary...</> : <><ScanSearch size={17} aria-hidden="true" />Evaluate before submission</>}
            </button>
          </form>

          <section aria-live="polite" className="fit-card-scroll">
            {!result ? (
              <div className="card empty">
                <Sparkles size={28} aria-hidden="true" />
                <h3>Decision evidence will appear here</h3>
                <p>GHST will show the action, findings, policy basis, and the next permitted step before external release.</p>
              </div>
            ) : (
              <div className="card decision">
                <div className="decision-head">
                  <div>
                    <StatusPill value={result.action} />
                    <h2>
                      {result.action === "ALLOW"
                        ? "Cleared by governance"
                        : result.action === "BLOCK"
                          ? "External release blocked"
                          : result.action === "REVIEW"
                            ? "Human authority required"
                            : result.action === "REDACT"
                              ? "Safe transformation available"
                              : "Approved alternative required"}
                    </h2>
                  </div>
                  <div className="risk-score">
                    <strong>{Math.round(result.risk.score * 100)}</strong>
                    <small>risk index · {result.risk.level}</small>
                  </div>
                </div>
                <div className="decision-body stack-24">
                  <p className="decision-message">{result.message}</p>

                  <section className="stack-12">
                    <div className="section-title">
                      <h3>Decision reasons</h3>
                    </div>
                    <div className="code-list">
                      {result.reason_codes.map((code) => (
                        <span key={code} className="reason-code">{code}</span>
                      ))}
                    </div>
                  </section>

                  <section className="stack-12">
                    <div className="section-title">
                      <h3>Detected evidence</h3>
                      <StatusPill value={result.findings.length ? result.risk.level : "LOW"} />
                    </div>
                    {result.findings.length ? (
                      <div className="list">
                        {result.findings.map((finding, index) => (
                          <div className="list-item" key={`${finding.category}-${index}`}>
                            <div className="list-item-top">
                              <strong>{finding.category.replaceAll("_", " ")}</strong>
                              <StatusPill value={finding.severity} />
                            </div>
                            <p>{finding.source} · {Math.round(finding.confidence * 100)}% confidence · {finding.detector} · preview {finding.masked_preview}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="notice notice-success">
                        <CheckCircle2 size={16} aria-hidden="true" />
                        No supported sensitive-data class was detected.
                      </div>
                    )}
                  </section>

                  <section className="stack-12">
                    <div className="section-title">
                      <h3>Applicable policy evidence</h3>
                    </div>
                    <div className="list">
                      {result.policy_matches.slice(0, 2).map((match) => (
                        <div className="list-item" key={match.clause_id}>
                          <div className="list-item-top">
                            <strong>{match.policy} · §{match.clause}</strong>
                            <span className="reason-code">{match.policy_version}</span>
                          </div>
                          <p>{match.text}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="stack-12">
                    <div className="section-title">
                      <h3>Permitted next action</h3>
                    </div>
                    {result.action === "REDACT" && (
                      <button className="button button-primary button-block" onClick={() => void applyRedaction()} disabled={busy}>
                        <RefreshCw size={16} aria-hidden="true" />
                        Apply typed redaction and rescan
                      </button>
                    )}
                    {result.action === "REDIRECT" && (
                      <button className="button button-primary button-block" onClick={() => void useRedirect()} disabled={busy}>
                        <ArrowRight size={16} aria-hidden="true" />
                        Use approved ChatGPT destination
                      </button>
                    )}
                    {result.action === "REVIEW" && (
                      <button className="button button-secondary button-block" onClick={() => void refreshReview()} disabled={busy}>
                        <RefreshCw size={16} aria-hidden="true" />
                        Check authorised review outcome
                      </button>
                    )}
                    {result.action === "BLOCK" && (
                      <div className="notice notice-error">
                        <LockKeyhole size={17} aria-hidden="true" />
                        No continue-anyway control is available. Remove the prohibited content and submit a new evaluation.
                      </div>
                    )}
                    {result.action === "ALLOW" && !file && (
                      <button className="button button-primary button-block" onClick={() => void releaseThroughGateway()} disabled={busy}>
                        <Send size={16} aria-hidden="true" />
                        Send with one-time clearance grant
                      </button>
                    )}
                    {result.action === "ALLOW" && file && (
                      <div className="notice">
                        <FileText size={16} aria-hidden="true" />
                        PDF clearance is demonstrated at the policy layer. The gateway fast path in this MVP remains text-only.
                      </div>
                    )}
                  </section>

                  {result.action !== "ALLOW" && (
                    <section className="stack-12">
                      <div className="section-title">
                        <h3>Challenge classification</h3>
                      </div>
                      <div className="field">
                        <label htmlFor="challenge">Suspected false positive?</label>
                        <textarea id="challenge" value={challengeReason} onChange={(event) => setChallengeReason(event.target.value)} />
                      </div>
                      <button
                        className="button button-secondary button-block"
                        onClick={() => void challengeClassification()}
                        disabled={busy || challengeReason.trim().length < 8}
                      >
                        <MessageSquareWarning size={15} aria-hidden="true" />
                        Record classification challenge
                      </button>
                    </section>
                  )}

                  {challengeMessage && (
                    <div className="notice notice-success" role="status">
                      <CheckCircle2 size={16} aria-hidden="true" />
                      {challengeMessage}
                    </div>
                  )}

                  {downstream && (
                    <div className="notice notice-success">
                      <CheckCircle2 size={17} aria-hidden="true" />
                      {downstream}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </Shell>
  );
}
