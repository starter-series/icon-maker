# Security Policy

## Supported Versions

Before the first npm release, security fixes land on `main` and are verified by
CI. After `iconkit` is published, fixes ship on the latest
published npm version.

## Reporting a Vulnerability

Please report security issues privately through GitHub security advisories on
the repository.

## Notes

`icon-maker` is a local file-generation tool. Its built-in behavior does not
call external image services, read credentials, or make network requests at
runtime. Use `--patch` only when you want it to update known icon fields in
local project manifests.

Config files are loaded from the target directory. An `icon-maker.config.json`
is parsed as data only and never executed. An `icon-maker.config.js` is executed
as Node.js code, so it can do anything Node can — treat it like any script you
run. To avoid this, `icon-maker` refuses to auto-execute a `.js` config that is
discovered inside a target directory other than your own working directory;
prefer `icon-maker.config.json` when running against untrusted checkouts, or
pass `--config` explicitly to opt in to a specific `.js` file.
