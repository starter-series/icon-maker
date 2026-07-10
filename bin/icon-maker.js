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
const { makeDesignBrief } = require('../src/brief');
const { USAGE, parseArgs, initConfig, configStatus } = require('../src/cli');
const directStdoutWrite = process.stdout.write.bind(process.stdout);

function writeResult(opts, result) {
  if (opts.json) directStdoutWrite(`${JSON.stringify(result)}\n`);
  else if (result.ok) {
    if (result.kind === 'source-request') {
      directStdoutWrite(result.prompt.endsWith('\n') ? result.prompt : `${result.prompt}\n`);
      return;
    }
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
    if (opts.json) directStdoutWrite(`${JSON.stringify({ ok: true, kind: 'help', usage: USAGE })}\n`);
    else directStdoutWrite(USAGE);
    return;
  }
  if (opts.json) process.stdout.write = process.stderr.write.bind(process.stderr);

  const cwd = path.resolve(process.cwd(), opts.path || '.');
  if (opts.init) {
    const result = { ok: true, cwd, ...initConfig(cwd, opts.targets, opts.config), ...configStatus(cwd, opts.config) };
    writeResult(opts, result);
    return;
  }

  if (opts.brief) {
    const result = makeDesignBrief(null, {
      cwd,
      config: opts.config,
      targets: opts.targets,
      direction: {
        name: opts.directionName,
        concept: opts.concept,
        expresses: opts.expresses,
        metaphor: opts.visualMetaphor,
        mood: opts.mood,
        tradeoff: opts.tradeoff,
        palette: opts.palette,
        avoid: opts.avoid,
        approved: opts.approveDirection ? true : undefined,
      },
    });
    writeResult(opts, result);
    return;
  }

  const result = makeIcons(null, {
    cwd,
    config: opts.config,
    source: opts.source,
    adaptiveSource: opts.adaptiveSource,
    placeholder: opts.placeholder,
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
  if (process.argv.includes('--json')) directStdoutWrite(`${JSON.stringify({ ok: false, error: msg, code })}\n`);
  else console.error('[icon-maker] FAILED:', err && err.stack ? err.stack : err);
  process.exit(code);
});
