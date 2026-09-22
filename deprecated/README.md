# Deprecated

Kept for reference only. Nothing in here is built, tested, deployed or scanned by inup:

- `website/` — the former Astro site (donfear.github.io/inup). It is no longer part of the pnpm
  workspace and its deploy workflow now lives at `website/deploy-workflow.yml`, outside
  `.github/workflows`, so it never runs. The last deployed version stays live on GitHub Pages
  until Pages is turned off in the repo settings. Its English docs pages now live in
  `docs/guide/`, which is what the README and `inup --init` link to.
