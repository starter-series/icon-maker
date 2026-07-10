const fs = require('fs');
const path = require('path');
const { CONFIG_NAME, renderDefaultConfig, renderDefaultJsonConfig, resolveConfigPath } = require('./config');

const USAGE = `icon-maker — compile one icon source for launch surfaces

Usage: icon-maker [path] [options]

Arguments:
  path                repo to run against (default: current directory)

Options:
  --target <name>     target to generate: auto, apple, browser-extension, expo,
                      electron, vscode, pwa, mcp-connector, generic.
                      Repeatable or comma-separated. Default: config targets or auto.
  --config <path>     config file (default: icon-maker.config.json, then .js)
  --source <path>     compile a self-contained SVG or PNG without editing config
  --adaptive-source <path>
                      optional transparent Expo adaptive-icon foreground
  --brief             print an upstream image-generation/source request
  --direction-name <text>
                      optional name for a proposed direction
  --concept <text>    visual concept to review for --brief
  --expresses <text>  what the proposed direction should express
  --visual-metaphor <text>
                      concrete visual metaphor for the direction
  --mood <list>       comma-separated mood words for --brief
  --tradeoff <text>   principal design tradeoff accepted by the direction
  --palette <list>    optional comma-separated colors for --brief
  --avoid <list>      optional comma-separated motifs or styles to avoid
  --approve-direction confirm that the user approved this brief direction
  --placeholder       explicitly use the deterministic temporary mark
  --out-dir <path>    write generated files under this directory, grouped by target
  --patch             update known manifest/app/package icon fields after writing
  --preview           write icon-preview.html contact sheet next to the outputs
  --dry-run           compute outputs without writing files
  --init              write a config file if it does not exist; defaults to
                      icon-maker.config.js, or use --config for a custom path
  --json              stdout gets exactly one JSON object
  -h, --help          show this help

Exit codes: 0 ok · 1 runtime failure · 2 usage/init conflict
`;

function usageError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function readOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) throw usageError(`${option} requires a value`);
  return value;
}

function parseArgs(argv) {
  const opts = {
    targets: [],
    config: null,
    source: null,
    adaptiveSource: null,
    placeholder: false,
    outDir: null,
    patch: false,
    preview: false,
    dryRun: false,
    init: false,
    brief: false,
    directionName: null,
    concept: null,
    expresses: null,
    visualMetaphor: null,
    mood: null,
    tradeoff: null,
    palette: null,
    avoid: null,
    approveDirection: false,
    json: false,
    help: false,
    path: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--target') {
      opts.targets.push(...String(readOptionValue(argv, i, arg)).split(',').map((value) => value.trim()).filter(Boolean));
      i++;
    } else if (arg === '--config') {
      opts.config = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--source') {
      opts.source = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--adaptive-source') {
      opts.adaptiveSource = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--out-dir') {
      opts.outDir = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--direction-name') {
      opts.directionName = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--concept') {
      opts.concept = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--expresses') {
      opts.expresses = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--visual-metaphor') {
      opts.visualMetaphor = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--mood') {
      opts.mood = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--tradeoff') {
      opts.tradeoff = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--palette') {
      opts.palette = readOptionValue(argv, i, arg);
      i++;
    } else if (arg === '--avoid') {
      opts.avoid = readOptionValue(argv, i, arg);
      i++;
    }
    else if (arg === '--patch') opts.patch = true;
    else if (arg === '--preview') opts.preview = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--init') opts.init = true;
    else if (arg === '--brief') opts.brief = true;
    else if (arg === '--approve-direction') opts.approveDirection = true;
    else if (arg === '--placeholder') opts.placeholder = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (!arg.startsWith('-') && opts.path === null) opts.path = arg;
    else if (arg.startsWith('-')) throw usageError(`Unknown option: ${arg}`);
    else throw usageError(`Unexpected positional argument: ${arg}`);
  }
  if (opts.brief && opts.init) throw usageError('--brief cannot be combined with --init');
  if (opts.brief && opts.source) throw usageError('--brief cannot be combined with --source');
  if (opts.brief && opts.adaptiveSource) throw usageError('--brief cannot be combined with --adaptive-source');
  if (opts.init && opts.source) throw usageError('--init cannot be combined with --source');
  if (opts.init && opts.adaptiveSource) throw usageError('--init cannot be combined with --adaptive-source');
  if (opts.init && opts.placeholder) throw usageError('--init cannot be combined with --placeholder');
  if (opts.placeholder && (opts.source || opts.adaptiveSource)) {
    throw usageError('--placeholder cannot be combined with source options');
  }
  if (opts.brief && (opts.patch || opts.preview || opts.dryRun || opts.outDir || opts.placeholder)) {
    throw usageError('--brief cannot be combined with compile output options');
  }
  const hasDirectionOptions = opts.directionName || opts.concept || opts.expresses || opts.visualMetaphor
    || opts.mood || opts.tradeoff || opts.palette || opts.avoid || opts.approveDirection;
  if (hasDirectionOptions && !opts.brief) throw usageError('direction options require --brief');
  return opts;
}

function initConfig(cwd, targets = [], explicit = null) {
  const existingPath = explicit ? path.resolve(cwd, explicit) : resolveConfigPath(null, cwd);
  const configPath = existingPath || path.join(cwd, CONFIG_NAME);
  if (fs.existsSync(configPath)) {
    return { created: false, configPath };
  }
  const render = configPath.endsWith('.json') ? renderDefaultJsonConfig : renderDefaultConfig;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, render(cwd, targets.length ? targets : ['auto']));
  return { created: true, configPath };
}

function configStatus(cwd, explicit) {
  const configPath = resolveConfigPath(explicit, cwd);
  return { configPath };
}

module.exports = { USAGE, parseArgs, initConfig, configStatus, usageError };
