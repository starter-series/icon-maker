const fs = require('fs');
const path = require('path');

function usageError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  const escapes = relative === '..' || relative.startsWith(`..${path.sep}`);
  return relative === '' || (!escapes && !path.isAbsolute(relative));
}

function assertContainedExistingPath(root, candidate, label) {
  const logicalCandidate = path.resolve(candidate);
  const realRoot = fs.realpathSync(path.resolve(root));
  const realCandidate = fs.realpathSync(logicalCandidate);
  if (!isContainedPath(realRoot, realCandidate)) {
    throw usageError(`icon-maker: ${label} must stay inside the target directory: ${logicalCandidate}`);
  }
  return realCandidate;
}

function assertContainedOutputPath(root, candidate, label = 'output path') {
  const logicalRoot = path.resolve(root);
  const logicalCandidate = path.resolve(candidate);
  if (!isContainedPath(logicalRoot, logicalCandidate)) {
    throw usageError(`icon-maker: ${label} must stay inside the target directory: ${logicalCandidate}`);
  }

  const realRoot = fs.realpathSync(logicalRoot);
  let existing = logicalCandidate;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (!isContainedPath(realRoot, fs.realpathSync(existing))) {
    throw usageError(`icon-maker: ${label} resolves outside the target directory: ${logicalCandidate}`);
  }
  return logicalCandidate;
}

function sameRealFile(left, right) {
  if (!left || !right) return false;
  if (path.resolve(left) === path.resolve(right)) return true;
  if (!fs.existsSync(left) || !fs.existsSync(right)) return false;
  return fs.realpathSync(left) === fs.realpathSync(right);
}

module.exports = {
  assertContainedExistingPath,
  assertContainedOutputPath,
  isContainedPath,
  sameRealFile,
};
