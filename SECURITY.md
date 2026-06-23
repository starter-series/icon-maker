# Security Policy

## Supported Versions

Before the first npm release, security fixes land on `main` and are verified by
CI. After `@starter-series/icon-maker` is published, fixes ship on the latest
published npm version.

## Reporting a Vulnerability

Please report security issues privately through GitHub security advisories on
the repository, or contact the maintainer directly if advisories are not yet
available.

## Notes

`icon-maker` is a local file-generation tool. It does not call external image
services, read credentials, or make network requests at runtime. Use `--patch`
only when you want it to update known icon fields in local project manifests.
