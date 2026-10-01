import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { prepareRelease, releaseMetadata } from '../scripts/release.mjs';

test('release channels come from the exact package version', () => {
  for (const version of ['0.0.1-alpha', '0.0.1-alpha.2', '1.2.3-rc.1', '1.2.3-0']) {
    assert.deepEqual(releaseMetadata(`v${version}`, { name: 'cordyceps', version }), {
      tag: `v${version}`, version, prerelease: true,
    });
  }
  assert.equal(releaseMetadata('v0.0.1', { name: 'cordyceps', version: '0.0.1' }).prerelease, false);
  assert.throws(() => releaseMetadata('v0.0.1-alpha', { name: 'cordyceps', version: '0.0.1' }), /must match/);
  assert.throws(() => releaseMetadata('v0.0.1', { name: 'wrong-package', version: '0.0.1' }), /package name/);
});

test('malformed release tags fail before producing metadata', () => {
  for (const tag of ['main', '0.0.1', 'v01.0.0', 'v0.0.1-alpha.01', 'v0.0.1-', 'v0.0.1-a..b', 'v0.0.1\nprerelease=false']) {
    assert.throws(() => releaseMetadata(tag, { name: 'cordyceps', version: tag.slice(1) }));
  }
});

async function withArtifact(version, fn) {
  const root = await mkdtemp(join(tmpdir(), 'cordyceps-release-test-'));
  try {
    const artifactDir = join(root, 'artifacts');
    const outputDir = join(root, 'release');
    await mkdir(artifactDir);
    await mkdir(join(root, 'package'));
    const manifest = { name: 'cordyceps', version };
    await writeFile(join(root, 'package', 'package.json'), JSON.stringify(manifest));
    const tarball = join(artifactDir, `cordyceps-${version}.tgz`);
    execFileSync('tar', ['-czf', tarball, '-C', root, 'package'], { timeout: 10_000 });
    await fn({ root, tarball, artifactDir, outputDir, manifest, tag: `v${version}`, repository: 'example/cordyceps' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('release assets preserve verified bytes and checksum with versioned install commands', async () => {
  await withArtifact('0.0.1-alpha', async options => {
    const result = await prepareRelease(options);
    const original = await readFile(options.tarball);
    assert.deepEqual(await readFile(join(options.outputDir, 'cordyceps.tgz')), original);
    const expected = createHash('sha256').update(original).digest('hex');
    assert.equal(result.checksum, expected);
    assert.equal(await readFile(join(options.outputDir, 'SHA256SUMS'), 'utf8'), `${expected}  cordyceps.tgz\n`);
    const notes = await readFile(join(options.outputDir, 'notes.md'), 'utf8');
    assert.match(notes, /npm install --save-dev https:\/\/github.com\/example\/cordyceps\/releases\/download\/v0.0.1-alpha\/cordyceps.tgz/);
    assert.match(notes, /shasum -a 256 -c SHA256SUMS &&/);
    assert.match(notes, /does not become the latest stable/);
    assert.doesNotMatch(notes, /releases\/latest/);
  });
});

test('stable release assets use stable metadata', async () => {
  await withArtifact('0.0.1', async options => {
    const result = await prepareRelease(options);
    assert.equal(result.prerelease, false);
    const notes = await readFile(join(options.outputDir, 'notes.md'), 'utf8');
    assert.match(notes, /releases\/download\/v0.0.1\/cordyceps.tgz/);
    assert.doesNotMatch(notes, /prerelease/);
  });
});

test('a renamed artifact cannot hide a mismatched packaged version', async () => {
  await withArtifact('0.0.1-alpha', async options => {
    await writeFile(join(options.root, 'package', 'package.json'), JSON.stringify({ name: 'cordyceps', version: '0.0.1' }));
    execFileSync('tar', ['-czf', options.tarball, '-C', options.root, 'package'], { timeout: 10_000 });
    await assert.rejects(prepareRelease(options), /must match/);
    await assert.rejects(readFile(join(options.outputDir, 'cordyceps.tgz')));
  });
});

test('ambiguous package artifacts are rejected', async () => {
  await withArtifact('0.0.1-alpha', async options => {
    await writeFile(join(options.artifactDir, 'unexpected.tgz'), 'not a package');
    await assert.rejects(prepareRelease(options), /exactly one matching verified package/);
  });
});
