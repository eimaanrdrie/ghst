# Production deployment profile

`docker-compose.production.yml` separates the TLS edge, internal governance plane and explicitly controlled API egress. Production persistence uses Supabase PostgreSQL over TLS. The web runtime and Ollama have no Internet route; only the API joins `controlled_egress` so it can reach the allowlisted Supabase database and an approved downstream after clearance verification.

Before deployment:

1. Place an organisation-issued certificate at `deploy/certs/tls.crt` and its key at `deploy/certs/tls.key`.
2. Copy the Supabase **Session pooler** connection string from the project dashboard, convert its scheme to `postgresql+psycopg://`, retain `sslmode=require`, and store it as `SUPABASE_DATABASE_URL` in the deployment secret manager.
3. Set every other required variable shown in `.env.example`, using a secret manager in the target platform.
4. Restrict `controlled_egress` at the host or cloud firewall to the Supabase pooler and approved AI-provider paths.
5. Pull and verify local model weights before enabling the internal-only network.
6. Run the model benchmark and security release gate.

Start the profile with:

```bash
docker compose -f docker-compose.production.yml up --build
```

No certificate, key or deployment secret is included in source control.

The browser and frontend never receive a Supabase URL, anon key or service-role key. FastAPI remains the only data-access boundary. Migration `0003` enables PostgreSQL row-level security on GHST tables and revokes Supabase Data API access from `anon` and `authenticated`; application RBAC remains authoritative inside FastAPI.

## Vercel frontend option

If you want a fast public demo, host only the GHST frontend on Vercel and keep the FastAPI backend on a separate host.

Recommended Vercel settings:

- Framework preset: `Next.js`
- Root directory: `frontend`
- Install command: `npm ci`
- Build command: `npm run build`
- Output directory: `out`

Required Vercel environment variable:

```env
NEXT_PUBLIC_API_URL=https://YOUR-BACKEND-DOMAIN/api/v1
```

Required backend environment update:

```env
CORS_ORIGINS=http://localhost:3000,https://YOUR-PROJECT.vercel.app
```

If you use a custom Vercel domain, add that exact domain to `CORS_ORIGINS` as well.
