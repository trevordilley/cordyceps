// Explicit developer setup, never imported or invoked by Cordyceps/the verifier.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
assert.equal(process.platform, 'darwin');
assert.equal(process.arch, 'arm64', 'These pinned official artifacts are for macOS arm64');
const destination = resolve(process.argv[2] ?? '/tmp/cordyceps-pi-tools');
await mkdir(destination, { recursive: true });
const artifacts = [
  { directory: 'prime',
    url: 'https://pub-728493de92a943e2a9b2d17b4719f318.r2.dev/releases/v0.9.8/prime-agent-0.9.8-darwin-arm64.tar.gz',
    sha256: '078c9abd519978ef27f6404367e37a2981267db47f1b95b60940ea7fe6ead8b9' },
  { directory: 'zcode-glm',
    url: 'https://cdn-zcode.z.ai/zcode/electron/releases/components/darwin-arm64/glm/v0.13.3%2B464dc03681ff.tar.gz',
    sha256: '464dc03681ff59fb43dbc9b36201b186b7f6ba1d1f18feaa89b8228ae771182a',
    providerConfigUrl: 'https://raw.githubusercontent.com/zai-org/ZCode/29628c9acdb81b703bbd4080c207a0e7ce5e276e/config/provider/zcode-builtin.json',
    providerConfigSha256: '0b3d735e0c2334353eecadfa8c0756a1a19fc4f7938fc62882048d6630c5f424' },
];
for (const artifact of artifacts) {
  const target = join(destination, artifact.directory);
  let exists = false;
  try { await access(target); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert.equal(exists, false, `Choose a fresh destination: ${target} already exists`);
  const staging = await mkdtemp(join(destination, '.download-'));
  try {
    const response = await fetch(artifact.url, { signal: AbortSignal.timeout(120_000) });
    assert.equal(response.ok, true, `${response.status}: ${artifact.url}`);
    const archive = join(staging, 'artifact.tar.gz');
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), artifact.sha256);
    const extracted = join(staging, 'extracted'); await mkdir(extracted);
    const result = spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', extracted], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    if (artifact.providerConfigUrl) {
      // The Desktop component omits this standalone-CLI catalog; use unmodified official source.
      const catalog = await fetch(artifact.providerConfigUrl, { signal: AbortSignal.timeout(30_000) });
      assert.equal(catalog.ok, true);
      const bytes = Buffer.from(await catalog.arrayBuffer());
      assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.providerConfigSha256);
      await mkdir(join(extracted, 'provider'), { recursive: true });
      await writeFile(join(extracted, 'provider/zcode-builtin.json'), bytes);
    }
    await rename(extracted, target);
    await writeFile(join(destination, `${artifact.directory}-artifact.json`), JSON.stringify(artifact, null, 2) + '\n');
    console.log(JSON.stringify({ ...artifact, target }));
  } finally { await rm(staging, { recursive: true, force: true }); }
}
