## What changes and why

<!-- Start with one plain sentence: what this pull request adds and why it matters. Then say what was wrong and what changes. -->

## Testing

<!-- The exact commands you ran and their pass counts. Say what did not run. -->

## Checklist

- [ ] The pull request targets `main`, and its title is a plain sentence that says what the change does
- [ ] Tests cover the change, and a bug fix has a test that fails without it
- [ ] Tenant-scoped queries use `scopeOf(req)` and `server/platform/*` does not import domain modules
- [ ] Affected documentation (`docs/`, `README.md`) is updated when behavior changes
- [ ] `npm run lint`, `npm run audit:contrast`, and `npm test` pass
- [ ] After a change to UI routes, dialogs, forms, or sign-in, `npm run build && npm run test:e2e` passes
