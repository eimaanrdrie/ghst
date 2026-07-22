"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import {
  AlertCircle,
  ArrowLeft,
  BookOpenCheck,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Database,
  FileCheck2,
  Download,
  ExternalLink,
  FileStack,
  Filter,
  Globe2,
  GitMerge,
  LoaderCircle,
  ListFilter,
  MapPin,
  Play,
  Plus,
  Quote,
  RefreshCw,
  Save,
  Scissors,
  Search,
  ShieldCheck,
  ShieldX,
  ShieldEllipsis,
  Sparkles,
  Trash,
  Trash2,
  Upload,
  Users2,
  X,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { StatusPill } from "@/components/status-pill";
import { useAuth } from "@/components/auth-provider";
import { api } from "@/lib/api";

type Clause = {
  id: string;
  clause_ref: string;
  text: string;
  department: string;
  roles: string[];
  purposes: string[];
  data_classes: string[];
  destinations: string[];
  action: "ALLOW" | "REDACT" | "REDIRECT" | "REVIEW" | "BLOCK";
  page_number: number;
  heading: string | null;
  verification_status: string;
  human_notes: string | null;
  source_order: number;
  suggested_metadata: Record<string, unknown>;
  metadata_json: Record<string, unknown>;
  verified_by?: string | null;
  verified_at?: string | null;
};

type Version = {
  id: string;
  version: string;
  status: string;
  source_filename: string | null;
  storage_adapter: string;
  mime_type: string | null;
  size_bytes: number;
  sha256: string | null;
  source_kind: string;
  extraction_metadata: Record<string, unknown>;
  malware_scan: Record<string, unknown>;
  verification_summary: Record<string, unknown>;
  extraction_error: string | null;
  effective_at: string;
  clauses: Clause[];
};

type Policy = {
  id: string;
  name: string;
  category: string;
  owner: string;
  scope: string;
  status: string;
  description: string | null;
  versions: Version[];
};

type Lookups = {
  departments: string[];
  roles: string[];
  purposes: string[];
  data_classes: string[];
  destinations: string[];
  actions: Array<"ALLOW" | "REDACT" | "REDIRECT" | "REVIEW" | "BLOCK">;
  storage_adapters: { value: string; label: string }[];
};

type Draft = {
  clause_ref: string;
  text: string;
  department: string;
  roles: string;
  purposes: string;
  data_classes: string;
  destinations: string;
  action: "ALLOW" | "REDACT" | "REDIRECT" | "REVIEW" | "BLOCK";
  page_number: string;
  heading: string;
  verification_status: string;
  human_notes: string;
};

type Mode = "inventory" | "import" | "workspace";
type ImportKind = "new" | "version";
type UploadResult = { policy_id: string; version_id: string; storage_label: string } | null;

const emptyDraft: Draft = {
  clause_ref: "",
  text: "",
  department: "",
  roles: "",
  purposes: "",
  data_classes: "",
  destinations: "",
  action: "ALLOW",
  page_number: "1",
  heading: "",
  verification_status: "",
  human_notes: "",
};

export default function PoliciesPage() {
  const { user } = useAuth();
  const canEdit = user?.roles.includes("POLICY_ADMIN") || user?.roles.includes("SYSTEM_ADMIN") || false;

  const [mode, setMode] = useState<Mode>("inventory");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [policySearch, setPolicySearch] = useState("");
  const [policyStatusFilter, setPolicyStatusFilter] = useState("ALL");
  const [policyScopeFilter, setPolicyScopeFilter] = useState("ALL");
  const [policyOwnerFilter, setPolicyOwnerFilter] = useState("ALL");
  const [policyPage, setPolicyPage] = useState(1);

  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);
  const [inventoryInspectorOpen, setInventoryInspectorOpen] = useState(false);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);
  const [clauseSearch, setClauseSearch] = useState("");
  const [verificationFilter, setVerificationFilter] = useState("ALL");
  const [showBulkTools, setShowBulkTools] = useState(false);
  const [showSplitTools, setShowSplitTools] = useState(false);
  const [selectedClauseIds, setSelectedClauseIds] = useState<string[]>([]);
  const [workspaceClausePage, setWorkspaceClausePage] = useState(1);
  const [workspaceSourceOpen, setWorkspaceSourceOpen] = useState(false);
  const [workspaceAdvancing, setWorkspaceAdvancing] = useState(false);
  const [workspaceTransition, setWorkspaceTransition] = useState<"idle" | "advance">("idle");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadState, setUploadState] = useState("");
  const [policyName, setPolicyName] = useState("");
  const [policyVersion, setPolicyVersion] = useState("");
  const [policyCategory, setPolicyCategory] = useState("");
  const [policyOwner, setPolicyOwner] = useState(user?.display_name || "Policy Administrator");
  const [policyScope, setPolicyScope] = useState("");
  const [policyDescription, setPolicyDescription] = useState("");
  const [policyIdOverride, setPolicyIdOverride] = useState("");
  const [importKind, setImportKind] = useState<ImportKind>("new");
  const [importStep, setImportStep] = useState(1);
  const [importSearch, setImportSearch] = useState("");
  const [fileDigest, setFileDigest] = useState("");
  const [fileValidation, setFileValidation] = useState("");
  const [fileValidationError, setFileValidationError] = useState("");
  const [uploadResult, setUploadResult] = useState<UploadResult>(null);

  const [clauseDrafts, setClauseDrafts] = useState<Record<string, Draft>>({});
  const [splitDrafts, setSplitDrafts] = useState<Record<string, [string, string]>>({});

  const [viewportWidth, setViewportWidth] = useState(1440);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const importModalRef = useRef<HTMLDivElement | null>(null);
  const workspaceModalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncWidth = () => setViewportWidth(window.innerWidth);
    syncWidth();
    window.addEventListener("resize", syncWidth);
    return () => window.removeEventListener("resize", syncWidth);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || mode !== "inventory") return;
    const selectedPolicy = new URLSearchParams(window.location.search).get("policy");
    if (selectedPolicy) {
      setActivePolicyId(selectedPolicy);
      setInventoryInspectorOpen(true);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "workspace") return;
    const count = document.querySelectorAll("[data-clause-editor]").length;
    if (count > 1) {
      throw new Error(`Policy workspace rendered ${count} clause editors. Only one is allowed.`);
    }
  }, [mode, selectedClauseId, activeVersionId, clauseDrafts]);

  useEffect(() => {
    if (mode !== "workspace") return;
    const modal = workspaceModalRef.current;
    if (!modal) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const selectors = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ];
    const getFocusable = () =>
      Array.from(modal.querySelectorAll<HTMLElement>(selectors.join(","))).filter((node) => !node.hasAttribute("disabled") && node.tabIndex !== -1);
    getFocusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (workspaceSourceOpen) setWorkspaceSourceOpen(false);
        else closeWorkspace();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = getFocusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousActive?.focus?.();
    };
  }, [mode, workspaceSourceOpen]);

  useEffect(() => {
    if (workspaceTransition === "idle") return;
    const timer = window.setTimeout(() => setWorkspaceTransition("idle"), 240);
    return () => window.clearTimeout(timer);
  }, [workspaceTransition, selectedClauseId]);

  useEffect(() => {
    if (mode !== "import") return;
    const modal = importModalRef.current;
    if (!modal) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const selectors = [
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ];
    const getFocusable = () =>
      Array.from(modal.querySelectorAll<HTMLElement>(selectors.join(","))).filter((node) => !node.hasAttribute("disabled") && node.tabIndex !== -1);
    const focusable = getFocusable();
    focusable[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeImport();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = getFocusable();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousActive?.focus?.();
    };
  }, [mode]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [policyData, lookupData] = await Promise.all([api<Policy[]>("/policies"), api<Lookups>("/policies/lookups")]);
      setPolicies(policyData);
      setLookups(lookupData);

      const drafts: Record<string, Draft> = {};
      const splits: Record<string, [string, string]> = {};
      for (const policy of policyData) {
        for (const version of policy.versions) {
          for (const clause of version.clauses) {
            drafts[clause.id] = clauseToDraft(clause);
            splits[clause.id] = [clause.text, ""];
          }
        }
      }
      setClauseDrafts(drafts);
      setSplitDrafts(splits);

      setActivePolicyId((current) => current && policyData.some((item) => item.id === current) ? current : policyData[0]?.id || null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load policy memory.");
    } finally {
      setLoading(false);
    }
  }

  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      const latest = latestVersionByDate(policy);
      const matchesSearch = !policySearch.trim() || [policy.name, policy.owner, policy.category, latest?.version || ""].join(" ").toLowerCase().includes(policySearch.toLowerCase());
      const matchesStatus = policyStatusFilter === "ALL" || latest?.status === policyStatusFilter;
      const matchesScope = policyScopeFilter === "ALL" || policy.scope === policyScopeFilter;
      const matchesOwner = policyOwnerFilter === "ALL" || policy.owner === policyOwnerFilter;
      return matchesSearch && matchesStatus && matchesScope && matchesOwner;
    });
  }, [policies, policyOwnerFilter, policyScopeFilter, policySearch, policyStatusFilter]);

  useEffect(() => {
    setPolicyPage(1);
  }, [policyOwnerFilter, policyScopeFilter, policySearch, policyStatusFilter]);

  useEffect(() => {
    if (typeof window === "undefined" || mode !== "inventory") return;
    const params = new URLSearchParams(window.location.search);
    if (inventoryInspectorOpen && activePolicyId) params.set("policy", activePolicyId);
    else params.delete("policy");
    const next = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
  }, [activePolicyId, inventoryInspectorOpen, mode]);

  const pageSize = inventoryInspectorOpen && viewportWidth >= 1280 ? 5 : 6;
  const totalPolicies = filteredPolicies.length;
  const totalPages = Math.max(1, Math.ceil(totalPolicies / pageSize));
  const currentPolicyPage = Math.min(policyPage, totalPages);
  const pagedPolicies = useMemo(() => {
    const start = (currentPolicyPage - 1) * pageSize;
    return filteredPolicies.slice(start, start + pageSize);
  }, [currentPolicyPage, filteredPolicies, pageSize]);
  const pageStart = totalPolicies ? (currentPolicyPage - 1) * pageSize + 1 : 0;
  const pageEnd = totalPolicies ? Math.min(currentPolicyPage * pageSize, totalPolicies) : 0;
  const policyPageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, index) => index + 1), [totalPages]);

  const activePolicy = policies.find((policy) => policy.id === activePolicyId) || null;
  const activeVersion = activePolicy?.versions.find((version) => version.id === activeVersionId) || latestVersionByDate(activePolicy) || null;
  const inventoryPolicy = policies.find((policy) => policy.id === activePolicyId) || filteredPolicies[0] || null;
  const inventoryActiveVersion = activeVersionForPolicy(inventoryPolicy);
  const inventoryCandidateVersion = readyCandidateForPolicy(inventoryPolicy);

  useEffect(() => {
    if (!activePolicy) {
      setActiveVersionId(null);
      return;
    }
    if (activeVersionId && activePolicy.versions.some((version) => version.id === activeVersionId)) return;
    setActiveVersionId(latestVersionByDate(activePolicy)?.id || null);
  }, [activePolicy, activeVersionId]);

  const filteredClauses = useMemo(() => {
    const clauses = activeVersion?.clauses || [];
    return clauses.filter((clause) => {
      const textMatch = !clauseSearch.trim() || [clause.clause_ref, clause.heading || "", clause.text, clause.department, clause.action].join(" ").toLowerCase().includes(clauseSearch.toLowerCase());
      const verificationMatch = verificationFilter === "ALL" || clause.verification_status === verificationFilter;
      return textMatch && verificationMatch;
    });
  }, [activeVersion, clauseSearch, verificationFilter]);

  useEffect(() => {
    if (!activeVersion) {
      setSelectedClauseId(null);
      return;
    }
    if (selectedClauseId && activeVersion.clauses.some((clause) => clause.id === selectedClauseId)) return;
    setSelectedClauseId(filteredClauses[0]?.id || activeVersion.clauses[0]?.id || null);
  }, [activeVersion, filteredClauses, selectedClauseId]);

  useEffect(() => {
    setWorkspaceClausePage(1);
  }, [clauseSearch, verificationFilter, activeVersionId]);

  useEffect(() => {
    if (mode !== "workspace" || !selectedClauseId || !filteredClauses.length) return;
    const nextIndex = filteredClauses.findIndex((clause) => clause.id === selectedClauseId);
    if (nextIndex < 0) return;
    const nextPage = Math.floor(nextIndex / 5) + 1;
    setWorkspaceClausePage((current) => current === nextPage ? current : nextPage);
  }, [filteredClauses, mode, selectedClauseId]);

  useEffect(() => {
    if (mode !== "inventory" || !filteredPolicies.length) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const currentIndex = filteredPolicies.findIndex((item) => item.id === activePolicyId);
      if (event.key === "Escape" && inventoryInspectorOpen) {
        event.preventDefault();
        setInventoryInspectorOpen(false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = Math.min(filteredPolicies.length - 1, Math.max(0, currentIndex + 1));
        setActivePolicyId(filteredPolicies[nextIndex]?.id || activePolicyId);
        setInventoryInspectorOpen(true);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1);
        setActivePolicyId(filteredPolicies[nextIndex]?.id || activePolicyId);
        setInventoryInspectorOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePolicyId, filteredPolicies, inventoryInspectorOpen, mode]);

  const selectedClause = activeVersion?.clauses.find((clause) => clause.id === selectedClauseId) || null;
  const selectedDraft = selectedClause ? clauseDrafts[selectedClause.id] || clauseToDraft(selectedClause) : null;

  const inventorySummary = useMemo(() => {
    const activeCount = policies.filter((policy) => latestVersionByDate(policy)?.status === "ACTIVE").length;
    const draftsNeedingReview = policies.reduce((total, policy) => total + policy.versions.filter((version) => version.status === "HUMAN_REVIEW").length, 0);
    const failedImports = policies.reduce((total, policy) => total + policy.versions.filter((version) => version.status === "FAILED").length, 0);
    const readyToActivate = policies.reduce((total, policy) => total + policy.versions.filter((version) => version.verification_summary?.ready_for_activation).length, 0);
    return { activeCount, draftsNeedingReview, failedImports, readyToActivate };
  }, [policies]);

  useEffect(() => {
    if (!selectedFile) {
      setFileDigest("");
      setFileValidation("");
      setFileValidationError("");
      return;
    }
    let cancelled = false;
    void validateImportFile(selectedFile, policies).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setFileValidationError(result.error);
        setFileValidation("");
        setFileDigest(result.digest || "");
      } else {
        setFileValidationError("");
        setFileValidation(result.message || "Validated");
        setFileDigest(result.digest || "");
        setImportStep((current) => Math.max(current, 2));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFile, policies]);

  useEffect(() => {
    if (importKind !== "version") return;
    const matched = findPolicyBySearch(policies, importSearch);
    if (!matched) return;
    setPolicyIdOverride(matched.id);
    setPolicyName(matched.name);
    setPolicyCategory(matched.category);
    setPolicyOwner(matched.owner);
    setPolicyScope(matched.scope);
    setPolicyDescription(matched.description || "");
    setPolicyVersion(suggestNextVersion(matched));
  }, [importSearch, importKind, policies]);

  function openImport(targetPolicyId = "") {
    const targetPolicy = policies.find((item) => item.id === targetPolicyId) || null;
    setPolicyIdOverride(targetPolicyId);
    setSelectedFile(null);
    setUploadProgress(0);
    setUploadState("");
    setUploadResult(null);
    setFileDigest("");
    setFileValidation("");
    setFileValidationError("");
    setImportStep(1);
    setImportKind(targetPolicy ? "version" : "new");
    setImportSearch(targetPolicy ? `${targetPolicy.name} (${targetPolicy.category})` : "");
    setPolicyName(targetPolicy?.name || "");
    setPolicyVersion(targetPolicy ? suggestNextVersion(targetPolicy) : "");
    setPolicyCategory(targetPolicy?.category || "");
    setPolicyOwner(targetPolicy?.owner || user?.display_name || "Policy Administrator");
    setPolicyScope(targetPolicy?.scope || "ORGANISATION");
    setPolicyDescription(targetPolicy?.description || "");
    setMode("import");
  }

  function closeImport() {
    setMode("inventory");
  }

  function openWorkspace(policyId: string, versionId?: string) {
    const policy = policies.find((item) => item.id === policyId);
    const version = versionId ? policy?.versions.find((item) => item.id === versionId) : latestVersionByDate(policy);
    setActivePolicyId(policyId);
    setActiveVersionId(version?.id || null);
    setSelectedClauseId(version?.clauses[0]?.id || null);
    setClauseSearch("");
    setVerificationFilter("ALL");
    setSelectedClauseIds([]);
    setShowBulkTools(false);
    setShowSplitTools(false);
    setWorkspaceClausePage(1);
    setWorkspaceSourceOpen(false);
    setMode("workspace");
  }

  function closeWorkspace() {
    setWorkspaceSourceOpen(false);
    setMode("inventory");
  }

  async function uploadPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) {
      setError("Policy admin access is required to upload policies.");
      return;
    }
    if (!selectedFile) {
      setError("Choose a PDF, DOCX, or TXT policy file first.");
      setImportStep(1);
      return;
    }
    if (fileValidationError) {
      setError(fileValidationError);
      setImportStep(1);
      return;
    }
    if (!policyName.trim() || !policyVersion.trim() || !policyCategory.trim() || !policyOwner.trim() || !policyScope.trim()) {
      setError("Complete all required metadata before extraction.");
      setImportStep(2);
      return;
    }
    if (importKind === "version" && !policyIdOverride.trim()) {
      setError("Choose an existing policy family for a new version.");
      setImportStep(2);
      return;
    }

    setError("");
    setMessage("");
    setUploadResult(null);
    setImportStep(3);
    setUploadState("Uploading and extracting");
    setUploadProgress(1);
    const form = new FormData();
    form.append("file", selectedFile);
    form.append("name", policyName);
    form.append("version", policyVersion);
    form.append("category", policyCategory);
    form.append("owner", policyOwner);
    form.append("scope", policyScope);
    form.append("description", policyDescription);
    if (policyIdOverride.trim()) form.append("policy_id", policyIdOverride.trim());

    try {
      const result = await uploadWithProgress("/policies/uploads", form, (progress) => setUploadProgress(progress));
      setMessage(`Uploaded ${selectedFile.name}. Clauses are now awaiting human verification in ${result.storage_label}.`);
      setUploadProgress(100);
      setUploadState("Extraction complete");
      setUploadResult(result);
      await load();
      setActivePolicyId(result.policy_id);
      setActiveVersionId(result.version_id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Upload failed safely.");
      setUploadState("Action required");
      setUploadProgress(0);
    }
  }

  async function saveClause(clauseId: string) {
    const draft = clauseDrafts[clauseId];
    if (!draft) return;
    setError("");
    try {
      const body = sanitizeClauseMutation(draft);
      const saved = await api<Clause>(`/policies/clauses/${clauseId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setPolicies((current) => applyClauseUpdate(current, saved));
      setClauseDrafts((current) => ({ ...current, [clauseId]: clauseToDraft(saved) }));
      setSelectedClauseId(saved.id);
      setMessage(`Clause ${saved.clause_ref} updated.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not update clause.");
    }
  }

  async function verifyClauseAndNext(clauseId: string) {
    const clause = findClause(clauseId);
    const draft = clauseDrafts[clauseId];
    if (!clause || !draft) return;
    const sourceReference = `p.${draft.page_number || clause.page_number} · ${draft.heading || clause.heading || "No heading"}`;
    const reviewedAt = new Date().toISOString();
    const notePrefix = `Reviewed by ${user?.display_name || "Policy Administrator"} on ${new Date(reviewedAt).toLocaleString("en-GB")} · ${sourceReference}`;
    const enrichedDraft: Draft = {
      ...draft,
      verification_status: "VERIFIED",
      human_notes: draft.human_notes ? `${draft.human_notes}\n${notePrefix}` : notePrefix,
    };
    const currentIndex = filteredClauses.findIndex((item) => item.id === clauseId);
    const nextIndex = currentIndex >= 0 && currentIndex < filteredClauses.length - 1 ? currentIndex + 1 : currentIndex;
    const nextClauseId = filteredClauses[currentIndex + 1]?.id || filteredClauses[currentIndex]?.id || null;
    setClauseDrafts((current) => ({ ...current, [clauseId]: enrichedDraft }));
    setError("");
    setWorkspaceAdvancing(true);
    try {
      const saved = await api<Clause>(`/policies/clauses/${clauseId}`, {
        method: "PATCH",
        body: JSON.stringify(sanitizeClauseMutation(enrichedDraft)),
      });
      setPolicies((current) => applyClauseUpdate(current, saved));
      setClauseDrafts((current) => ({ ...current, [clauseId]: clauseToDraft(saved) }));
      if (nextClauseId) {
        await pause(180);
        setWorkspaceTransition("advance");
        setSelectedClauseId(nextClauseId);
        setWorkspaceClausePage(Math.floor(Math.max(0, nextIndex) / 5) + 1);
      }
      setMessage(`Clause ${clause.clause_ref} verified by ${user?.display_name || "Policy Administrator"}.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not verify clause.");
    } finally {
      setWorkspaceAdvancing(false);
    }
  }

  async function addClause(versionId: string) {
    setError("");
    try {
      const created = await api<Clause>(`/policies/versions/${versionId}/clauses`, {
        method: "POST",
        body: JSON.stringify(emptyDraftToBody()),
      });
      setClauseDrafts((current) => ({ ...current, [created.id]: clauseToDraft(created) }));
      setSelectedClauseId(created.id);
      setMessage(`Added clause ${created.clause_ref}.`);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not add clause.");
    }
  }

  async function deleteClause(clauseId: string) {
    setError("");
    try {
      await api(`/policies/clauses/${clauseId}`, { method: "DELETE" });
      setMessage("Clause deleted.");
      if (selectedClauseId === clauseId) setSelectedClauseId(null);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not delete clause.");
    }
  }

  async function simulate(policyId: string, versionId: string) {
    setError("");
    try {
      const result = await api<{ changed_action_count: number; evaluations_examined: number; affected_precedents: unknown[] }>(`/policies/versions/${versionId}/simulate`, {
        method: "POST",
      });
      setMessage(`Simulation examined ${result.evaluations_examined} retained decisions and found ${result.changed_action_count} possible change(s).`);
      await load();
      openWorkspace(policyId, versionId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Simulation failed safely.");
    }
  }

  async function activate(policyId: string, versionId: string) {
    setError("");
    try {
      const result = await api<{ invalidated_precedents: number }>(`/policies/versions/${versionId}/activate`, {
        method: "POST",
      });
      setMessage(`Policy activated. ${result.invalidated_precedents} ACE precedent(s) were invalidated.`);
      await load();
      openWorkspace(policyId, versionId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Activation failed safely.");
    }
  }

  async function splitClause(clauseId: string) {
    const split = splitDrafts[clauseId];
    if (!split) return;
    const [left, right] = split;
    if (!left.trim() || !right.trim()) {
      setError("Both split parts must contain text.");
      return;
    }
    const current = findClause(clauseId);
    if (!current) return;
    setError("");
    try {
      await api(`/policies/clauses/${clauseId}/split`, {
        method: "POST",
        body: JSON.stringify({
          parts: [
            { ...draftToBody(clauseToDraft({ ...current, text: left })), clause_ref: `${current.clause_ref}a`, text: left },
            { ...draftToBody(clauseToDraft({ ...current, text: right })), clause_ref: `${current.clause_ref}b`, text: right },
          ],
        }),
      });
      setShowSplitTools(false);
      setMessage("Clause split into two verified parts.");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not split clause.");
    }
  }

  async function mergeSelected(version: Version) {
    const selected = version.clauses.filter((clause) => selectedClauseIds.includes(clause.id));
    const ids = selected.map((clause) => clause.id);
    if (ids.length < 2) {
      setError("Select at least two clauses to merge.");
      return;
    }
    const first = selected[0];
    const mergedText = ids.map((id) => splitDrafts[id]?.[0] || findClause(id)?.text || "").join("\n\n");
    try {
      await api("/policies/clauses/merge", {
        method: "POST",
        body: JSON.stringify({
          clause_ids: ids,
          merged: {
            ...draftToBody(clauseToDraft(first)),
            clause_ref: `${first.clause_ref}-merged`,
            text: mergedText,
          },
        }),
      });
      setMessage("Clauses merged.");
      setSelectedClauseIds([]);
      setShowBulkTools(false);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not merge clauses.");
    }
  }

  async function downloadSource(versionId: string) {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1"}/policies/versions/${versionId}/source`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.detail === "string" ? body.detail : "Could not download source.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] || "policy-source";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function findClause(clauseId: string) {
    for (const policy of policies) {
      for (const version of policy.versions) {
        for (const clause of version.clauses) {
          if (clause.id === clauseId) return clause;
        }
      }
    }
    return null;
  }

  function renderInventory() {
    const selectedPolicy = inventoryPolicy;
    const selectedActive = inventoryActiveVersion;
    const selectedCandidate = inventoryCandidateVersion;
    const selectedVersion = selectedCandidate || selectedActive || latestVersionByDate(selectedPolicy);
    const selectedSummary = selectedVersion?.verification_summary || {};
    const verified = Number(selectedSummary.verified || 0);
    const total = Number(selectedSummary.total || 0);
    const unresolvedConflicts = Number((selectedVersion?.extraction_metadata as Record<string, unknown> | undefined)?.unresolved_conflicts || 0);
    const simulationPassed = selectedVersion?.status === "SIMULATION" || selectedVersion?.status === "ACTIVE";
    const departmentCoverage = selectedVersion ? new Set(selectedVersion.clauses.filter((clause) => clause.verification_status !== "DELETED").map((clause) => clause.department)).size : 0;
    const canActivateVersion = Boolean(
      canEdit &&
      selectedCandidate &&
      selectedCandidate.status !== "ACTIVE" &&
      selectedCandidate.verification_summary?.ready_for_activation &&
      simulationPassed &&
      unresolvedConflicts === 0,
    );

    return (
      <div className="page page-fit page-fit-inventory policy-memory-reference" data-policy-inventory>
        <div className={`policy-memory-shell${inventoryInspectorOpen && selectedPolicy ? " policy-memory-shell-open" : ""}`}>
          <section className="policy-memory-main">
            <header className="policy-memory-header">
              <div>
                <div className="eyebrow">
                  <BookOpenCheck size={14} aria-hidden="true" />
                  Policy memory
                </div>
                <h1>Policy memory</h1>
                <p>{inventorySummary.activeCount} active families · {inventorySummary.readyToActivate} verified drafts</p>
              </div>
              <div className="policy-memory-header-actions">
                <span className="policy-memory-chip">
                  <MapPin size={14} aria-hidden="true" />
                  {lookups?.storage_adapters.find((item) => item.value === "LOCAL_DEMO")?.label || "Local demo"}
                </span>
                {canEdit && (
                  <button className="button button-primary policy-memory-upload-button" onClick={() => openImport()}>
                    <Upload size={15} aria-hidden="true" />
                    Upload policy
                  </button>
                )}
              </div>
            </header>

            <section className="card card-pad policy-memory-metrics">
              {[
                ["Active", inventorySummary.activeCount, "success"],
                ["Ready", inventorySummary.readyToActivate, "warning"],
                ["In review", inventorySummary.draftsNeedingReview, "info"],
                ["Failed", inventorySummary.failedImports, "danger"],
              ].map(([label, value, tone]) => (
                <article key={label} className="policy-memory-metric">
                  <span className={`policy-memory-metric-dot ${tone}` as string} />
                  <span className="policy-memory-metric-label">{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </section>

            <section className="policy-memory-toolbar">
              <div className="inventory-search-input policy-memory-search">
                <Search size={16} aria-hidden="true" />
                <input
                  value={policySearch}
                  onChange={(event) => setPolicySearch(event.target.value)}
                  placeholder="Search policies"
                  aria-label="Search policies"
                />
              </div>
              <select value={policyStatusFilter} onChange={(event) => setPolicyStatusFilter(event.target.value)} aria-label="Filter by status">
                <option value="ALL">Status</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="HUMAN_REVIEW">HUMAN_REVIEW</option>
                <option value="SIMULATION">SIMULATION</option>
                <option value="RETIRED">RETIRED</option>
              </select>
              <select value={policyScopeFilter} onChange={(event) => setPolicyScopeFilter(event.target.value)} aria-label="Filter by scope">
                <option value="ALL">Scope</option>
                <option value="ORGANISATION">Organisation</option>
              </select>
              <select aria-label="Filter by owner" value={policyOwnerFilter} onChange={(event) => setPolicyOwnerFilter(event.target.value)}>
                <option value="ALL">Owner</option>
                {[...new Set(policies.map((policy) => policy.owner))].map((owner) => <option key={owner} value={owner}>{owner}</option>)}
              </select>
              <button
                className="button button-secondary inventory-icon-action"
                onClick={() => {
                  setPolicySearch("");
                  setPolicyStatusFilter("ALL");
                  setPolicyScopeFilter("ALL");
                  setPolicyOwnerFilter("ALL");
                }}
                aria-label="Reset inventory filters"
              >
                <Filter size={15} aria-hidden="true" />
              </button>
            </section>

            <section className="card policy-memory-table-shell">
              {!totalPolicies ? (
                <div className="inventory-empty">
                  <FileStack size={28} aria-hidden="true" />
                  <h3>No policies match the current filters</h3>
                  <p>Clear filters or upload a new policy file to begin local extraction and clause verification.</p>
                </div>
              ) : (
                <>
                  <div className="policy-memory-table-wrap">
                    <div className="policy-memory-table-canvas">
                      <table className="policy-memory-table">
                        <thead>
                          <tr>
                            <th>Policy</th>
                            <th>Active</th>
                            <th>Candidate</th>
                            <th>Scope</th>
                            <th>Verification</th>
                            <th>Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedPolicies.map((policy) => {
                            const active = activeVersionForPolicy(policy);
                            const candidate = readyCandidateForPolicy(policy);
                            const candidateSummary = candidate?.verification_summary || {};
                            const candidateVerified = Number(candidateSummary.verified || 0);
                            const candidateTotal = Number(candidateSummary.total || 0);
                            const isSelected = inventoryInspectorOpen && activePolicyId === policy.id;

                            return (
                              <tr
                                key={policy.id}
                                className={isSelected ? "selected" : ""}
                                onClick={() => {
                                  setActivePolicyId(policy.id);
                                  setActiveVersionId(candidate?.id || active?.id || null);
                                  setInventoryInspectorOpen(true);
                                }}
                                tabIndex={0}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setActivePolicyId(policy.id);
                                    setActiveVersionId(candidate?.id || active?.id || null);
                                    setInventoryInspectorOpen(true);
                                  }
                                }}
                              >
                                <td>
                                  <div className="policy-memory-policy-cell">
                                    <span className="policy-memory-folder">
                                      <FileStack size={16} aria-hidden="true" />
                                    </span>
                                    <div className="policy-memory-cell-stack">
                                      <strong className="policy-memory-policy-name">{policy.name}</strong>
                                      <span className="hash">{policy.category}</span>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <div className="policy-memory-cell-stack">
                                    <strong className="policy-memory-cell-title">
                                      <ShieldCheck size={13} aria-hidden="true" />
                                      <span className="policy-memory-cell-text">{active?.version || "-"}</span>
                                    </strong>
                                    {active ? <StatusPill value="ACTIVE" /> : <span className="hash">No active version</span>}
                                  </div>
                                </td>
                                <td>
                                  <div className="policy-memory-cell-stack">
                                    <strong className="policy-memory-cell-title">
                                      <Sparkles size={13} aria-hidden="true" />
                                      <span className="policy-memory-cell-text">{candidate?.version || "-"}</span>
                                    </strong>
                                    {candidate ? <StatusPill value={candidate.status === "ACTIVE" ? "READY" : candidate.status} /> : <span className="hash">No candidate</span>}
                                  </div>
                                </td>
                                <td>
                                  <span className="policy-memory-cell-inline">
                                    <MapPin size={13} aria-hidden="true" />
                                    {policy.scope === "ORGANISATION" ? "Organisation" : policy.scope}
                                  </span>
                                </td>
                                <td>
                                  <div className="policy-memory-verification">
                                    <span className="policy-memory-cell-inline">
                                      <FileCheck2 size={13} aria-hidden="true" />
                                      {candidate ? `${candidateVerified}/${candidateTotal}` : "0/0"}
                                    </span>
                                    <div className="policy-memory-progress">
                                      <span style={{ width: `${candidate && candidateTotal ? (candidateVerified / candidateTotal) * 100 : 0}%` }} />
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <span className="policy-memory-cell-inline policy-memory-cell-date">
                                    <CalendarDays size={13} aria-hidden="true" />
                                    {(candidate || active) ? new Date((candidate || active)!.effective_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "-"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <footer className={`inventory-pagination${totalPages === 1 ? " inventory-pagination-single" : ""}`} aria-label="Policy inventory pagination">
                    <div className="inventory-pagination-meta">
                      <span>{pageStart}-{pageEnd} of {totalPolicies}</span>
                    </div>
                    {totalPages > 1 && (
                      <div className="inventory-pagination-actions">
                        <button type="button" className="button button-secondary" onClick={() => setPolicyPage((current) => Math.max(1, current - 1))} disabled={currentPolicyPage === 1}>
                          <ChevronsLeft size={15} aria-hidden="true" />
                        </button>
                        <div className="inventory-page-number-list" role="list" aria-label="Page numbers">
                          {policyPageNumbers.map((pageNumber) => (
                            <button
                              key={pageNumber}
                              type="button"
                              className={`inventory-page-number${pageNumber === currentPolicyPage ? " active" : ""}`}
                              onClick={() => setPolicyPage(pageNumber)}
                              aria-current={pageNumber === currentPolicyPage ? "page" : undefined}
                            >
                              {pageNumber}
                            </button>
                          ))}
                        </div>
                        <button type="button" className="button button-secondary" onClick={() => setPolicyPage((current) => Math.min(totalPages, current + 1))} disabled={currentPolicyPage === totalPages}>
                          <ChevronsRight size={15} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </footer>
                </>
              )}
            </section>
          </section>

          {selectedPolicy && (
            <aside className={`policy-memory-inspector${inventoryInspectorOpen ? " open" : ""}`}>
              <div className="policy-memory-inspector-scroll">
                <div className="policy-memory-inspector-head">
                  <div>
                    <h2>{selectedPolicy.name}</h2>
                    <p>{selectedPolicy.category}</p>
                  </div>
                  <button className="icon-button" onClick={() => setInventoryInspectorOpen(false)} aria-label="Close policy inspector">
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>

                <div className="policy-memory-inspector-meta">
                  <span><Building2 size={14} aria-hidden="true" /> {selectedPolicy.owner}</span>
                  <span><MapPin size={14} aria-hidden="true" /> {selectedPolicy.scope === "ORGANISATION" ? "Organisation" : selectedPolicy.scope}</span>
                  <span><CalendarDays size={14} aria-hidden="true" /> {selectedVersion ? new Date(selectedVersion.effective_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "-"}</span>
                </div>

                <div className="policy-memory-lineage">
                  {selectedActive && (
                    <div className="policy-memory-lineage-card">
                      <strong><ShieldCheck size={14} aria-hidden="true" /> {selectedActive.version}</strong>
                      <span>Active</span>
                    </div>
                  )}
                  {selectedCandidate && (
                    <div className="policy-memory-lineage-card candidate">
                      <strong><Sparkles size={14} aria-hidden="true" /> {selectedCandidate.version}</strong>
                      <span>Candidate</span>
                    </div>
                  )}
                </div>

                <div className="policy-memory-inspector-grid">
                  <article className="policy-memory-inspector-stat">
                    <div className="policy-memory-inspector-stat-icon">
                      <FileCheck2 size={16} aria-hidden="true" />
                    </div>
                    <strong>{verified}/{total}</strong>
                    <span>Clauses</span>
                  </article>
                  <article className="policy-memory-inspector-stat">
                    <div className="policy-memory-inspector-stat-icon warning">
                      <CircleAlert size={16} aria-hidden="true" />
                    </div>
                    <strong>{unresolvedConflicts}</strong>
                    <span>Conflicts</span>
                  </article>
                  <article className="policy-memory-inspector-stat">
                    <div className="policy-memory-inspector-stat-icon info">
                      <Users2 size={16} aria-hidden="true" />
                    </div>
                    <strong>{departmentCoverage}</strong>
                    <span>Departments</span>
                  </article>
                  <article className="policy-memory-inspector-stat">
                    <div className="policy-memory-inspector-stat-icon success">
                      <ShieldEllipsis size={16} aria-hidden="true" />
                    </div>
                    <strong>{simulationPassed ? "PASS" : "PENDING"}</strong>
                    <span>Simulation</span>
                  </article>
                </div>

                <div className="policy-memory-lifecycle">
                  {["Uploaded", "Extracted", "Verified", "Simulated", "Ready"].map((step, index) => {
                    const complete =
                      step === "Uploaded" ||
                      step === "Extracted" ||
                      (step === "Verified" && Boolean(selectedVersion?.verification_summary?.ready_for_activation)) ||
                      (step === "Simulated" && simulationPassed) ||
                      (step === "Ready" && canActivateVersion);
                    return (
                      <div key={step} className={`policy-memory-lifecycle-step${complete ? " complete" : ""}`}>
                        <span>{index + 1}</span>
                        <small>{step}</small>
                      </div>
                    );
                  })}
                </div>

                <div className="policy-memory-source">
                  <div className="policy-memory-source-file">
                    <FileStack size={16} aria-hidden="true" />
                    <span>{selectedVersion?.source_filename || "Source unavailable"}</span>
                  </div>
                  {selectedVersion && (
                    <button className="policy-memory-link" onClick={() => void downloadSource(selectedVersion.id)}>
                      View source
                      <ExternalLink size={14} aria-hidden="true" />
                    </button>
                  )}
                </div>

                <div className={`policy-memory-activation-state${canActivateVersion ? " safe" : ""}`}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{canActivateVersion ? "Safe to activate" : "Needs verified clauses, simulation, zero conflicts."}</span>
                </div>

                <div className="policy-memory-inspector-actions">
                  {selectedCandidate && selectedCandidate.status !== "ACTIVE" && (
                    <button
                      className={`button ${canActivateVersion ? "button-primary policy-memory-action-activate" : "button-secondary policy-memory-action-disabled"}`}
                      disabled={!canActivateVersion}
                      onClick={() => activate(selectedPolicy.id, selectedCandidate.id)}
                    >
                      {canActivateVersion ? <ShieldCheck size={15} aria-hidden="true" /> : <ShieldX size={15} aria-hidden="true" />}
                      {canActivateVersion ? "Activate" : "Blocked"}
                    </button>
                  )}
                  <button className="button button-secondary policy-memory-action-review" onClick={() => selectedCandidate && openWorkspace(selectedPolicy.id, selectedCandidate.id)} disabled={!selectedCandidate}>
                    <ChevronRight size={15} aria-hidden="true" />
                    Review
                  </button>
                  <button className="button button-secondary policy-memory-action-upload" onClick={() => openImport(selectedPolicy.id)} disabled={!canEdit}>
                    <Upload size={15} aria-hidden="true" />
                    Upload
                  </button>
                  {selectedCandidate && selectedCandidate.status !== "SIMULATION" && selectedCandidate.status !== "ACTIVE" && (
                    <button className="button button-secondary policy-memory-simulate-button policy-memory-action-simulate" onClick={() => simulate(selectedPolicy.id, selectedCandidate.id)} disabled={!canEdit}>
                      <Play size={15} aria-hidden="true" />
                      Simulate
                    </button>
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    );
  }
  function renderImport() {
    const selectedExistingPolicy = policies.find((item) => item.id === policyIdOverride) || null;
    const matchedVersionPolicy = findPolicyBySearch(policies, importSearch);
    const effectiveVersionPolicy = selectedExistingPolicy || matchedVersionPolicy;
    const canAdvanceFromFile = Boolean(selectedFile && !fileValidationError);
    const canAdvanceFromDetails = Boolean(
      policyName.trim() &&
      policyVersion.trim() &&
      policyCategory.trim() &&
      policyOwner.trim() &&
      policyScope.trim() &&
      (importKind === "new" || policyIdOverride.trim()),
    );
    const verifyItems = [
      { label: "Type", value: selectedFile ? selectedFile.name.split(".").pop()?.toUpperCase() || "Unknown" : "Awaiting file", icon: FileCheck2 },
      { label: "Digest", value: fileDigest ? `${fileDigest.slice(0, 12)}...` : "Pending", icon: ShieldCheck },
      { label: "Version", value: policyVersion || "Pending", icon: Sparkles },
      { label: "Storage", value: "Private backend", icon: Building2 },
    ];

    return (
      <div className="policy-upload-backdrop" aria-hidden={false}>
        <div className="policy-upload-modal card" ref={importModalRef} role="dialog" aria-modal="true" aria-labelledby="policy-upload-title" data-policy-import>
          <div className="policy-upload-head">
            <div className="policy-upload-title">
              <div className="policy-upload-title-icon">
                <Upload size={20} aria-hidden="true" />
              </div>
              <div>
                <h2 id="policy-upload-title">Upload policy</h2>
                <p>Private ingestion</p>
              </div>
            </div>
            <button type="button" className="icon-button" onClick={closeImport} aria-label="Close upload policy modal">
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="policy-upload-steps" aria-label="Upload stages">
            {["File", "Details", "Verify"].map((stepLabel, index) => {
              const stepNumber = index + 1;
              const active = importStep === stepNumber;
              const complete = importStep > stepNumber || (stepNumber === 1 && canAdvanceFromFile) || (stepNumber === 2 && canAdvanceFromDetails && importStep === 3);
              return (
                <div key={stepLabel} className={`policy-upload-step${active ? " active" : ""}${complete ? " complete" : ""}`}>
                  <span>{stepNumber}</span>
                  <strong>{stepLabel}</strong>
                </div>
              );
            })}
          </div>

          <form className="policy-upload-form" onSubmit={uploadPolicy}>
            <div className="policy-upload-body">
              <div className="policy-upload-kind-toggle" role="tablist" aria-label="Upload type">
                <button type="button" className={`policy-upload-kind${importKind === "new" ? " active" : ""}`} onClick={() => { setImportKind("new"); setPolicyIdOverride(""); setImportSearch(""); }}>
                  <FileStack size={16} aria-hidden="true" />
                  New policy
                </button>
                <button type="button" className={`policy-upload-kind${importKind === "version" ? " active" : ""}`} onClick={() => setImportKind("version")}>
                  <RefreshCw size={16} aria-hidden="true" />
                  New version
                </button>
              </div>

              {importStep === 1 && (
                <section className="policy-upload-stage">
                  <div
                    className={`policy-upload-dropzone${dropActive ? " active" : ""}${selectedFile ? " has-file" : ""}`}
                    onClick={() => fileRef.current?.click()}
                    onDragEnter={() => setDropActive(true)}
                    onDragLeave={() => setDropActive(false)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropActive(true);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDropActive(false);
                      const file = event.dataTransfer.files?.[0];
                      if (file) setSelectedFile(file);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        fileRef.current?.click();
                      }
                    }}
                  >
                    <div className="policy-upload-dropcopy">
                      <strong>Drop policy file</strong>
                      <span>PDF, DOCX or TXT · Max 25 MB</span>
                    </div>
                    <button type="button" className="button button-secondary policy-upload-browse">
                      <FileStack size={15} aria-hidden="true" />
                      Browse
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                      onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                    />
                  </div>

                  <div className="policy-upload-filecard">
                    <div className="policy-upload-filemeta">
                      <div className="policy-upload-fileicon">
                        <FileStack size={18} aria-hidden="true" />
                      </div>
                      <div>
                        <strong>{selectedFile?.name || "No file selected"}</strong>
                        <span>{selectedFile ? `${formatFileSize(selectedFile.size)} · ${selectedFile.type || "Local file"}` : "Choose a policy source to validate its signature and digest locally."}</span>
                      </div>
                    </div>
                    <div className="policy-upload-fileactions">
                      {fileValidation && !fileValidationError && <span className="policy-upload-valid"><CheckCircle2 size={16} aria-hidden="true" /> {fileValidation}</span>}
                      {selectedFile && (
                        <>
                          <button type="button" className="icon-button" onClick={() => fileRef.current?.click()} aria-label="Replace file">
                            <RefreshCw size={16} aria-hidden="true" />
                          </button>
                          <button type="button" className="icon-button" onClick={() => { setSelectedFile(null); if (fileRef.current) fileRef.current.value = ""; }} aria-label="Remove file">
                            <Trash size={16} aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="policy-upload-inline-notes">
                    <div className={`notice${fileValidationError ? " notice-error" : fileValidation ? " notice-success" : ""}`}>
                      {fileValidationError ? <CircleAlert size={16} aria-hidden="true" /> : fileValidation ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />}
                      {fileValidationError || fileValidation || "Files are validated locally before private backend storage."}
                    </div>
                  </div>
                </section>
              )}

              {importStep === 2 && (
                <section className="policy-upload-stage">
                  {importKind === "version" && (
                    <div className="field">
                      <label>Existing policy</label>
                      <div className="policy-upload-search-select">
                        <Search size={16} aria-hidden="true" />
                        <input value={importSearch} onChange={(event) => setImportSearch(event.target.value)} placeholder="Search existing policy families" list="policy-family-options" />
                        <ChevronDown size={16} aria-hidden="true" />
                      </div>
                      <datalist id="policy-family-options">
                        {policies.map((policy) => <option key={policy.id} value={`${policy.name} (${policy.category})`} />)}
                      </datalist>
                    </div>
                  )}

                  <div className="field-row">
                    <div className="field">
                      <label>Policy name</label>
                      <input value={policyName} onChange={(event) => setPolicyName(event.target.value)} />
                    </div>
                    <div className="field">
                      <label>Version</label>
                      <input value={policyVersion} onChange={(event) => setPolicyVersion(event.target.value)} />
                    </div>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Category</label>
                      <input value={policyCategory} onChange={(event) => setPolicyCategory(event.target.value)} />
                    </div>
                    <div className="field">
                      <label>Scope</label>
                      <input value={policyScope} onChange={(event) => setPolicyScope(event.target.value)} />
                    </div>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Owner</label>
                      <input value={policyOwner} onChange={(event) => setPolicyOwner(event.target.value)} />
                    </div>
                    <div className="field">
                      <label>Effective date</label>
                      <input value="22 Jul 2026" readOnly />
                    </div>
                  </div>
                  <div className="field">
                    <label>Description</label>
                    <textarea value={policyDescription} onChange={(event) => setPolicyDescription(event.target.value)} />
                  </div>
                </section>
              )}

              {importStep === 3 && (
                <section className="policy-upload-stage">
                  <div className="policy-upload-verify-grid">
                    {verifyItems.map(({ label, value, icon: Icon }) => (
                      <article key={label} className="policy-upload-verify-card">
                        <Icon size={16} aria-hidden="true" />
                        <strong>{value}</strong>
                        <span>{label}</span>
                      </article>
                    ))}
                  </div>

                  <div className="policy-upload-summary">
                    <span><ShieldCheck size={16} aria-hidden="true" /> Stored privately</span>
                    <span><FileCheck2 size={16} aria-hidden="true" /> Signature checked</span>
                    <span><Users2 size={16} aria-hidden="true" /> Policy admin required</span>
                    <span><Sparkles size={16} aria-hidden="true" /> No external AI</span>
                  </div>

                  {(uploadProgress > 0 || uploadState || uploadResult || error) && (
                    <div className="policy-upload-progress">
                      <div className="policy-upload-progress-head">
                        <strong>{uploadState || "Ready for extraction"}</strong>
                        <span>{uploadProgress ? `${uploadProgress}%` : uploadResult ? "Complete" : "Pending"}</span>
                      </div>
                      <div className="bar-track" aria-hidden="true">
                        <div className="bar-fill" style={{ width: `${uploadProgress}%` }} />
                      </div>
                      {uploadResult ? (
                        <div className="notice notice-success">
                          <CheckCircle2 size={16} aria-hidden="true" />
                          Upload and extraction completed. Clauses are waiting for human verification.
                        </div>
                      ) : error ? (
                        <div className="notice notice-error">
                          <AlertCircle size={16} aria-hidden="true" />
                          {error}
                        </div>
                      ) : null}
                    </div>
                  )}
                </section>
              )}
            </div>

            <div className="policy-upload-footer">
              <div className="policy-upload-permission">
                <Users2 size={16} aria-hidden="true" />
                {canEdit ? "Policy admin required" : "This role is not authorised for upload"}
              </div>
              <div className="button-row">
                {importStep > 1 && !uploadResult && (
                  <button type="button" className="button button-secondary" onClick={() => setImportStep((current) => Math.max(1, current - 1))}>
                    Back
                  </button>
                )}
                <button type="button" className="button button-secondary" onClick={closeImport}>
                  Cancel
                </button>
                {uploadResult ? (
                  <>
                    <button type="button" className="button button-secondary" onClick={() => openImport(policyIdOverride)}>
                      Upload another
                    </button>
                    <button type="button" className="button button-primary" onClick={() => { closeImport(); openWorkspace(uploadResult.policy_id, uploadResult.version_id); }}>
                      Review clauses
                    </button>
                  </>
                ) : importStep < 3 ? (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setImportStep((current) => current + 1)}
                    disabled={(importStep === 1 && !canAdvanceFromFile) || (importStep === 2 && !canAdvanceFromDetails)}
                  >
                    Next
                  </button>
                ) : (
                  <button className="button button-primary" disabled={!canEdit || !selectedFile || !!fileValidationError || (uploadProgress > 0 && uploadProgress < 100)}>
                    {uploadState && uploadProgress > 0 && uploadProgress < 100 ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
                    Upload & extract
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  }

  function renderClauseEditor(clause: Clause, draft: Draft) {
    return (
      <section className="card card-pad stack-16" data-clause-editor>
        <div className="workspace-toolbar">
          <div>
            <strong>Clause editor</strong>
            <div className="small-meta">Only one clause editor is mounted at a time.</div>
          </div>
          <div className="header-actions">
            <StatusPill value={clause.verification_status} />
            <span className="reason-code">§{clause.clause_ref}</span>
          </div>
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Clause reference</label>
            <input value={draft.clause_ref} onChange={(event) => updateClauseDraft(clause.id, "clause_ref", event.target.value, setClauseDrafts)} />
          </div>
          <div className="field">
            <label>Page number</label>
            <input value={draft.page_number} onChange={(event) => updateClauseDraft(clause.id, "page_number", event.target.value, setClauseDrafts)} />
          </div>
        </div>

        <div className="field">
          <label>Clause text</label>
          <textarea value={draft.text} onChange={(event) => updateClauseDraft(clause.id, "text", event.target.value, setClauseDrafts)} />
        </div>

        <div className="inspector-grid">
          <div className="field">
            <label>Department</label>
            <input value={draft.department} onChange={(event) => updateClauseDraft(clause.id, "department", event.target.value, setClauseDrafts)} list="policy-lookups-departments" />
          </div>
          <div className="field">
            <label>Action</label>
            <input value={draft.action} onChange={(event) => updateClauseDraft(clause.id, "action", event.target.value as Draft["action"], setClauseDrafts)} list="policy-lookups-actions" />
          </div>
          <div className="field">
            <label>Roles</label>
            <input value={draft.roles} onChange={(event) => updateClauseDraft(clause.id, "roles", event.target.value, setClauseDrafts)} list="policy-lookups-roles" />
          </div>
          <div className="field">
            <label>Purposes</label>
            <input value={draft.purposes} onChange={(event) => updateClauseDraft(clause.id, "purposes", event.target.value, setClauseDrafts)} list="policy-lookups-purposes" />
          </div>
          <div className="field">
            <label>Data classes</label>
            <input value={draft.data_classes} onChange={(event) => updateClauseDraft(clause.id, "data_classes", event.target.value, setClauseDrafts)} list="policy-lookups-data-classes" />
          </div>
          <div className="field">
            <label>Destinations</label>
            <input value={draft.destinations} onChange={(event) => updateClauseDraft(clause.id, "destinations", event.target.value, setClauseDrafts)} list="policy-lookups-destinations" />
          </div>
          <div className="field">
            <label>Heading</label>
            <input value={draft.heading} onChange={(event) => updateClauseDraft(clause.id, "heading", event.target.value, setClauseDrafts)} />
          </div>
          <div className="field">
            <label>Verification status</label>
            <input value={draft.verification_status} onChange={(event) => updateClauseDraft(clause.id, "verification_status", event.target.value, setClauseDrafts)} />
          </div>
        </div>

        <div className="field">
          <label>Human notes</label>
          <textarea value={draft.human_notes} onChange={(event) => updateClauseDraft(clause.id, "human_notes", event.target.value, setClauseDrafts)} />
        </div>

        <div className="toolbar">
          <div className="button-row">
            <button type="button" className="button button-primary" onClick={() => saveClause(clause.id)} disabled={!canEdit}>
              <Save size={15} aria-hidden="true" />
              Save clause
            </button>
            <button type="button" className="button button-secondary" onClick={() => deleteClause(clause.id)} disabled={!canEdit}>
              <Trash2 size={15} aria-hidden="true" />
              Delete clause
            </button>
          </div>
          <div className="button-row">
            {!showSplitTools ? (
              <button type="button" className="button button-secondary" onClick={() => setShowSplitTools(true)} disabled={!canEdit}>
                <Scissors size={15} aria-hidden="true" />
                Open split tool
              </button>
            ) : (
              <button type="button" className="button button-secondary" onClick={() => setShowSplitTools(false)}>
                <X size={15} aria-hidden="true" />
                Hide split tool
              </button>
            )}
          </div>
        </div>

        {showSplitTools && (
          <div className="card card-pad stack-16">
            <div className="section-title">
              <h3>Split clause</h3>
              <span className="reason-code">Explicit tool</span>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Split part 1</label>
                <textarea value={splitDrafts[clause.id]?.[0] || ""} onChange={(event) => setSplitDrafts((current) => ({ ...current, [clause.id]: [event.target.value, current[clause.id]?.[1] || ""] }))} />
              </div>
              <div className="field">
                <label>Split part 2</label>
                <textarea value={splitDrafts[clause.id]?.[1] || ""} onChange={(event) => setSplitDrafts((current) => ({ ...current, [clause.id]: [current[clause.id]?.[0] || "", event.target.value] }))} />
              </div>
            </div>
            <div className="button-row">
              <button type="button" className="button button-secondary" onClick={() => splitClause(clause.id)} disabled={!canEdit}>
                <Scissors size={15} aria-hidden="true" />
                Apply split
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  function renderInspector(version: Version, clause: Clause) {
    return (
      <section className="card card-pad stack-16">
        <div className="workspace-toolbar">
          <div>
            <strong>Source preview</strong>
            <div className="small-meta">Page, heading, and extraction metadata stay visible while editing.</div>
          </div>
          <button type="button" className="button button-secondary" onClick={() => downloadSource(version.id)}>
            <Download size={15} aria-hidden="true" />
            Source
          </button>
        </div>

        <div className="list">
          <div className="list-item">
            <div className="list-item-top">
              <strong>{version.source_filename || "Uploaded source"}</strong>
              <span className="reason-code">p.{clause.page_number}</span>
            </div>
            <p>{clause.heading || "No heading available"} · {version.storage_adapter}</p>
          </div>
          <div className="list-item">
            <strong>Clause excerpt</strong>
            <p>{clause.text}</p>
          </div>
          <div className="list-item">
            <strong>AI suggestion metadata</strong>
            <span className="hash">{JSON.stringify(clause.suggested_metadata || {}, null, 2)}</span>
          </div>
          <div className="list-item">
            <strong>Version evidence</strong>
            <span className="hash">{JSON.stringify(version.extraction_metadata || {}, null, 2)}</span>
          </div>
        </div>
      </section>
    );
  }

  function renderWorkspace() {
    const isMobile = viewportWidth < 768;
    const showInspectorInline = viewportWidth < 1280;

    if (!activePolicy || !activeVersion) {
      return (
        <div className="page stack-24" data-policy-workspace>
          <header className="page-header">
            <div>
              <div className="eyebrow">
                <BookOpenCheck size={14} aria-hidden="true" />
                Policy workspace
              </div>
              <h1>Workspace unavailable</h1>
              <p>Return to inventory to choose a policy family or upload a new version.</p>
            </div>
            <div className="header-actions">
              <button className="button button-secondary" onClick={() => setMode("inventory")}>
                <ArrowLeft size={15} aria-hidden="true" />
                Back to inventory
              </button>
            </div>
          </header>
        </div>
      );
    }

    return (
      <div className="page stack-24" data-policy-workspace>
        <header className="page-header">
          <div>
            <div className="eyebrow">
              <BookOpenCheck size={14} aria-hidden="true" />
              Policy workspace
            </div>
            <h1>{activePolicy.name}</h1>
            <p>{activePolicy.description || "Review one clause at a time, verify it explicitly, and move to simulation or activation only when the version is ready."}</p>
          </div>
          <div className="header-actions">
            <button className="button button-secondary" onClick={() => setMode("inventory")}>
              <ArrowLeft size={15} aria-hidden="true" />
              Inventory
            </button>
            {canEdit && (
              <button className="button button-secondary" onClick={() => openImport(activePolicy.id)}>
                <Upload size={15} aria-hidden="true" />
                New version
              </button>
            )}
          </div>
        </header>

        <section className="workspace-toolbar">
          <div>
            <strong>{activeVersion.version}</strong>
            <div className="small-meta">{activePolicy.owner} · {activePolicy.scope}</div>
          </div>
          <div className="header-actions">
            <StatusPill value={activeVersion.status} />
            <span className="reason-code">{Number(activeVersion.verification_summary?.verified || 0)}/{Number(activeVersion.verification_summary?.total || 0)} verified</span>
            <select value={activeVersion.id} onChange={(event) => setActiveVersionId(event.target.value)}>
              {activePolicy.versions.map((version) => (
                <option key={version.id} value={version.id}>{version.version}</option>
              ))}
            </select>
            <button type="button" className="button button-secondary" onClick={() => addClause(activeVersion.id)} disabled={!canEdit}>
              <Plus size={15} aria-hidden="true" />
              Add clause
            </button>
            <button type="button" className="button button-secondary" onClick={() => simulate(activePolicy.id, activeVersion.id)}>
              <Play size={15} aria-hidden="true" />
              Simulate impact
            </button>
            {activeVersion.status !== "ACTIVE" && (
              <button type="button" className="button button-primary" onClick={() => activate(activePolicy.id, activeVersion.id)}>
                <ShieldCheck size={15} aria-hidden="true" />
                Activate version
              </button>
            )}
          </div>
        </section>

        <section className="policy-workspace-shell">
          {!isMobile || !selectedClause ? (
            <aside className="policy-pane policy-pane-navigator">
              <div className="card card-pad stack-16">
                <div className="section-title">
                  <h3>Clause navigator</h3>
                  <span className="reason-code">{filteredClauses.length} visible</span>
                </div>
                <div className="field">
                  <label>Search clauses</label>
                  <div style={{ position: "relative" }}>
                    <Search size={16} aria-hidden="true" style={{ position: "absolute", left: 12, top: 14, color: "var(--text-tertiary)" }} />
                    <input style={{ paddingLeft: 38 }} value={clauseSearch} onChange={(event) => setClauseSearch(event.target.value)} placeholder="Find by ref, heading, scope or action" />
                  </div>
                </div>
                <div className="field">
                  <label>Verification filter</label>
                  <select value={verificationFilter} onChange={(event) => setVerificationFilter(event.target.value)}>
                    <option value="ALL">All clauses</option>
                    <option value="VERIFIED">VERIFIED</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="DELETED">DELETED</option>
                  </select>
                </div>
                <div className="toolbar">
                  {!showBulkTools ? (
                    <button type="button" className="button button-secondary" onClick={() => setShowBulkTools(true)} disabled={!canEdit}>
                      <ListFilter size={15} aria-hidden="true" />
                      Bulk actions
                    </button>
                  ) : (
                    <>
                      <button type="button" className="button button-secondary" onClick={() => setShowBulkTools(false)}>
                        <X size={15} aria-hidden="true" />
                        Hide bulk tools
                      </button>
                      <button type="button" className="button button-secondary" onClick={() => mergeSelected(activeVersion)} disabled={!canEdit}>
                        <GitMerge size={15} aria-hidden="true" />
                        Merge selected
                      </button>
                    </>
                  )}
                </div>
                <div className="list policy-navigator-list">
                  {filteredClauses.map((clause) => (
                    <button
                      type="button"
                      key={clause.id}
                      className={`navigator-row${selectedClauseId === clause.id ? " active" : ""}`}
                      onClick={() => setSelectedClauseId(clause.id)}
                    >
                      <div className="navigator-row-title">
                        <strong>
                          {showBulkTools && (
                            <input
                              type="checkbox"
                              checked={selectedClauseIds.includes(clause.id)}
                              onChange={(event) => {
                                event.stopPropagation();
                                setSelectedClauseIds((current) => event.target.checked ? [...current, clause.id] : current.filter((id) => id !== clause.id));
                              }}
                              style={{ marginRight: 8 }}
                            />
                          )}
                          §{clause.clause_ref}
                        </strong>
                        <StatusPill value={clause.verification_status} />
                      </div>
                      <p>{clause.heading || "No heading"} · {clause.department} · {clause.action} · p.{clause.page_number}</p>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          ) : null}

          {selectedClause && selectedDraft ? (
            <div className="policy-pane policy-pane-editor">
              {isMobile && (
                <div className="button-row" style={{ marginBottom: 12 }}>
                  <button type="button" className="button button-secondary" onClick={() => setSelectedClauseId(null)}>
                    <ArrowLeft size={15} aria-hidden="true" />
                    Back to clause list
                  </button>
                </div>
              )}
              <div className="policy-editor-scroll">
                {renderClauseEditor(selectedClause, selectedDraft)}
                {showInspectorInline && renderInspector(activeVersion, selectedClause)}
              </div>
            </div>
          ) : (
            <div className="policy-pane policy-pane-editor">
              <div className="card empty">
                <BookOpenCheck size={28} aria-hidden="true" />
                <h3>Select a clause</h3>
                <p>Search or choose a compact clause row to open the only full editor in this workspace.</p>
              </div>
            </div>
          )}

          {!showInspectorInline && selectedClause && (
            <aside className="policy-pane policy-pane-inspector">
              <div className="policy-inspector-scroll">
                {renderInspector(activeVersion, selectedClause)}
              </div>
            </aside>
          )}
        </section>
      </div>
    );
  }

  function renderWorkspaceModal() {
    if (!activePolicy || !activeVersion) return null;

    const nonDeletedClauses = activeVersion.clauses.filter((clause) => clause.verification_status !== "DELETED");
    const verifiedCount = nonDeletedClauses.filter((clause) => clause.verification_status === "VERIFIED").length;
    const draftCount = nonDeletedClauses.filter((clause) => clause.verification_status === "DRAFT").length;
    const issueCount = nonDeletedClauses.filter((clause) => clause.verification_status !== "VERIFIED" && clause.verification_status !== "DRAFT").length;
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(filteredClauses.length / pageSize));
    const currentPage = Math.min(workspaceClausePage, totalPages);
    const pagedClauses = filteredClauses.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const pageStart = filteredClauses.length ? (currentPage - 1) * pageSize + 1 : 0;
    const pageEnd = filteredClauses.length ? Math.min(currentPage * pageSize, filteredClauses.length) : 0;
    const currentClause = selectedClause || pagedClauses[0] || null;
    const currentDraft = currentClause ? clauseDrafts[currentClause.id] || clauseToDraft(currentClause) : null;
    const selectedIndex = currentClause ? filteredClauses.findIndex((clause) => clause.id === currentClause.id) : -1;
    const verificationPercent = nonDeletedClauses.length ? Math.round((verifiedCount / nonDeletedClauses.length) * 100) : 0;
    const mappingComplete = Boolean(currentDraft?.data_classes.trim() && currentDraft?.destinations.trim() && currentDraft?.action && currentDraft?.department.trim());
    const isLastClause = selectedIndex >= 0 && selectedIndex === filteredClauses.length - 1;
    const sourceLinked = Boolean(currentClause?.page_number);
    const unresolvedConflicts = Number((activeVersion.extraction_metadata as Record<string, unknown> | undefined)?.unresolved_conflicts || 0);
    const highlights = extractHighlightTerms(currentClause?.text || "");
    const scopeOptions = ["ALL", ...(lookups?.departments || []).filter((item) => item && item !== "ALL")];

    return (
      <div className="policy-review-backdrop">
        <div className="policy-review-modal card" ref={workspaceModalRef} data-policy-workspace role="dialog" aria-modal="true" aria-labelledby="policy-review-title">
          <div className="policy-review-head">
            <div className="policy-review-title">
              <div className="policy-review-title-icon">
                <BookOpenCheck size={22} aria-hidden="true" />
              </div>
              <div>
                <h2 id="policy-review-title">Review clauses</h2>
                <p>{activePolicy.name} · {activeVersion.version}</p>
              </div>
            </div>
            <div className="policy-review-head-actions">
              <span>{verifiedCount} of {nonDeletedClauses.length} verified</span>
              <div className="policy-review-progress-ring"><strong>{verificationPercent}%</strong></div>
              <button type="button" className="icon-button" onClick={closeWorkspace} aria-label="Close review clauses modal">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="policy-review-status-area">
            <div className="policy-review-statusbar">
              <span className="policy-review-status success"><CheckCircle2 size={15} aria-hidden="true" /> {verifiedCount} Verified</span>
              <span className="policy-review-status warning"><CircleDashed size={15} aria-hidden="true" /> {draftCount} Draft</span>
              <span className="policy-review-status danger"><CircleAlert size={15} aria-hidden="true" /> {issueCount} Issues</span>
              <button type="button" className="policy-review-link" onClick={() => setWorkspaceSourceOpen(true)}>
                <ExternalLink size={15} aria-hidden="true" />
                View source
              </button>
            </div>

            {(error || message) && (
              <div className={`policy-review-inline-notice notice${error ? " notice-error" : " notice-success"}`}>
                {error ? <AlertCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                {error || message}
              </div>
            )}
          </div>

          <div className="policy-review-shell">
            <aside className="policy-review-navigator">
              <div className="policy-review-search">
                <Search size={16} aria-hidden="true" />
                <input value={clauseSearch} onChange={(event) => setClauseSearch(event.target.value)} placeholder="Search clauses" />
              </div>
              <div className="policy-review-filters">
                <button type="button" className={`policy-review-filter${verificationFilter === "ALL" ? " active" : ""}`} onClick={() => setVerificationFilter("ALL")}>All {nonDeletedClauses.length}</button>
                <button type="button" className={`policy-review-filter${verificationFilter === "DRAFT" ? " active" : ""}`} onClick={() => setVerificationFilter("DRAFT")}>Review {draftCount}</button>
                <button type="button" className={`policy-review-filter${verificationFilter === "HUMAN_REVIEW" ? " active" : ""}`} onClick={() => setVerificationFilter("HUMAN_REVIEW")}>Issues {issueCount}</button>
              </div>
              <div className="policy-review-list">
                {pagedClauses.length ? pagedClauses.map((clause) => (
                  <button key={clause.id} type="button" className={`policy-review-row${currentClause?.id === clause.id ? " active" : ""}`} onClick={() => setSelectedClauseId(clause.id)}>
                    <div className="policy-review-row-top">
                      <strong>§{clause.clause_ref} {clause.heading || "Clause"}</strong>
                      <span>Page {clause.page_number}</span>
                    </div>
                    <div className="policy-review-row-meta">
                      <StatusPill value={clause.verification_status} />
                    </div>
                  </button>
                )) : (
                  <div className="card empty">
                    <BookOpenCheck size={20} aria-hidden="true" />
                    <h3>No clauses found</h3>
                    <p>Adjust the search or verification filter.</p>
                  </div>
                )}
              </div>
              <div className="policy-review-pagination">
                <span>{pageStart}-{pageEnd} of {filteredClauses.length}</span>
                <div className="button-row">
                  <button type="button" className="icon-button" onClick={() => setWorkspaceClausePage((current) => Math.max(1, current - 1))} disabled={currentPage === 1}>
                    <ChevronsLeft size={14} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-button" onClick={() => setWorkspaceClausePage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages}>
                    <ChevronsRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </aside>

            <section className="policy-review-workspace">
              {currentClause && currentDraft ? (
                <div key={currentClause.id} className={`policy-review-stage${workspaceTransition === "advance" ? " is-advancing" : ""}`} data-clause-editor>
                  {workspaceAdvancing && (
                    <div className="policy-review-transition-overlay" aria-live="polite" aria-busy="true">
                      <LoaderCircle size={18} aria-hidden="true" className="spin" />
                      <span>Verifying clause and loading next</span>
                    </div>
                  )}
                  <div className="policy-review-workspace-head">
                    <div>
                      <div className="policy-review-clause-title">
                        <h3>§{currentDraft.clause_ref} {currentClause.heading || "Clause review"}</h3>
                        <StatusPill value={currentDraft.verification_status || "DRAFT"} />
                      </div>
                      <p>Page {currentClause.page_number}</p>
                    </div>
                    <div className="policy-review-nav">
                      <button type="button" className="button button-secondary" onClick={() => selectedIndex > 0 && setSelectedClauseId(filteredClauses[selectedIndex - 1].id)} disabled={selectedIndex <= 0}>
                        <ArrowLeft size={15} aria-hidden="true" />
                        Previous
                      </button>
                      <button type="button" className="button button-secondary" onClick={() => selectedIndex >= 0 && selectedIndex < filteredClauses.length - 1 && setSelectedClauseId(filteredClauses[selectedIndex + 1].id)} disabled={selectedIndex >= filteredClauses.length - 1}>
                        Next
                        <ChevronRight size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  <div className="policy-review-excerpt">
                    <Quote size={20} aria-hidden="true" />
                    <p>{highlightSensitiveText(currentClause.text, highlights)}</p>
                    <span><CheckCircle2 size={15} aria-hidden="true" /> 98% match</span>
                  </div>

                  <div className="policy-review-mapping-title">Governance mapping</div>
                  <div className="policy-review-mappings">
                    <label className="policy-review-mapping-card">
                      <div><Database size={18} aria-hidden="true" /> <span>Data class</span></div>
                      <select aria-label="Data class" value={firstListValue(currentDraft.data_classes)} onChange={(event) => updateClauseDraft(currentClause.id, "data_classes", event.target.value, setClauseDrafts)}>
                        <option value="">Select data class</option>
                        {lookups?.data_classes.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className="policy-review-mapping-card">
                      <div><Globe2 size={18} aria-hidden="true" /> <span>Destination</span></div>
                      <select aria-label="Destination" value={firstListValue(currentDraft.destinations)} onChange={(event) => updateClauseDraft(currentClause.id, "destinations", event.target.value, setClauseDrafts)}>
                        <option value="">Select destination</option>
                        {lookups?.destinations.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className="policy-review-mapping-card">
                      <div><ShieldX size={18} aria-hidden="true" /> <span>Control</span></div>
                      <select aria-label="Control" value={currentDraft.action} onChange={(event) => updateClauseDraft(currentClause.id, "action", event.target.value as Draft["action"], setClauseDrafts)}>
                        {lookups?.actions.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                    <label className="policy-review-mapping-card">
                      <div><Building2 size={18} aria-hidden="true" /> <span>Scope</span></div>
                      <select aria-label="Scope" value={currentDraft.department || "ALL"} onChange={(event) => updateClauseDraft(currentClause.id, "department", event.target.value, setClauseDrafts)}>
                        {scopeOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="policy-review-checks">
                    <span className={sourceLinked ? "ok" : "warn"}><CheckCircle2 size={15} aria-hidden="true" /> Source linked</span>
                    <span className={mappingComplete ? "ok" : "warn"}><CheckCircle2 size={15} aria-hidden="true" /> Mapping complete</span>
                    <span className={unresolvedConflicts ? "warn" : "ok"}><CheckCircle2 size={15} aria-hidden="true" /> {unresolvedConflicts ? "Conflicts present" : "No conflicts"}</span>
                  </div>

                  <div className="field">
                    <label>Reviewer note</label>
                    <textarea value={currentDraft.human_notes} onChange={(event) => updateClauseDraft(currentClause.id, "human_notes", event.target.value, setClauseDrafts)} placeholder="Optional reviewer note..." />
                  </div>
                </div>
              ) : (
                <div className="card empty">
                  <BookOpenCheck size={20} aria-hidden="true" />
                  <h3>Select a clause</h3>
                  <p>Choose a clause from the navigator to begin review.</p>
                </div>
              )}
            </section>
          </div>

          <div className="policy-review-footer">
            <div className="policy-review-footer-note">
              <ShieldCheck size={15} aria-hidden="true" />
              Edits reset verification
            </div>
            <div className="button-row">
              <button type="button" className="button button-secondary" onClick={() => currentClause && deleteClause(currentClause.id)} disabled={!currentClause || !canEdit || workspaceAdvancing}>
                <Trash2 size={15} aria-hidden="true" />
                Delete clause
              </button>
              <button type="button" className="button button-secondary" onClick={() => currentClause && saveClause(currentClause.id)} disabled={!currentClause || !canEdit}>
                <Save size={15} aria-hidden="true" />
                Save changes
              </button>
              <button type="button" className="button button-primary" onClick={() => currentClause && verifyClauseAndNext(currentClause.id)} disabled={!currentClause || !canEdit || !mappingComplete || !sourceLinked || workspaceAdvancing}>
                <CheckCircle2 size={15} aria-hidden="true" />
                {workspaceAdvancing ? "Verifying..." : isLastClause ? "Complete verify" : "Verify & next"}
              </button>
            </div>
            <div className="policy-review-footer-lock">Activation locked · {Math.max(0, nonDeletedClauses.length - verifiedCount)} remaining</div>
          </div>

          {workspaceSourceOpen && currentClause && (
            <div className="policy-review-source-panel card">
              <div className="policy-review-source-head">
                <strong>Source reference</strong>
                <button type="button" className="icon-button" onClick={() => setWorkspaceSourceOpen(false)} aria-label="Close source details">
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="policy-review-source-body">
                <div className="list-item">
                  <strong>{activeVersion.source_filename || "Uploaded source"}</strong>
                  <p>Page {currentClause.page_number} · {currentClause.heading || "No heading available"}</p>
                </div>
                <div className="list-item">
                  <strong>Excerpt</strong>
                  <p>{currentClause.text}</p>
                </div>
                <div className="list-item">
                  <strong>Raw extraction</strong>
                  <span className="hash">{JSON.stringify(currentClause.suggested_metadata || {}, null, 2)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Shell hideSidebarCommandCard compactSystemBar>
      <>
        {mode === "inventory" && error && (
          <div className="page" style={{ marginBottom: 16 }}>
            <div className="notice notice-error">
              <AlertCircle size={16} aria-hidden="true" />
              {error}
            </div>
          </div>
        )}
        {loading ? (
          <div className="page page-fit page-fit-inventory policy-memory-reference" data-policy-inventory>
            <div className="policy-memory-shell">
              <section className="policy-memory-main policy-memory-skeleton" aria-label="Loading policy memory">
                <header className="policy-memory-header">
                  <div className="policy-memory-skeleton-copy">
                    <span className="policy-memory-skeleton-line short" />
                    <span className="policy-memory-skeleton-line title" />
                    <span className="policy-memory-skeleton-line medium" />
                  </div>
                  <div className="policy-memory-header-actions">
                    <span className="policy-memory-skeleton-chip" />
                    <span className="policy-memory-skeleton-button" />
                  </div>
                </header>

                <section className="card card-pad policy-memory-metrics">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <article key={index} className="policy-memory-metric policy-memory-skeleton-metric">
                      <span className="policy-memory-skeleton-dot" />
                      <div className="policy-memory-skeleton-copy">
                        <span className="policy-memory-skeleton-line short" />
                        <span className="policy-memory-skeleton-line tiny" />
                      </div>
                    </article>
                  ))}
                </section>

                <section className="policy-memory-toolbar">
                  <div className="policy-memory-skeleton-input" />
                  <div className="policy-memory-skeleton-select" />
                  <div className="policy-memory-skeleton-select" />
                  <div className="policy-memory-skeleton-select" />
                  <div className="policy-memory-skeleton-icon" />
                </section>

                <section className="card policy-memory-table-shell">
                  <div className="policy-memory-skeleton-table">
                    <div className="policy-memory-skeleton-table-head">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <span key={index} className="policy-memory-skeleton-line short" />
                      ))}
                    </div>
                    <div className="policy-memory-skeleton-table-body">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="policy-memory-skeleton-table-row">
                          <span className={`policy-memory-skeleton-line ${index % 2 === 0 ? "medium" : "short"}`} />
                          <span className="policy-memory-skeleton-line short" />
                          <span className="policy-memory-skeleton-line short" />
                          <span className="policy-memory-skeleton-line short" />
                          <span className="policy-memory-skeleton-line short" />
                          <span className="policy-memory-skeleton-line short" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="inventory-pagination policy-memory-skeleton-pagination">
                    <span className="policy-memory-skeleton-line short" />
                    <div className="policy-memory-skeleton-page-group">
                      <span className="policy-memory-skeleton-icon" />
                      <span className="policy-memory-skeleton-icon active" />
                      <span className="policy-memory-skeleton-icon" />
                      <span className="policy-memory-skeleton-icon" />
                    </div>
                  </div>
                </section>
              </section>
            </div>
          </div>
        ) : mode === "workspace" ? (
          <>
            <div className="policy-memory-import-open" aria-hidden="true">
              {renderInventory()}
            </div>
            {renderWorkspaceModal()}
          </>
        ) : (
          <>
            <div className={mode === "import" ? "policy-memory-import-open" : ""} aria-hidden={mode === "import"}>
              {renderInventory()}
            </div>
            {mode === "import" && renderImport()}
          </>
        )}

        <datalist id="policy-lookups-departments">{lookups?.departments.map((item) => <option key={item} value={item} />)}</datalist>
        <datalist id="policy-lookups-roles">{lookups?.roles.map((item) => <option key={item} value={item} />)}</datalist>
        <datalist id="policy-lookups-purposes">{lookups?.purposes.map((item) => <option key={item} value={item} />)}</datalist>
        <datalist id="policy-lookups-data-classes">{lookups?.data_classes.map((item) => <option key={item} value={item} />)}</datalist>
        <datalist id="policy-lookups-destinations">{lookups?.destinations.map((item) => <option key={item} value={item} />)}</datalist>
        <datalist id="policy-lookups-actions">{lookups?.actions.map((item) => <option key={item} value={item} />)}</datalist>
      </>
    </Shell>
  );
}

function latestVersionByDate(policy: Policy | null | undefined) {
  if (!policy) return null;
  return [...policy.versions].sort((left, right) => new Date(right.effective_at).getTime() - new Date(left.effective_at).getTime())[0] || null;
}

function activeVersionForPolicy(policy: Policy | null | undefined) {
  if (!policy) return null;
  return policy.versions.find((version) => version.status === "ACTIVE") || null;
}

function readyCandidateForPolicy(policy: Policy | null | undefined) {
  if (!policy) return null;
  return (
    policy.versions.find((version) => version.status !== "ACTIVE" && version.verification_summary?.ready_for_activation) ||
    policy.versions.find((version) => version.status === "SIMULATION") ||
    policy.versions.find((version) => version.status === "HUMAN_REVIEW") ||
    null
  );
}

function applyClauseUpdate(policies: Policy[], saved: Clause) {
  return policies.map((policy) => ({
    ...policy,
    versions: policy.versions.map((version) => {
      const hasClause = version.clauses.some((clause) => clause.id === saved.id);
      if (!hasClause) return version;
      const clauses = version.clauses.map((clause) => clause.id === saved.id ? { ...clause, ...saved } : clause);
      const total = clauses.filter((clause) => clause.verification_status !== "DELETED").length;
      const verified = clauses.filter((clause) => clause.verification_status === "VERIFIED").length;
      const draft = clauses.filter((clause) => clause.verification_status === "DRAFT").length;
      const deleted = clauses.filter((clause) => clause.verification_status === "DELETED").length;
      return {
        ...version,
        clauses,
        verification_summary: {
          ...version.verification_summary,
          total,
          verified,
          draft,
          deleted,
          ready_for_activation: total > 0 && verified === total,
        },
      };
    }),
  }));
}

function findPolicyBySearch(policies: Policy[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;
  return policies.find((policy) => [`${policy.name} (${policy.category})`, policy.name, policy.id].some((value) => value.toLowerCase() === normalized)) || null;
}

function suggestNextVersion(policy: Policy | null | undefined) {
  const latest = latestVersionByDate(policy);
  if (!latest?.version) return "";
  const match = latest.version.match(/^(.*?)(\d+)\.(\d+)$/);
  if (!match) return latest.version;
  const [, prefix, major, minor] = match;
  return `${prefix}${major}.${Number(minor) + 1}`;
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

async function validateImportFile(file: File, policies: Policy[]) {
  if (file.size > 25 * 1024 * 1024) {
    return { error: "Files above 25 MB are rejected before upload." };
  }
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!["pdf", "docx", "txt"].includes(extension)) {
    return { error: "Only PDF, DOCX and TXT files are accepted." };
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const signatureOk =
    (extension === "pdf" && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) ||
    (extension === "docx" && bytes[0] === 0x50 && bytes[1] === 0x4b) ||
    (extension === "txt" && isLikelyText(bytes));
  if (!signatureOk) {
    return { error: "File signature does not match the selected file type." };
  }
  const digestBytes = await crypto.subtle.digest("SHA-256", buffer);
  const digest = Array.from(new Uint8Array(digestBytes)).map((value) => value.toString(16).padStart(2, "0")).join("");
  const duplicate = policies.some((policy) => policy.versions.some((version) => version.sha256 && version.sha256.toLowerCase() === digest.toLowerCase()));
  if (duplicate) {
    return { error: "This file matches an existing policy digest and cannot be uploaded again.", digest };
  }
  return { digest, message: "Validated" };
}

function isLikelyText(bytes: Uint8Array) {
  const sample = bytes.slice(0, 128);
  return !sample.some((value) => value === 0);
}

function displayPolicyStatus(version: Version | null | undefined) {
  return version?.status || "UNKNOWN";
}

function clauseToDraft(clause: Clause): Draft {
  return {
    clause_ref: clause.clause_ref,
    text: clause.text,
    department: clause.department,
    roles: clause.roles.join(", "),
    purposes: clause.purposes.join(", "),
    data_classes: clause.data_classes.join(", "),
    destinations: clause.destinations.join(", "),
    action: clause.action,
    page_number: String(clause.page_number),
    heading: clause.heading || "",
    verification_status: clause.verification_status,
    human_notes: clause.human_notes || "",
  };
}

function draftToBody(draft: Draft) {
  return {
    clause_ref: draft.clause_ref,
    text: draft.text,
    department: draft.department || "ALL",
    roles: splitList(draft.roles),
    purposes: splitList(draft.purposes),
    data_classes: splitList(draft.data_classes),
    destinations: splitList(draft.destinations),
    action: draft.action,
    page_number: Number(draft.page_number || 1),
    heading: draft.heading || null,
    verification_status: draft.verification_status || "DRAFT",
    human_notes: draft.human_notes || null,
  };
}

function sanitizeClauseMutation(draft: Draft) {
  const text = (draft.text || "").trim();
  const safeText = text.length >= 10 ? text : `${text}${text ? " " : ""}Policy clause pending review.`;
  const safeHeading = (draft.heading || "").trim().slice(0, 240);
  const safeNotes = (draft.human_notes || "").trim().slice(0, 2000);
  return draftToBody({
    ...draft,
    text: safeText,
    heading: safeHeading,
    human_notes: safeNotes,
  });
}

function emptyDraftToBody() {
  return {
    clause_ref: "1.1",
    text: "Draft clause text awaiting human verification.",
    department: "ALL",
    roles: [],
    purposes: [],
    data_classes: [],
    destinations: [],
    action: "ALLOW",
    page_number: 1,
    heading: null,
    verification_status: "DRAFT",
    human_notes: null,
  };
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function firstListValue(value: string) {
  return splitList(value)[0] || "";
}

function pause(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function extractHighlightTerms(text: string) {
  const matches = text.match(/\b(restricted|confidential|external ai services?|personal identifiers?|credentials|financial records?)\b/gi) || [];
  return [...new Set(matches.map((item) => item.toLowerCase()))];
}

function highlightSensitiveText(text: string, highlights: string[]) {
  if (!highlights.length) return text;
  const pattern = new RegExp(`(${highlights.map(escapeRegex).join("|")})`, "gi");
  return text.split(pattern).map((part, index) =>
    highlights.includes(part.toLowerCase()) ? <mark key={`${part}-${index}`}>{part}</mark> : part,
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateClauseDraft<T extends keyof Draft>(
  clauseId: string,
  key: T,
  value: Draft[T],
  setDrafts: Dispatch<SetStateAction<Record<string, Draft>>>,
) {
  setDrafts((current) => {
    const existing = current[clauseId] || emptyDraft;
    const next = { ...existing, [key]: value };
    if (key !== "verification_status" && key !== "human_notes" && existing.verification_status === "VERIFIED") {
      next.verification_status = "DRAFT";
    }
    return { ...current, [clauseId]: next };
  });
}

function getAuthHeaders() {
  const token = typeof window === "undefined" ? null : localStorage.getItem("ghst_token");
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function uploadWithProgress(path: string, form: FormData, onProgress: (value: number) => void) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  const token = typeof window === "undefined" ? null : localStorage.getItem("ghst_token");
  return await new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiUrl}${path}`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(typeof body.detail === "string" ? body.detail : `Upload failed (${xhr.status}).`));
      } catch {
        reject(new Error(`Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed due to a network error."));
    xhr.send(form);
  });
}

