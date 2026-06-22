# Security guidance

This file is read by Anthropic's Claude Code Security Guidance Plugin as an
in-session guard while Claude writes code. It complements the
`claude-code-security-review` GitHub Action and the repo-level
`audit_security` check.

## Universal rules

- Never log secrets, tokens, cookies, or raw environment values.
- Never use `eval`, `Function()`, dynamic imports of untrusted strings, or
  shell execution for config values.
- Validate config files and CLI arguments before writing any files.
- Keep `.env*` files out of git. Use examples with placeholder values only.
- Publish with OIDC trusted publishing only; do not add long-lived npm tokens.

## Icon Maker rules

- `--json` stdout must remain exactly one parseable JSON object.
- `--patch` may only update known icon fields in known manifest files. Preserve
  indentation and line endings.
- Resolve output paths under the selected project root unless the caller passes
  an explicit, reviewed absolute path.
- Treat custom SVG sources as untrusted text. Do not execute scripts or load
  external resources from SVG content.
- Keep generation deterministic: same config and source files means same asset
  paths and metadata.
