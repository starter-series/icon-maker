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

`--source` and configured SVG/PNG sources must resolve inside the target
directory. SVG outputs preserve a trusted source after optional removal of one
exact Markdown code fence, so an SVG containing scripts or event-handler
attributes can remain active when opened or served in a browser. Only compile
SVG files you authored or trust. Apple catalog output is also restricted to
the target directory; when multiple `.xcassets` directories exist, select one
explicitly with `apple.assetCatalog`.

Generated output paths are resolved before rendering and must remain inside the
target checkout after following existing symlinks. A generated file may not
overwrite its own SVG/PNG source. Existing Xcode App Icon sets that reference
files not owned by icon-maker are treated as externally managed and are not
replaced; select a new `apple.appIconSet` instead.
