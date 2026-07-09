#!/usr/bin/env node
/*
 * icon-maker CLI — thin wrapper over makeIcons().
 *
 * Exit codes: 0 ok · 1 runtime failure · 2 usage/init conflict.
 * With --json, stdout carries exactly one JSON object and progress logs go
 * to stderr, so agents can parse stdout blindly.
 */

const path = require('path');
const { makeIcons } = require('../src');
const { USAGE, parseArgs, initConfig, configStatus } = require('../src/cli');

function writeResult(opts, result) {
  if (opts.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result.ok) {
    if (result.configPath && Object.prototype.hasOwnProperty.call(result, 'created')) {
      const verb = result.created ? 'created' : 'exists';
      console.log(`[icon-maker] ${verb}: ${path.relative(result.cwd, result.configPath)}`);
    }
    for (const item of result.produced || []) {
      console.log(`[icon-maker] ${item.target}: ${path.relative(result.cwd, item.path)}`);
    }
    for (const patch of result.patches || []) {
      console.log(`[icon-maker] patched ${path.relative(result.cwd, patch.file)} (${patch.action})`);
    }
    if (result.preview) {
      console.log(`[icon-maker] preview: ${path.relative(result.cwd, result.preview.path)}`);
    }
    for (const warning of result.warnings || []) {
      console.warn(`[icon-maker] warning ${warning.code}: ${warning.message}`);
    }
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  const cwd = path.resolve(process.cwd(), opts.path || '.');
  if (opts.init) {
    const result = { ok: true, cwd, ...initConfig(cwd, opts.targets), ...configStatus(cwd, opts.config) };
    writeResult(opts, result);
    return;
  }

  const result = makeIcons(null, {
    cwd,
    config: opts.config,
    targets: opts.targets,
    outDir: opts.outDir,
    patch: opts.patch,
    preview: opts.preview,
    write: !opts.dryRun,
  });
  writeResult(opts, result);
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  const code = err && err.exitCode ? err.exitCode : 1;
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ ok: false, error: msg, code })}\n`);
  else console.error('[icon-maker] FAILED:', err && err.stack ? err.stack : err);
  process.exit(code);
});
