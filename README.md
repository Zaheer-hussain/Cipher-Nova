# MailShield

MailShield is an email threat-intelligence platform. The existing Next.js frontend remains in this folder, and the new Express backend foundation is isolated under [`backend/`](./backend).

## Current Progress

- ✅ Step 1: Next.js + Tailwind + Clerk auth scaffold
- ✅ Step 2: MongoDB setup + schemas + indexes
- ✅ Step 3: Raw email / `.eml` parsing with normalized output
- ✅ Step 4: Header forensics + origin IP extraction + geolocation
- ✅ Step 5: Mandatory Groq first-pass content analysis
- ✅ Step 6: Conditional Gemini second-pass reasoning
- ✅ Step 7: Explainable 0–100 trust score engine
- ✅ Step 8: End-to-end scan pipeline with MongoDB persistence
- ✅ Step 9: Authenticated dashboard, history, and scan details
- ✅ Step 10: Public health endpoint and deployment readiness
- ✅ Step 11: Loading, error, malformed-input, and upload-size polish
- ✅ Step 12: Origin map with approximate IP coordinates
- ✅ Step 13: Cached RDAP domain intelligence
- ✅ Phase 1, Step 1: Separate Express backend foundation
- ✅ Phase 1, Step 2: Clerk backend verification and frontend REST client
- ✅ Phase 1, Step 3: Backend MongoDB connection, schemas, indexes, and audit-log foundation
- ✅ Phase 1, Step 4: Backend normalized RFC 822 email parser and protected parse endpoint
- ✅ Phase 1, Step 5: Backend header forensics and origin-IP geolocation endpoint
- ✅ Phase 1, Step 6: Backend Groq first-pass AI classification and protected content-analysis route
- ✅ Phase 1, Step 7: Backend conditional Gemini second-pass review and explainable trust-score computation
- ✅ Phase 1, Step 8: Backend full scan pipeline with parsing, forensics, AI scoring, persistence, and trust scoring
- ✅ Phase 1, Step 9: Authenticated backend scan history/detail endpoints with audit-log write-through
- ✅ Phase 1, Step 10: Backend rate limiting and AES-256-GCM encrypted raw-email chain of custody
- ✅ Phase 1, Step 11: Frontend dashboard migration to the Express scan, history, and detail APIs
- ✅ Phase 1, Step 12: Deployment-safe startup with database health reporting and retryable MongoDB connection
- ✅ Phase 1, Step 13: Campaign grouping and organization-scoped campaign listing
- ✅ Phase 1, Step 14: Mailbox connection storage contract and revoke/list endpoints
- ✅ Phase 1, Step 15: Server-side Gmail/Outlook OAuth authorization and encrypted token exchange foundation
- ✅ Phase 1, Step 16: Server-side recent mailbox message sync preview
- ✅ Phase 1, Step 17: Secure provider message retrieval contract for mailbox-backed scans
- ✅ Phase 1, Step 18: Provider message full-scan endpoint with mailbox attribution
- ✅ Phase 1, Step 19: Validated Gmail/Microsoft mailbox webhook boundary
- ✅ Phase 1, Step 20: Mailbox webhook route smoke validation and deployment contract
- ✅ Phase 1, Step 21: Durable mailbox webhook receipts with retry deduplication
- ✅ Phase 1, Step 22: Internal webhook worker queue and completion contract
- ✅ Phase 1, Step 23: Atomic webhook worker claims and stale-lease recovery
- ✅ Phase 1, Step 24: Webhook worker identifier validation and client-error handling
- ✅ Phase 1, Step 25: Dashboard mailbox connection, sync, and revoke controls
- ✅ Phase 1, Step 26: OAuth callback exemption and mailbox message scan action

## Backend Foundation

The backend is an independent TypeScript Express service intended for Render:

- [`backend/src/app.ts`](./backend/src/app.ts) configures Helmet, locked CORS, JSON limits, and health routing.
- [`backend/src/server.ts`](./backend/src/server.ts) starts the HTTP server.
- [`backend/.env.example`](./backend/.env.example) lists backend-only secrets.
- [`backend/src/db.ts`](./backend/src/db.ts) provides the cached Mongoose connection used by the backend.
- Backend models cover scans, campaigns, mailbox connections, IP reputation cache, and append-only audit logs.
- [`backend/src/lib/header-analysis.ts`](./backend/src/lib/header-analysis.ts) inspects SPF/DKIM/DMARC, relay chains, mismatched sender domains, and origin-IP signals.
- [`backend/src/lib/geolocation.ts`](./backend/src/lib/geolocation.ts) resolves the public origin IP with ip-api.com and returns the same shape used in the frontend.
- If Clerk keys are not configured, protected backend routes return a JSON `503` configuration error while `/api/health` remains available.
- The backend listens before attempting MongoDB connection so Render health checks remain available during database outages; `/api/health` reports `connected`, `connecting`, or `disconnected`.
- For local development, the backend loads `backend/.env` first and then the existing root `.env.local`; Render should provide the backend variables directly in its environment settings.
- Add an `ENCRYPTION_KEY` before running scans. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and place the result in `backend/.env` or the root `.env.local`.
- Mailbox OAuth local configuration uses `http://localhost:4000/api/mailboxes/oauth/callback` for both providers. In Google Cloud Console, create an OAuth client under **APIs & Services → Credentials**, choose **Web application**, add that URL under **Authorized redirect URIs**, enable the Gmail API, and copy the client ID and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- In Microsoft Entra admin center, create an **App registration**, add a Web redirect URI of `http://localhost:4000/api/mailboxes/oauth/callback`, create a client secret under **Certificates & secrets**, add delegated Microsoft Graph permissions `Mail.Read` and `User.Read`, and grant consent as required. Copy the application ID and secret into `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`.
- For production, register the exact deployed backend callback URL in both provider consoles, for example `https://<render-service>.onrender.com/api/mailboxes/oauth/callback`, then set `GOOGLE_REDIRECT_URI` and `MICROSOFT_REDIRECT_URI` to that same URL in Render. Never commit `.env.local`, provider secrets, or the encryption key.
- A Render Blueprint is provided at [`render.yaml`](./render.yaml). It deploys the backend from `backend/`, runs `npm ci && npm run build`, starts with `npm start`, and exposes `/api/health` for health checks. Set every `sync: false` variable in Render before testing OAuth.
- `clerkMiddleware()` runs on every backend request and `GET /api/auth/me` demonstrates server-side session validation.
- `/api/health` is intentionally excluded from Clerk verification so Render/Vercel uptime checks work before authentication is configured.
- [`src/lib/backend-client.ts`](./src/lib/backend-client.ts) attaches a Clerk session token as a bearer token to backend requests.
- [`backend/src/lib/email-parser.ts`](./backend/src/lib/email-parser.ts) normalizes RFC 822 text and `.eml` content.
- The backend `POST /api/parse-email` endpoint accepts `{ "rawEmail": "..." }` and returns normalized addresses, headers, body, links, and attachment metadata.
- The backend `POST /api/analyze-email` endpoint accepts the same payload and returns `{ parsedEmail, headerAnalysis, geolocation }`.
- The backend `POST /api/scan` endpoint runs the full parse → forensics → Groq → optional Gemini → trust-score → MongoDB persistence workflow.
- The backend `GET /api/scans` endpoint returns paginated scans scoped to the authenticated user and organization.
- The backend `GET /api/scans/:id` endpoint returns one scan only when it belongs to the authenticated user and organization.
- Each scan is grouped into an organization-scoped campaign using sender domain, origin IP, and linked URL domains.
- The backend `GET /api/campaigns` endpoint lists recent campaigns for the active organization.
- The backend `GET /api/mailboxes` endpoint lists connected mailbox metadata without returning encrypted tokens.
- The backend `POST /api/mailboxes/:id/revoke` marks a mailbox connection revoked and clears its watch expiry.
- Provider OAuth authorization/callback routes remain the next mailbox step; no provider access tokens are accepted directly from the browser.
- `GET /api/mailboxes/:provider/authorize` creates a signed, short-lived state and returns a provider authorization URL.
- `GET /api/mailboxes/oauth/callback` validates state, exchanges the authorization code server-side, and encrypts the returned token payload.
- `POST /api/mailboxes/:id/sync` reads the 10 most recent inbox message summaries from Gmail or Outlook using the encrypted server-side token.
- Sync returns message metadata only; provider access tokens are never returned to the frontend.
- `POST /api/mailboxes/:id/message-preview` retrieves and parses one provider message server-side without returning raw source or provider tokens.
- `POST /api/mailboxes/:id/scan-message` runs a provider message through the full scan pipeline and records mailbox/provider-message attribution.
- `POST /api/mailboxes/:id/subscribe` creates or renews Gmail Pub/Sub or Microsoft Graph inbox monitoring and stores the provider subscription metadata.
- Microsoft notifications are accepted only when their subscription ID and stored client state match an active mailbox connection.
- A scheduler can call `POST /api/internal/mailbox-subscriptions/renew` with `MAILBOX_WEBHOOK_SECRET` to renew subscriptions expiring within 24 hours.
- Microsoft validation requests are supported at `GET /api/webhooks/mailboxes/microsoft`.
- Provider webhook notifications are accepted at `POST /api/webhooks/mailboxes/:provider` only with `MAILBOX_WEBHOOK_SECRET`; they are acknowledged and audited without exposing tokens.
- Webhook receipts are persisted with a unique event key, so provider retries return an accepted duplicate response instead of creating duplicate work.
- Internal workers can poll `GET /api/internal/mailbox-webhooks/pending`, claim events through `POST /api/internal/mailbox-webhooks/:id/claim`, and complete events through `POST /api/internal/mailbox-webhooks/:id/complete`, all protected by `MAILBOX_WEBHOOK_SECRET`.
- Workers can process an accepted event through `POST /api/internal/mailbox-webhooks/:id/process`; Gmail history notifications and Microsoft Graph message resources are resolved into provider message IDs and scanned automatically.
- Claims older than five minutes are eligible for recovery by another worker.
- The dashboard mailbox panel uses the authenticated backend APIs for provider authorization, recent sync, and revocation.
- The OAuth callback is exempt from Clerk browser middleware but remains protected by signed, short-lived OAuth state.
- Synced mailbox messages now have a `Scan message` action that runs the provider-message scan pipeline and opens the standard scan detail page.
- Scan creation, listing, and detail access write append-only audit events.
- The dashboard now attaches the Clerk bearer token through [`src/lib/backend-client.ts`](./src/lib/backend-client.ts) and uses the Express backend for new scans, scan history, and scan details.
- Every account currently receives a backend-enforced Free plan: 25 scans per UTC calendar month and 1 connected mailbox. `GET /api/account/plan` returns current usage and remaining allowances.
- High-risk and suspicious scans create organization-scoped security alerts. `GET /api/alerts` lists them, and `POST /api/alerts/:id/acknowledge` or `/resolve` updates alert workflow state with an audit record.
- `GET /api/alerts` also returns `openCount`; the dashboard refreshes alert data every 30 seconds so newly detected threats appear without a manual reload.
- Existing Next.js API routes remain temporarily for rollback and compatibility; the dashboard no longer uses them for its primary data path.
- Raw email content is stored encrypted with AES-256-GCM; the SHA-256 hash remains available for integrity verification.
- Backend API requests are rate-limited to 100 requests per 15 minutes per client IP; health checks are exempt.

Run it separately:

```bash
cd backend
npm install
npm run dev
```

Health check:

```text
http://localhost:4000/api/health
```

Protected auth check:

```text
GET http://localhost:4000/api/auth/me
Authorization: Bearer <Clerk session token>
```

Clerk proxy:
- [`proxy.ts`](./src/proxy.ts) protects dashboard and API routes while leaving `/api/health` public

## Environment Setup

Create a `.env.local` file:

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
MONGODB_URI=your_mongodb_connection_string
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_gemini_api_key
IPINFO_TOKEN=your_ipinfo_token
```

## MongoDB Models Added

- `scans` collection model: [`scan.ts`](./src/models/scan.ts)
  - Index: `{ userId: 1, createdAt: -1 }`
  - Index: `{ senderDomain: 1 }`
  - Index: `{ originIp: 1 }`
- `domainCache` collection model (optional stretch support): [`domain-cache.ts`](./src/models/domain-cache.ts)
  - Unique index: `{ domain: 1 }`
  - TTL index: `{ createdAt: 1 }` expiring documents after 7 days

Connection helper:
- [`mongodb.ts`](./src/lib/mongodb.ts) (cached Mongoose connection for Next.js runtime reuse)

Email parsing:
- [`email-parser.ts`](./src/lib/email-parser.ts) accepts raw RFC 822 text or `.eml` bytes
- Extracts addresses, subject, date, Message-ID, Return-Path, Received headers, DKIM/Auth headers, body text/HTML, links, and attachment metadata
- Protected API endpoint: `POST /api/parse-email`
  - JSON: `{ "rawEmail": "..." }`
  - Multipart form: `.eml` file in the `file` field

Header analysis:
- [`header-analysis.ts`](./src/lib/header-analysis.ts) checks SPF/DKIM/DMARC results, sender/reply/return-path domain mismatches, relay count, and earliest public origin IP
- [`geolocation.ts`](./src/lib/geolocation.ts) resolves the origin IP with ip-api.com and returns country, region, city, ISP, and proxy/hosting flags
- Protected API endpoint: `POST /api/analyze-email`
  - JSON: `{ "rawEmail": "..." }`
  - Returns parsed email data, header analysis, and geolocation

Groq analysis:
- [`groq-analysis.ts`](./src/lib/groq-analysis.ts) calls Groq with a strict JSON schema and validates every response
- Protected API endpoint: `POST /api/analyze-content`
  - JSON: `{ "subject": "...", "text": "...", "senderEmail": "optional@example.com" }`
- Optional model override: `GROQ_MODEL`. If omitted, MailGuard discovers an available text model from Groq's `/models` endpoint. Check the current list at https://console.groq.com/docs/models.

Gemini analysis:
- [`gemini-analysis.ts`](./src/lib/gemini-analysis.ts) triggers Gemini only when Groq confidence is below `0.7` or header/content signals disagree
- Protected API endpoint: `POST /api/analyze-second-pass`
  - JSON: `{ "subject": "...", "text": "...", "groqAnalysis": {...}, "headerAnalysis": {...} }`
- Optional model override: `GEMINI_MODEL` (defaults to `gemini-2.0-flash`)

Trust score:
- [`trust-score.ts`](./src/lib/trust-score.ts) combines authentication, header anomalies, AI category, impersonation, proxy/hosting origin, and origin-IP availability
- Protected API endpoint: `POST /api/trust-score`
- Returns a bounded `trustScore`, risk label, final category, and human-readable reasons

Full scan pipeline:
- Protected API endpoint: `POST /api/scan`
- Accepts JSON `{ "rawEmail": "..." }` or multipart `.eml` upload in the `file` field
- Runs parse → header analysis → geolocation → Groq → conditional Gemini → trust score
- Persists the complete scan under the authenticated Clerk user ID

Dashboard:
- [`dashboard-client.tsx`](./src/app/dashboard/dashboard-client.tsx) provides raw-email paste and `.eml` upload workflows
- `GET /api/scans` returns paginated history for the authenticated user
- `GET /api/scans/[id]` returns an authenticated scan detail
- `/dashboard/scans/[id]` presents score, reasons, authentication, AI, and origin intelligence

Health check:
- `GET /api/health` is public and does not require Clerk authentication
- Returns `{ "status": "ok", "service": "mailguard", "timestamp": "..." }`

## Deployment

MailGuard uses separate deployments for the Next.js frontend and Express backend:

1. Push the repository to GitHub.
2. Deploy the backend first using [`render.yaml`](./render.yaml). In Render, enter every `sync: false` secret and replace the placeholder URL values with the final Vercel and Render URLs.
3. Confirm `https://<render-service>.onrender.com/api/health` returns HTTP 200.
4. Deploy the repository root as a Next.js project on Vercel. Keep the root directory as `/`, use `npm run build` and `npm start`, and set `NEXT_PUBLIC_BACKEND_URL` to the Render backend URL.
5. Set the frontend Clerk publishable key and the backend Clerk keys in their respective providers. Configure Clerk's production instance with the Vercel application URL and add it to the allowed origins and redirect URLs.
6. In Google Cloud Console, add the exact Render callback URL to the OAuth client's authorized redirect URIs:
   `https://<render-service>.onrender.com/api/mailboxes/oauth/callback`
7. Set the same callback URL in Render's `GOOGLE_REDIRECT_URI` (and Microsoft variables only if Microsoft OAuth is configured).
8. Sign in on Vercel, run a scan using a test `.eml` file, connect Gmail, and verify mailbox sync and alert actions.

The backend production commands are:

```bash
cd backend
npm ci
npm run build
npm start
```

Input safeguards:
- Raw email and `.eml` uploads are limited to 10 MB.
- Malformed email input returns a clear HTTP 400 error from `/api/scan`.
- Dashboard and scan-detail routes include loading and recoverable error states.

Origin map:
- Geolocation stores latitude and longitude when provided by ip-api.com.
- Scan details show an OpenStreetMap embed and a larger-map link.
- Coordinates represent approximate IP location, not a physical address.

Domain intelligence:
- [`domain-intelligence.ts`](./src/lib/domain-intelligence.ts) looks up registration date and registrar via RDAP.
- Results are cached in `domainCache` for 7 days.
- Unavailable RDAP data is shown as unavailable rather than blocking the scan.

## Scripts

```bash
npm run dev
npm run lint
npm run build
```

Open [http://localhost:3000](http://localhost:3000).
