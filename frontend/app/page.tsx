"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  Eye,
  EyeOff,
  Fingerprint,
  Shield,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";

const identities = [
  {
    id: "all-function",
    title: "All Function",
    subtitle: "Elena Garcia",
    helper: "Access to all demo modules",
    username: "system.admin@ghst.demo",
    password: "DemoSystem!2026",
    claims: ["SYSTEM_ADMIN", "Technology", "NODE_01"],
    icon: Sparkles,
  },
  {
    id: "reviewer",
    title: "Reviewer",
    subtitle: "Human decisions",
    helper: "Human review and approval workflows",
    username: "legal.reviewer@ghst.demo",
    password: "DemoReview!2026",
    claims: ["REVIEWER", "Legal", "NODE_01"],
    icon: UserRound,
  },
  {
    id: "policy-admin",
    title: "Policy Admin",
    subtitle: "Policies & learning",
    helper: "Policies, ACE and governed learning",
    username: "policy.admin@ghst.demo",
    password: "DemoPolicy!2026",
    claims: ["POLICY_ADMIN", "Governance", "NODE_01"],
    icon: Shield,
  },
] as const;

type IdentityId = (typeof identities)[number]["id"];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [selectedIdentityId, setSelectedIdentityId] = useState<IdentityId>("all-function");
  const [username, setUsername] = useState("system.admin@ghst.demo");
  const [password, setPassword] = useState("DemoSystem!2026");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedIdentity = useMemo(
      () => identities.find((identity) => identity.id === selectedIdentityId) ?? identities[0],
    [selectedIdentityId],
  );

  function moveIdentity(step: -1 | 1) {
    const currentIndex = identities.findIndex((identity) => identity.id === selectedIdentityId);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (safeIndex + step + identities.length) % identities.length;
    chooseIdentity(identities[nextIndex].id);
  }

  function chooseIdentity(identityId: IdentityId) {
    const identity = identities.find((entry) => entry.id === identityId);
    if (!identity) return;
    setSelectedIdentityId(identity.id);
    setUsername(identity.username);
    setPassword(identity.password);
    setError("");
    setValidationError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      setValidationError("Email and password are required.");
      setError("");
      return;
    }

    if (!trimmedUsername.includes("@")) {
      setValidationError("Enter a valid seeded identity email.");
      setError("");
      return;
    }

    setBusy(true);
    setError("");
    setValidationError("");

    try {
      const user = await login(trimmedUsername, password);
      router.push(user.roles.includes("EMPLOYEE") ? "/employee" : "/dashboard");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="login-brand">
          <img className="login-ghost-logo" src="/ghst-logo.png" alt="" />
          <strong>GHST</strong>
        </div>

        <div className="login-hero-center">
          <div className="hero-copy">
            <div className="login-kicker">Governance OS</div>
            <h1>AI autonomy,
              <br />
              within human bounds.
            </h1>
            <p>Govern prompts before sensitive data reaches external AI.</p>
          </div>

          <div className="login-proof-row" aria-label="Platform principles">
            <div className="login-proof-item">
              <ShieldCheck size={28} aria-hidden="true" />
              <span>Pre-submit control</span>
            </div>
            <div className="login-proof-divider" aria-hidden="true" />
            <div className="login-proof-item">
              <BrainCircuit size={28} aria-hidden="true" />
              <span>Bounded learning</span>
            </div>
            <div className="login-proof-divider" aria-hidden="true" />
            <div className="login-proof-item">
              <Fingerprint size={28} aria-hidden="true" />
              <span>Tamper-evident audit</span>
            </div>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={submit} noValidate>
          <div className="eyebrow login-status-pill">
            <Check size={14} aria-hidden="true" />
            Managed demo environment
          </div>

          <h2>Enter GHST</h2>
          <p>Choose a seeded identity</p>

          <div className="login-identity-grid" role="radiogroup" aria-label="Seeded identities">
            {identities.map((identity) => {
              const Icon = identity.icon;
              const selected = selectedIdentityId === identity.id;

              return (
                <button
                  type="button"
                  key={identity.id}
                  className={`login-identity-card${selected ? " selected" : ""}`}
                  onClick={() => chooseIdentity(identity.id)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      event.preventDefault();
                      moveIdentity(1);
                    }
                    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      event.preventDefault();
                      moveIdentity(-1);
                    }
                  }}
                  role="radio"
                  aria-checked={selected}
                >
                  <div className="login-identity-card-icon">
                    <Icon size={34} aria-hidden="true" />
                  </div>
                  <strong>{identity.title}</strong>
                  <span>{identity.subtitle}</span>
                  {selected ? (
                    <div className="login-identity-check" aria-hidden="true">
                      <Check size={16} />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="login-claims-bar" aria-label="Trusted claims">
            <div className="login-claims-icon">
              <ShieldCheck size={17} aria-hidden="true" />
            </div>
            <div className="login-claims-list">
              {selectedIdentity.claims.map((claim, index) => (
                <span key={claim} className="login-claim-chip">
                  {index > 0 ? <i aria-hidden="true" /> : null}
                  {claim}
                </span>
              ))}
            </div>
          </div>

          <div className="login-identity-helper" aria-live="polite">
            <strong>{selectedIdentity.title}</strong>
            <span>{selectedIdentity.helper}</span>
          </div>

          <div className="field">
            <label htmlFor="username">Email</label>
            <input
              id="username"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setValidationError("");
                setError("");
              }}
              autoComplete="username"
              aria-invalid={Boolean(validationError || error)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="login-password-field">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setValidationError("");
                  setError("");
                }}
                autoComplete="current-password"
                aria-invalid={Boolean(validationError || error)}
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
              </button>
            </div>
          </div>

          {validationError ? (
            <div className="notice notice-error login-auth-notice" role="alert">{validationError}</div>
          ) : null}
          {error ? (
            <div className="notice notice-error login-auth-notice" role="alert">{error}</div>
          ) : null}

          <button className="button button-primary button-block login-submit" disabled={busy}>
            {busy ? (
              <>
                <span className="loader" />
                Authenticating
              </>
            ) : (
              <>
                Continue securely
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
        </form>
      </section>
    </main>
  );
}
