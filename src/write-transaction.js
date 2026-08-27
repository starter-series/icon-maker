const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assertContainedOutputPath } = require('./path-safety');

function usageError(message) {
  const err = new Error(message);
  err.exitCode = 2;
  return err;
}

function lstatIfPresent(file) {
  try {
    return fs.lstatSync(file);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function validateWritePath(root, file, label = 'write target') {
  const absolutePath = path.resolve(root, file);
  assertContainedOutputPath(root, absolutePath, label);
  const stat = lstatIfPresent(absolutePath);
  if (stat?.isSymbolicLink()) {
    throw usageError(`icon-maker: ${label} must not be a symbolic link: ${absolutePath}`);
  }
  if (stat && !stat.isFile()) {
    throw usageError(`icon-maker: ${label} must be a regular file: ${absolutePath}`);
  }
  return absolutePath;
}

function contentBuffer(contents) {
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
}

function removeIfPresent(file) {
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
}

function ensureParentDirectories(root, file, createdDirectories) {
  const missing = [];
  let directory = path.dirname(file);
  while (!fs.existsSync(directory)) {
    missing.push(directory);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  assertContainedOutputPath(root, path.dirname(file), 'output directory');
  for (const candidate of missing.reverse()) {
    try {
      fs.mkdirSync(candidate);
      createdDirectories.push(candidate);
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
      const stat = fs.lstatSync(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw usageError(`icon-maker: output directory must be a real directory: ${candidate}`);
      }
    }
    assertContainedOutputPath(root, candidate, 'output directory');
  }
}

function cleanupDirectories(createdDirectories) {
  for (const directory of [...createdDirectories].reverse()) {
    try {
      fs.rmdirSync(directory);
    } catch (err) {
      if (!err || !['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(err.code)) throw err;
    }
  }
}

function temporarySibling(file, nonce, kind, index) {
  return path.join(path.dirname(file), `.${path.basename(file)}.iconkit-${kind}-${process.pid}-${nonce}-${index}`);
}

function readCurrent(file) {
  const stat = lstatIfPresent(file);
  if (!stat) return { exists: false, contents: null, mode: null };
  if (stat.isSymbolicLink()) {
    throw usageError(`icon-maker: write target must not be a symbolic link: ${file}`);
  }
  if (!stat.isFile()) {
    throw usageError(`icon-maker: write target must be a regular file: ${file}`);
  }
  return { exists: true, contents: fs.readFileSync(file), mode: stat.mode & 0o777 };
}

function assertCurrentMatches(record) {
  validateWritePath(record.root, record.path);
  const current = readCurrent(record.path);
  if (current.exists !== record.original.exists) {
    throw new Error(`icon-maker: write target changed while preparing transaction: ${record.path}`);
  }
  if (current.exists && !current.contents.equals(record.original.contents)) {
    throw new Error(`icon-maker: write target changed while preparing transaction: ${record.path}`);
  }
}

function stageRecord(record) {
  ensureParentDirectories(record.root, record.path, record.createdDirectories);
  validateWritePath(record.root, record.path);
  const descriptor = fs.openSync(record.temporaryPath, 'wx', record.original.mode ?? 0o666);
  try {
    fs.writeFileSync(descriptor, record.contents);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  if (record.original.exists) {
    fs.copyFileSync(record.path, record.backupPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(record.backupPath, record.original.mode);
  }
}

function rollback(records, renameSync) {
  const errors = [];
  for (const record of [...records].reverse()) {
    try {
      if (record.installed) {
        if (record.original.exists) {
          try {
            renameSync(record.backupPath, record.path);
            record.backupRestored = true;
          } catch (renameError) {
            const current = readCurrent(record.path);
            if (current.exists && current.contents.equals(record.original.contents)) {
              record.backupRestored = true;
            } else {
              try {
                fs.copyFileSync(record.backupPath, record.path);
                fs.chmodSync(record.path, record.original.mode);
                const restored = readCurrent(record.path);
                if (!restored.exists || !restored.contents.equals(record.original.contents)) {
                  throw new Error(
                    `icon-maker: rollback copy verification failed: ${record.path}`,
                    { cause: renameError },
                  );
                }
                record.backupRestored = true;
              } catch (copyError) {
                const restoreError = new Error(
                  `icon-maker: could not restore transaction backup for ${record.path}; ` +
                  `rename failed first: ${renameError.message}`,
                  { cause: copyError },
                );
                restoreError.renameError = renameError;
                throw restoreError;
              }
            }
          }
        } else {
          removeIfPresent(record.path);
        }
      }
    } catch (err) {
      errors.push(err);
    }
    try {
      removeIfPresent(record.temporaryPath);
      const originalStillInPlace = record.original.exists && !record.installed;
      if (record.backupRestored || originalStillInPlace) removeIfPresent(record.backupPath);
    } catch (err) {
      errors.push(err);
    }
  }
  try {
    cleanupDirectories(records[0]?.createdDirectories || []);
  } catch (err) {
    errors.push(err);
  }
  return errors;
}

function prepareRecords(root, entries) {
  const nonce = crypto.randomBytes(6).toString('hex');
  const createdDirectories = [];
  const unique = [];
  const byPath = new Map();
  const entryRecords = [];

  for (const [index, entry] of entries.entries()) {
    const absolutePath = validateWritePath(root, entry.path, entry.label || 'write target');
    const contents = contentBuffer(entry.contents);
    const previous = byPath.get(absolutePath);
    if (previous) {
      if (!previous.contents.equals(contents)) {
        throw usageError(`icon-maker: transaction plans different contents for ${absolutePath}`);
      }
      entryRecords.push({ record: previous, duplicate: true });
      continue;
    }
    const original = readCurrent(absolutePath);
    const record = {
      root,
      path: absolutePath,
      contents,
      original,
      changed: !original.exists || !original.contents.equals(contents),
      temporaryPath: temporarySibling(absolutePath, nonce, 'tmp', index),
      backupPath: temporarySibling(absolutePath, nonce, 'backup', index),
      createdDirectories,
      installed: false,
      backupRestored: false,
    };
    byPath.set(absolutePath, record);
    unique.push(record);
    entryRecords.push({ record, duplicate: false });
  }
  return { createdDirectories, entryRecords, unique };
}

function commitWriteTransaction(root, entries, options = {}) {
  if (!entries.length) return [];
  const renameSync = options.renameSync || fs.renameSync;
  const { createdDirectories, entryRecords, unique } = prepareRecords(root, entries);
  const changed = unique.filter((record) => record.changed);

  try {
    for (const record of changed) stageRecord(record);
    for (const record of changed) {
      assertCurrentMatches(record);
      renameSync(record.temporaryPath, record.path);
      record.installed = true;
    }
  } catch (err) {
    const rollbackErrors = rollback(changed, renameSync);
    if (rollbackErrors.length) err.rollbackErrors = rollbackErrors;
    throw err;
  }

  for (const record of changed) {
    try {
      removeIfPresent(record.backupPath);
    } catch (_err) {
      // A leftover private backup is safer than failing after the transaction
      // has committed and no longer has a complete rollback set.
    }
  }
  if (!changed.length) cleanupDirectories(createdDirectories);

  return entryRecords.map(({ record, duplicate }) => ({
    path: record.path,
    written: record.changed && !duplicate,
  }));
}

module.exports = { commitWriteTransaction, validateWritePath };
