# Security Policy

## Supported versions

Only the latest published `1.x` release receives security fixes. Older versions are not
maintained — upgrade with `npm i -g inup@latest` (or run `npx inup@latest`).

## Reporting a vulnerability

Please **do not open a public issue** for security reports.

Report privately via
[GitHub Security Advisories](https://github.com/donfear/inup/security/advisories/new)
("Report a vulnerability" on the repository's Security tab). Include:

- the inup version (`inup --version`) and how you invoked it (CLI, GitHub Action),
- a minimal reproduction or proof of concept,
- the impact you believe it has (e.g. writing files outside the project, leaking registry
  credentials, executing unexpected commands).

You can expect an acknowledgement within a few days. Once a fix is released, the advisory is
published and credited to you unless you prefer otherwise.

## Scope notes

Reports are especially welcome in areas where inup touches sensitive machinery:

- **Registry credentials** — inup reads the `.npmrc` chain (auth tokens, scoped registries)
  to query registries. Any path by which those credentials could leak (logs, reports, cache
  files) is in scope.
- **File writes** — `--apply` and the interactive confirm write `package.json` /
  `pnpm-workspace.yaml` and run the package manager's install. Writes outside the scanned
  project, or writes that ignore `.inuprc` `ignore`/`exclude`, are in scope.
- **Command execution** — inup shells out to npm/yarn/pnpm/bun for the install step. Any
  injection into those commands is in scope.
- **The GitHub Action** — input handling is documented in `action.yml`; inputs are passed via
  environment variables, never interpolated into shell. Bypasses are in scope.

Vulnerabilities in the packages inup *reports on* are out of scope — inup only reads the same
advisory data as `npm audit`.
