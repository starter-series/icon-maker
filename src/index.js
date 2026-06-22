const { makeIcons } = require('./generate');
const { renderSvg } = require('./svg');
const { detectTargets, resolveTargets, TARGETS } = require('./targets');
const { defaultConfig, loadConfig, validateConfig } = require('./config');

module.exports = {
  TARGETS,
  defaultConfig,
  detectTargets,
  loadConfig,
  makeIcons,
  renderSvg,
  resolveTargets,
  validateConfig,
};
