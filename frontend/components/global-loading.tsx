"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ShieldCheck } from "lucide-react";
import { getLoadingSnapshot, subscribeLoading } from "@/lib/loading-state";

export function GlobalLoading() {
  const snapshot = useSyncExternalStore(subscribeLoading, getLoadingSnapshot, getLoadingSnapshot);
  const visible = snapshot.routePending || snapshot.activeRequests > 0;
  const [render, setRender] = useState(visible);

  useEffect(() => {
    if (visible) {
      setRender(true);
      return;
    }
    const timeout = window.setTimeout(() => setRender(false), 140);
    return () => window.clearTimeout(timeout);
  }, [visible]);

  if (!render) return null;

  return (
    <div className={`global-loading-overlay${visible ? " visible" : ""}`} role="status" aria-live="polite" aria-label="Loading page data">
      <div className="global-loading-card">
        <span className="global-loading-mark">
          <ShieldCheck size={18} aria-hidden="true" />
        </span>
        <div className="global-loading-copy">
          <strong>Loading trusted workspace</strong>
          <span>Syncing policy, evidence, and reviewed controls...</span>
        </div>
        <div className="loader global-loading-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}
