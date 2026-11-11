# Security policy

Toolbox keeps your study Kits, notes, flashcards, architecture boards, uploaded
source documents, and encrypted API keys. A security problem can expose any of
them, so a report gets attention first.

## Supported versions

Security fixes go into the latest release on `main`. Upgrade to it before you
report, and say if the problem is gone there.

| Version        | Gets security fixes |
| -------------- | ------------------- |
| Latest release | Yes                 |
| Older releases | No                  |
| 1.x            | No                  |

## Report a vulnerability

Do not put the details in a public issue, a discussion, or a pull request.
Report it privately in one of two ways:

- Use **Report a vulnerability** on the
  [Security tab](https://github.com/arvarik/toolbox/security/advisories/new)
  (preferred — GitHub keeps the advisory private through triage and fix).
- Email the maintainer at
  [arvind.arikatla@gmail.com](mailto:arvind.arikatla@gmail.com) with
  `Toolbox security` in the subject.

Include in the report:

1. The version or commit SHA, and how you run Toolbox (GHCR image, Docker
   Compose, or native Node.js).
2. Relevant configuration (`AUTH_REQUIRED`, `TRUST_PROXY_HOPS`, `PUBLIC_URL`,
   `CORS_ORIGIN`, and whether a reverse proxy terminates TLS).
3. Minimal reproduction steps and concrete security impact.

**Disclosure expectations**: We acknowledge reports within 72 hours, share a
remediation plan within 7 days, coordinate a release date before public
disclosure, and credit reporters in the GitHub Security Advisory unless
anonymity is requested.

Hardening suggestions with no exploitable risk can be opened directly in a
[GitHub issue](https://github.com/arvarik/toolbox/issues/new/choose).

## Security model & trust boundaries

Toolbox is designed for both single-user loopback setups and shared
self-hosted multi-tenant deployments:

- **Authentication & session boundaries**:
  - **Local-owner mode (`AUTH_REQUIRED=false`)**: Intended strictly for
    loopback (`127.0.0.1`) or trusted local development. Protected against
    browser DNS-rebinding attacks via case-insensitive `hostGuard` and
    cross-site write checks (`Origin` / `Sec-Fetch-Site`). In local development,
    Vite allows LAN mobile testing (`VITE_DEV_HOST=127.0.0.1` restricts it to
    loopback on shared networks) while locking `server.allowedHosts` to
    `localhost`, IP literals, and `.local` mDNS names, and setting
    `proxy["/api"].changeOrigin: false` so the client's real `Host` header flows
    intact to Express `hostGuard` and `isOwnOrigin` (`Origin === Host`).
    Creating the first password account automatically locks the instance into
    authenticated mode.
  - **Multi-tenant mode (`AUTH_REQUIRED=true`)**: Supports NFKC-normalized
    `scrypt` passwords, WebAuthn Passkeys, and OIDC SSO (PKCE `S256` + state
    cookie binding). Session cookies use `HttpOnly; SameSite=Lax` (plus
    `Secure` and `Strict-Transport-Security` when `req.secure` is true via TLS
    or trusted `TRUST_PROXY_HOPS`).
  - **Reverse-proxy TLS trust (`TRUST_PROXY_HOPS`)**: Toolbox never trusts raw
    `X-Forwarded-Proto` headers when `TRUST_PROXY_HOPS=0` (the default), blocking
    untrusted HTTP clients from spoofing `X-Forwarded-Proto: https` to force
    browser-rejected `; Secure` cookies or sticky HSTS. Operators running behind
    a TLS terminator (Caddy, Nginx, Traefik, Cloudflare Tunnel, etc.) **must**
    set `TRUST_PROXY_HOPS=1` (or their exact proxy hop count) so `req.secure`,
    `; Secure` session/OIDC cookies, and `Strict-Transport-Security` activate.
    Toolbox emits a `[security]` warning at startup when `PUBLIC_URL` /
    `PUBLIC_ORIGIN` uses `https://` with `TRUST_PROXY_HOPS=0`, and once per app
    instance at runtime if `X-Forwarded-Proto: https` arrives while
    `TRUST_PROXY_HOPS=0`.
  - **Personal API & MCP tokens (`tbk_`)**: Hashed with SHA-256 at rest.
    `/api/mcp` always requires an explicit `Bearer tbk_` token (never cookies or
    implicit local auth) and enforces two-layer `readOnly` token restrictions.
- **Tenant isolation**: Every authenticated request binds a branded `OwnerId`
  `Scope` (`AsyncLocalStorage`), and CI runs `npm run lint:tenant` to reject
  any unscoped SQL query across owned relational, FTS5, or `sqlite-vec` tables.
- **Secrets at rest**: Provider API keys and OIDC client secrets are sealed with
  AES-256-GCM (`v1:` envelope) keyed by `TOOLBOX_SECRET_KEY` or an owner-only
  (`0600`) `secret.key` inside a `0700` `DATA_DIR`.
- **Untrusted input & SSRF hardening**:
  - Outbound fetches (custom AI endpoints, web research, OIDC discovery) route
    through connect-time DNS-validated `safeFetch`, blocking cloud metadata,
    link-local, and multicast ranges on every hop, and blocking RFC1918/loopback
    targets for non-admin BYOK endpoints.
  - JSON payloads enforce size (`10mb`), nesting depth (`64`), and
    prototype-pollution key stripping (`__proto__`, `constructor.prototype`).
  - Kit/backup `.zip` imports enforce canonical relative paths, entry count
    bounds, and streaming uncompressed byte caps.
  - MCP tool outputs wrap untrusted prose in `<untrusted_data>` fences and strip
    invisible/bidi control characters.

## Scope

In scope: the server, the web app, the `/api/mcp` endpoint, the REST API,
Kit/ZIP import and export (`.toolbox-kit.json` and `.toolbox-backup.zip`), and
the published GHCR Docker image.

Out of scope:

- Instances exposed on a shared or public network with `AUTH_REQUIRED=false`
  (enable sign-in first; see the
  [deployment guide](docs/deployment.md#2-securing-a-multi-tenant-instance)).
- Vulnerabilities in third-party AI providers, SearXNG instances, OIDC identity
  providers, or reverse proxies connected to Toolbox.
- Automated scanner output with no demonstrated exploitability or impact.

## Supply chain & artifact verification

- Dependencies deny lifecycle install scripts via `package.json` `allowScripts`,
  verify registry signatures & provenance (`npm audit signatures`), and enforce
  a 7-day Dependabot cooldown on routine updates.
- GitHub Actions workflows pin every action to a full 40-char commit SHA with
  `permissions: contents: read` least privilege, audited by `zizmor`,
  `actionlint`, CodeQL, OpenSSF Scorecard, and Grype.
- CI signs SLSA build provenance attestations for published container images and
  release archives:

```bash
gh attestation verify oci://ghcr.io/arvarik/toolbox:latest --owner arvarik
```
