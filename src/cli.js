const fs = require('fs');
const path = require('path');
const { CONFIG_NAME, renderDefaultConfig, resolveConfigPath } = require('./config');

const USAGE = `icon-maker — generate deterministic icon sets for launch surfaces

Usage: icon-maker [path] [options]

Arguments:
  path                repo to run against (default: current directory)

Options:
  --target <name>     target to generate: auto, browser-extension, expo,
                      electron, vscode, pwa, mcp-connector, generic.
                      Repeatable or comma-separated. Default: config targets or auto.
  --config <path>     config file (default: icon-maker.config.js if present)
  --out-dir <path>    write generated files under this directory, grouped by target
  --patch             update known manifest/app/package icon fields after writing
  --preview           write icon-preview.html contact sheet next to the outputs
  --dry-run           compute outputs without writing files
  --init              write icon-maker.config.js if it does not exist;
                      combine with --target for a target-specific preset
  --json              stdout gets exactly one JSON object
  -h, --help          show this help

Exit codes: 0 ok · 1 runtime failure · 2 usage/init conflict
`;

function parseArgs(argv) {
  const opts = {
    targets: [],
    config: null,
    outDir: null,
    patch: false,
    preview: false,
    dryRun: false,
    init: false,
    json: false,
    help: false,
    path: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target') opts.targets.push(...String(argv[++i] || '').split(',').filter(Boolean));
    else if (arg === '--config') opts.config = argv[++i];
    else if (arg === '--out-dir') opts.outDir = argv[++i];
    else if (arg === '--patch') opts.patch = true;
    else if (arg === '--preview') opts.preview = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--init') opts.init = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (!arg.startsWith('-') && opts.path === null) opts.path = arg;
  }
  return opts;
}

function initConfig(cwd, targets = []) {
  const configPath = path.join(cwd, CONFIG_NAME);
  if (fs.existsSync(configPath)) {
    return { created: false, configPath };
  }
  fs.writeFileSync(configPath, renderDefaultConfig(cwd, targets.length ? targets : ['auto']));
  return { created: true, configPath };
}

function configStatus(cwd, explicit) {
  const configPath = resolveConfigPath(explicit, cwd);
  return { configPath };
}

module.exports = { USAGE, parseArgs, initConfig, configStatus };
