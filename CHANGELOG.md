# Changelog

This file lists the notable changes in each Toolbox release.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the version numbers follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0-alpha.1] - Unreleased

Toolbox v2 turns the v1 System Design study app into a self-hosted,
multi-user study platform for any subject. A v1 database upgrades in place
on the first start.

### Added

- Kits: portable study workspaces for any subject. You can export and import
  them as `.toolbox-kit.json` or `.toolbox-backup.zip` files, and publish,
  fork, and sync them through an instance Shared Library. System Design is the
  official starter Kit.
- Kit Compiler: builds a Kit from a topic, PDFs, Markdown files, or URLs in
  four stages, with optional SearXNG web research. Living Kits add topics to an
  existing Kit.
- Study tools: FSRS-6 scheduling, credit for prerequisite topics, remediation
  queues, attempt-gated drills, Challenge Node, a Feynman evaluator, and a
  review queue across all Kits.
- Accounts: optional sign-in with passwords, passkeys, or OIDC single sign-on,
  plus invitations, an admin console, an audit log, SQLite backups, personal
  API tokens, and the `npm run reset-password` command.
- AI: quick, deep, and research model tiers across Gemini, OpenAI, Claude, and
  OpenAI-compatible endpoints, per-user API keys, and local hybrid search
  (FTS5 and sqlite-vec with ONNX embeddings).
- An MCP server at `POST /api/mcp` for Claude Desktop, Cursor, and other MCP
  clients.
- Sanitized inline SVG figures, strict Mermaid diagrams, and offline KaTeX math.
- Architecture and concept-map canvases, a prerequisite graph view, a Day-0
  starter deck, and a `⌘K` command palette.
- Multi-arch Docker images on GHCR (amd64 and arm64) with build provenance,
  and CodeQL, OpenSSF Scorecard, and Dependabot checks.
- Contributor and community files: contributing guide, code of conduct,
  security policy, and issue and pull request templates.
- Automatic SQLite backups every `BACKUP_INTERVAL_HOURS` (default 24), and
  Docker Compose now passes every variable in `.env` to the container.
- Kit, a box turtle whose shell is a toolbox, is the new logo and mascot, and
  the tagline is "Tools for Thought". `npm run brand` draws the brand kit in
  `docs/brand/` from one source drawing.

### Changed

- The code base is now TypeScript. Node.js 26 runs the server source directly,
  so the server has no build step.
- The stack is React 19, React Router 8, Vite 8, Tailwind CSS 4, and Express 5.
- SM-2 review progress from v1 changes to FSRS-6 the next time you review
  each card.
- The Docker image uses Debian trixie-slim and runs as the non-root `node` user.
- AI provider failures return `502`, `503`, or `504` instead of `500`, and a
  chat stream that stalls for 120 seconds ends with an error.
- A **Low** confidence rating caps a Good or Easy review at Hard.

### Fixed

- The Docker image keeps the license files of its dependencies, and the web
  bundle includes `THIRD-PARTY-LICENSES.md`.
- The per-user AI budget now covers every route that calls an AI model.

### Security

- SSRF guards for custom AI endpoints and web research, a host guard against
  DNS rebinding, a Content Security Policy, and private file modes for the
  data directory.
- API keys and other stored secrets are encrypted at rest with AES-256-GCM.
- Backup imports reject unsafe ZIP files, such as path traversal, symbolic
  links, and decompression bombs.
- Custom AI endpoints are checked on every call, Kit imports have size caps,
  and untrusted SVG, URL, and path input is parsed in linear time.

[2.0.0-alpha.1]: https://github.com/arvarik/toolbox/compare/v1.4.0...HEAD
