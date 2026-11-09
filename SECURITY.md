# Security policy

Toolbox keeps your study Kits, notes, flashcards, architecture boards, uploaded
source documents, and encrypted API keys. A security problem can expose any of
them, so a report gets attention first.

## Supported versions

Security fixes go into the latest release. Upgrade to it before you report, and
say if the problem is gone there.

| Version        | Gets security fixes |
| -------------- | ------------------- |
| Latest release | Yes                 |
| Older releases | No                  |
| 1.x            | No                  |

## Report a vulnerability

Do not put the details in a public issue, a discussion or a pull request.
Report it privately in one of two ways:

- Email the maintainer at
  [arvind.arikatla@gmail.com](mailto:arvind.arikatla@gmail.com) with
  "Toolbox security" in the subject.
- Use **Report a vulnerability** on the
  [Security tab](https://github.com/arvarik/toolbox/security/advisories/new).
  GitHub keeps the report private.

Put these in the report:

1. The version or commit, and how you run Toolbox: the Docker image, Docker
   Compose or a native install.
2. The settings that matter, such as `AUTH_REQUIRED`, `TRUST_PROXY_HOPS` and
   `PUBLIC_URL`, and whether a reverse proxy sits in front.
3. The steps that show the problem, and what an attacker gains.

The maintainer replies to every report, agrees on a fix and a date to publish,
and credits you in the advisory unless you ask otherwise.

A hardening idea that puts nobody at risk, such as a stricter default, can go
in a [GitHub issue](https://github.com/arvarik/toolbox/issues/new/choose).

## Scope

In scope: the server, the web app, the `/api/mcp` endpoint, the REST API,
Kit/ZIP import and export (`.toolbox-kit.json` and `.toolbox-backup.zip`), and
the Docker image.

Out of scope:

- An instance that runs with `AUTH_REQUIRED=false` on a port that other
  machines can reach. Turn sign-in on before exposing an instance on a shared
  network; see the [deployment guide](docs/deployment.md#2-securing-a-multi-tenant-instance).
- Problems in an AI provider, a SearXNG instance, an OIDC provider or another
  external service that you connect.
- Reports from automated scanners with no steps that show an impact.

## Verify the Docker image

CI signs a build provenance record for each published image. To check that an
image came from this repository's CI, run:

```bash
gh attestation verify oci://ghcr.io/arvarik/toolbox:latest --owner arvarik
```
