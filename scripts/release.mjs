import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseMetadata(tag, manifest) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(tag);
  assert(match, 'Use vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-prerelease (for example v0.0.1-alpha).');
  const prerelease = match[4] !== undefined;
  if (prerelease) {
    assert(match[4].split('.').every(part => !/^\d+$/.test(part) || !/^0\d/.test(part)),
      'Numeric prerelease identifiers must not have leading zeroes.');
  }
  assert.equal(manifest.name, 'cordyceps', 'Unexpected package name.');
  const version = tag.slice(1);
  assert.equal(manifest.version, version, 'Release tag must match package.json version.');
  return { tag, version, prerelease };
}

export async function prepareRelease({ tag, repository, manifest, artifactDir, outputDir }) {
  const metadata = releaseMetadata(tag, manifest);
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'Expected GitHub owner/repository.');
  const packages = (await readdir(artifactDir)).filter(name => name.endsWith('.tgz'));
  assert.deepEqual(packages, [`cordyceps-${metadata.version}.tgz`], 'Expected exactly one matching verified package.');
  const tarball = resolve(artifactDir, packages[0]);
  const packedManifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
    encoding: 'utf8', timeout: 10_000,
  }));
  releaseMetadata(tag, packedManifest);
  const bytes = await readFile(tarball);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  await mkdir(outputDir, { recursive: true });
  // Constant asset name enables /releases/latest/download/cordyceps.tgz.
  // Copy, never repack: these bytes passed the clean-consumer verification.
  await copyFile(tarball, join(outputDir, 'cordyceps.tgz'));
  await writeFile(join(outputDir, 'SHA256SUMS'), `${checksum}  cordyceps.tgz\n`);
  const url = `https://github.com/${repository}/releases/download/${tag}`;
  const notes = `## Install ${metadata.version}${metadata.prerelease ? ' (prerelease)' : ''}

Requires Node.js 22 or later. Install in your application's repository:

\`\`\`sh
npm install --save-dev ${url}/cordyceps.tgz
\`\`\`

Or download, verify the checksum, and install:

\`\`\`sh
curl --fail --location --output cordyceps.tgz ${url}/cordyceps.tgz &&
curl --fail --location --output SHA256SUMS ${url}/SHA256SUMS &&
shasum -a 256 -c SHA256SUMS &&
npm install --save-dev ./cordyceps.tgz
\`\`\`

On Linux, \`sha256sum -c SHA256SUMS\` can replace \`shasum -a 256 -c SHA256SUMS\`.
The optional \`cordyceps/playwright\` entry point also requires \`@playwright/test\`.
${metadata.prerelease ? '\nThis prerelease does not become the latest stable release. Use the versioned URL above.\n' : ''}
The attached npm package passed clean Node and Playwright installation checks.
The release is gated on the full library and real-consumer CI suite.
`;
  await writeFile(join(outputDir, 'notes.md'), notes);
  return { ...metadata, checksum };
}

async function main() {
  const [command, artifactDir, outputDir] = process.argv.slice(2);
  assert(['validate', 'prepare'].includes(command), 'Usage: node scripts/release.mjs validate | prepare <artifacts> <output>');
  assert.equal(process.env.GITHUB_REF_TYPE, 'tag', 'Run releases from a version tag, not a branch.');
  const tag = process.env.GITHUB_REF_NAME;
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const metadata = releaseMetadata(tag, manifest);
  if (command === 'validate') {
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `tag=${metadata.tag}\nprerelease=${metadata.prerelease}\n`);
    }
    console.log(JSON.stringify(metadata));
  } else {
    assert(artifactDir && outputDir, 'Provide artifact and output directories.');
    console.log(JSON.stringify(await prepareRelease({
      tag, repository: process.env.GITHUB_REPOSITORY, manifest, artifactDir, outputDir,
    })));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
