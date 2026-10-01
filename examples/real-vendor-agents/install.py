#!/usr/bin/env python3
"""Consumer tooling: fetch official current distributions into a caller-owned scratch root.
No vendor installer is executed. No login or shell/profile edits.
"""
import argparse
import gzip
import hashlib
import json
import os
import platform
from pathlib import Path
import subprocess
import tarfile
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('root', type=Path)
parser.add_argument('--agents', default='ante,fx,grok,muse,devin,minimax')
args = parser.parse_args()
if platform.system() != 'Darwin' or platform.machine() != 'arm64':
    raise SystemExit('These recorded distribution selectors require macOS arm64')
root = args.root.resolve()
root.mkdir(parents=True, exist_ok=True)
records = []

def fetch(url):
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read()

def document(url):
    return json.loads(fetch(url))

def install(name, url, kind='tar', checksum=None, size=None):
    data = fetch(url)
    actual = hashlib.sha256(data).hexdigest()
    if checksum and actual != checksum:
        raise ValueError(f'{name}: official checksum mismatch')
    if size and len(data) != size:
        raise ValueError(f'{name}: official size mismatch')
    archive = root / (name + '.download')
    archive.write_bytes(data)
    if kind == 'tar':
        target = root / name
        target.mkdir(exist_ok=True)
        with tarfile.open(archive, 'r:gz') as bundle:
            bundle.extractall(target, filter='data')
    else:
        target = root / name if name == 'muse' else root / name / name
        target.parent.mkdir(exist_ok=True)
        target.write_bytes(gzip.decompress(data) if kind == 'gzip' else data)
        target.chmod(0o755)
    records.append(dict(name=name, url=url, sha256=actual, checksumVerified=bool(checksum)))

for name in args.agents.split(','):
    if name == 'ante':
        manifest = document('https://download.ante.run/channels/stable/manifest.json')
        a = manifest['binaries']['darwin-arm64']
        install(name, a['url'], checksum=a['sha256'], size=a['size'])
    elif name == 'devin':
        manifest = document('https://static.devin.ai/cli/current/manifest.json')
        a = manifest['platforms']['aarch64-apple-darwin']
        install(name, a['url'], checksum=a['sha256'])
    elif name == 'fx':
        version = fetch('https://releases.fx.sh/latest.txt').decode().strip()
        install(name, f'https://releases.fx.sh/{version}/fx-macos-aarch64.tar.gz')
    elif name == 'grok':
        base = 'https://x.ai/cli'
        version = fetch(base + '/stable').decode().strip()
        install(name, f'{base}/grok-{version}-macos-aarch64.gz', 'gzip')
    elif name == 'muse':
        channel = document('https://api.meta.ai/muse-code/channels/muse-stable')
        manifest = document(channel['manifest_url'])
        a = manifest['artifacts']['aarch64_macos']
        install(name, a['url'], 'binary', a['checksum'], a['size'])
    elif name == 'minimax':
        target = root / name
        target.mkdir(exist_ok=True)
        # Put real Node first on PATH. Use a scratch cwd as well as scratch prefix.
        install_home = root / 'install-home'
        install_home.mkdir(exist_ok=True)
        install_env = {'PATH': os.environ['PATH'], 'HOME': str(install_home)}
        subprocess.run(['npm', 'install', '--prefix', str(target), '@minimax-ai/code@latest',
                        '--registry=https://registry.npmjs.org', '--include=optional',
                        '--no-audit', '--no-fund'], cwd=target, env=install_env, check=True)
        package = json.loads((target / 'node_modules/@minimax-ai/code/package.json').read_text())
        records.append(dict(name=name, package=package['name'], version=package['version']))
    else:
        raise ValueError(f'Unknown distribution {name}; TRAE is region-blocked on the recorded host')
    (root / 'install-evidence.json').write_text(json.dumps(records, indent=2) + '\n')
    print(f'{name}: installed official distribution under {root}', flush=True)
