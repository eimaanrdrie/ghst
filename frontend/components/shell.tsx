"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BookOpenCheck,
  BrainCircuit,
  ClipboardCheck,
  FileClock,
  FlaskConical,
  LogOut,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { beginRouteTransition, endRouteTransition } from "@/lib/loading-state";

const links = [
  { href: "/dashboard", label: "Control plane", icon: Activity, roles: ["REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN"] },
  { href: "/employee", label: "Protected composer", icon: ShieldCheck, roles: ["EMPLOYEE"] },
  { href: "/reviews", label: "Human review", icon: ClipboardCheck, roles: ["REVIEWER", "POLICY_ADMIN", "SYSTEM_ADMIN"] },
  { href: "/policies", label: "Policy memory", icon: BookOpenCheck, roles: ["REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN"] },
  { href: "/precedents", label: "ACE precedents", icon: BrainCircuit, roles: ["REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN"] },
  { href: "/learning", label: "Governed learning", icon: FlaskConical, roles: ["REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN"] },
  { href: "/audit", label: "Audit evidence", icon: FileClock, roles: ["REVIEWER", "POLICY_ADMIN", "AUDITOR", "SYSTEM_ADMIN"] },
] as const;

export function Shell({
  children,
  hideSidebarCommandCard = false,
  compactSystemBar = false,
}: {
  children: React.ReactNode;
  hideSidebarCommandCard?: boolean;
  compactSystemBar?: boolean;
}) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, router, user]);

  useEffect(() => {
    setDrawerOpen(false);
    endRouteTransition();
  }, [pathname]);

  if (loading) {
    return (
      <main className="center-page">
        <div className="loader" />
        <p>Verifying trusted identity...</p>
      </main>
    );
  }

  if (!user) return null;

  const available = links.filter((item) => item.roles.some((role) => user.roles.includes(role)));
  const activeModule = available.find((item) => item.href === pathname)?.label || "Control plane";
  const homeHref = user.roles.includes("EMPLOYEE") ? "/employee" : "/dashboard";
  const roleLabel = user.roles[0].replaceAll("_", " ");
  const handleNavigate = (href: string) => {
    if (href !== pathname) beginRouteTransition();
  };

  return (
    <div className={`app-shell${drawerOpen ? " sidebar-open" : ""}${compactSystemBar ? " app-shell-compact-system-bar" : ""}`}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar-top">
          <Link href={homeHref} className="brand" onClick={() => handleNavigate(homeHref)}>
            <span className="brand-mark">
              <img src="/ghst-logo.png" alt="" />
            </span>
            <span>
              <strong>GHST</strong>
              <small>Governance OS</small>
            </span>
          </Link>
          <button className="icon-button mobile-menu-toggle" onClick={() => setDrawerOpen(false)} aria-label="Close navigation">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {!hideSidebarCommandCard && (
          <div className="sidebar-command-card">
            <div className="sidebar-command-top">
              <span className="mono-chip">NODE_01</span>
              <span className="system-signal secure">Secure</span>
            </div>
            <strong>Governance command state</strong>
            <p>{activeModule} is running under trusted identity, active policy memory, and reviewed release controls.</p>
          </div>
        )}

        <nav>
          <span className="nav-group-label">System modules</span>
          {available.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => handleNavigate(href)}
              aria-current={pathname === href ? "page" : undefined}
              className={pathname === href ? "nav-link active" : "nav-link"}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="identity-card">
          <span className="avatar">{user.display_name.split(" ").map((value) => value[0]).slice(0, 2).join("")}</span>
          <div className="identity-copy">
            <strong>{user.display_name}</strong>
            <small>{user.department} - {roleLabel}</small>
          </div>
          <button className="icon-button" onClick={logout} aria-label="Sign out">
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <section className="workspace">
        <div className="mobile-topbar">
          <button className="icon-button mobile-menu-toggle" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
            <Menu size={18} aria-hidden="true" />
          </button>
          <div className="brand">
            <span className="brand-mark">
              <img src="/ghst-logo.png" alt="" />
            </span>
            <span>
              <strong>GHST</strong>
              <small>{user.department}</small>
            </span>
          </div>
          <button className="icon-button" onClick={logout} aria-label="Sign out">
            <LogOut size={17} aria-hidden="true" />
          </button>
        </div>

        <main className="main-content">{children}</main>
      </section>
    </div>
  );
}
