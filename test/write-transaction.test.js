const fs = require('fs');
const os = require('os');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { commitWriteTransaction } = require('../src/write-transaction');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'icon-maker-transaction-'));
}

function transactionArtifacts(cwd) {
  const found = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.name.includes('.iconkit-')) found.push(absolutePath);
    }
  }
  visit(cwd);
  return found;
}

describe('write transaction', () => {
  test('commits changed files through sibling temporary files and skips unchanged content', () => {
    const cwd = tempDir();
    const existing = path.join(cwd, 'existing.txt');
    const created = path.join(cwd, 'nested', 'created.txt');
    fs.writeFileSync(existing, 'before');

    const first = commitWriteTransaction(cwd, [
      { path: existing, contents: 'after' },
      { path: created, contents: 'created' },
    ]);
    assert.deepEqual(first.map((result) => result.written), [true, true]);
    assert.equal(fs.readFileSync(existing, 'utf8'), 'after');
    assert.equal(fs.readFileSync(created, 'utf8'), 'created');
    if (process.platform !== 'win32') {
      fs.chmodSync(existing, 0o640);
      commitWriteTransaction(cwd, [{ path: existing, contents: 'mode-preserved' }]);
      assert.equal(fs.statSync(existing).mode & 0o777, 0o640);
    }
    assert.deepEqual(transactionArtifacts(cwd), []);

    const second = commitWriteTransaction(cwd, [
      { path: existing, contents: process.platform === 'win32' ? 'after' : 'mode-preserved' },
      { path: created, contents: 'created' },
    ]);
    assert.deepEqual(second.map((result) => result.written), [false, false]);
    assert.deepEqual(transactionArtifacts(cwd), []);
  });

  test('restores originals and removes new files when a batch rename fails', () => {
    const cwd = tempDir();
    const first = path.join(cwd, 'first.txt');
    const second = path.join(cwd, 'second.txt');
    const created = path.join(cwd, 'new', 'created.txt');
    fs.writeFileSync(first, 'first-before');
    fs.writeFileSync(second, 'second-before');
    let renameCount = 0;
    const renameSync = (from, to) => {
      renameCount += 1;
      if (renameCount === 2) throw new Error('injected rename failure');
      fs.renameSync(from, to);
    };

    assert.throws(
      () => commitWriteTransaction(cwd, [
        { path: first, contents: 'first-after' },
        { path: second, contents: 'second-after' },
        { path: created, contents: 'created' },
      ], { renameSync }),
      /injected rename failure/,
    );
    assert.equal(fs.readFileSync(first, 'utf8'), 'first-before');
    assert.equal(fs.readFileSync(second, 'utf8'), 'second-before');
    assert.equal(fs.existsSync(created), false);
    assert.equal(fs.existsSync(path.dirname(created)), false);
    assert.deepEqual(transactionArtifacts(cwd), []);
  });

  test('preserves the original through a verified copy when rollback rename also fails', () => {
    const cwd = tempDir();
    const first = path.join(cwd, 'first.txt');
    const second = path.join(cwd, 'second.txt');
    fs.writeFileSync(first, 'first-before');
    fs.writeFileSync(second, 'second-before');
    let renameCount = 0;
    const renameSync = (from, to) => {
      renameCount += 1;
      if (renameCount > 1) throw new Error('injected persistent rename failure');
      fs.renameSync(from, to);
    };

    assert.throws(
      () => commitWriteTransaction(cwd, [
        { path: first, contents: 'first-after' },
        { path: second, contents: 'second-after' },
      ], { renameSync }),
      /injected persistent rename failure/,
    );
    assert.equal(fs.readFileSync(first, 'utf8'), 'first-before');
    assert.equal(fs.readFileSync(second, 'utf8'), 'second-before');
    assert.deepEqual(transactionArtifacts(cwd), []);
  });

  test('rejects a leaf symlink instead of following it', { skip: process.platform === 'win32' }, () => {
    const cwd = tempDir();
    const outside = tempDir();
    const externalFile = path.join(outside, 'manifest.json');
    const linkedFile = path.join(cwd, 'manifest.json');
    fs.writeFileSync(externalFile, 'outside');
    fs.symlinkSync(externalFile, linkedFile, 'file');

    assert.throws(
      () => commitWriteTransaction(cwd, [{ path: linkedFile, contents: 'changed' }]),
      { exitCode: 2, message: /patch target|write target|resolves outside|symbolic link/ },
    );
    assert.equal(fs.readFileSync(externalFile, 'utf8'), 'outside');
  });
});
