// Consumer-owned executable lifecycle; no credentials inherited from the host.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
export async function isolated(fn) {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.versions.bun, undefined, 'Use real Node');
  const root = await realpath(await mkdtemp('/tmp/cordyceps-vendor-'));
  const home = join(root, 'home'), work = join(root, 'work');
  await mkdir(home); await mkdir(work);
  const env = { HOME: home, PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: root,
    XDG_CONFIG_HOME: join(home,'.config'), XDG_DATA_HOME: join(home,'.local/share'), XDG_CACHE_HOME: join(home,'.cache'),
    BROWSER:'/usr/bin/false', NO_OPEN_BROWSER:'1', TERM:'dumb', NO_COLOR:'1', DO_NOT_TRACK:'1', OTEL_SDK_DISABLED:'true',
    NO_PROXY:'localhost,127.0.0.1', DISABLE_AUTOUPDATER:'1' };
  async function launch(binary, args, extra = {}, writable = [], timeout = 20000) {
    const paths = await Promise.all([root,...writable].map(p=>realpath(p)));
    const profile = `(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))
      (deny mach-lookup (global-name "com.apple.securityd"))(deny file-read* (subpath ${JSON.stringify(join(homedir(), 'Library/Keychains'))}))
      (deny process-exec (literal "/usr/bin/open"))(deny file-write*)
      (allow file-write* (literal "/dev/null") (literal "/dev/tty") ${paths.map(p=>`(subpath ${JSON.stringify(p)})`).join(' ')})`;
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, binary, ...args], { cwd:work, env:{...env,...extra}, detached:true, stdio:['ignore','pipe','pipe'] });
    let stdout='', stderr='', timedOut=false;
    child.stdout.on('data',b=>stdout+=b); child.stderr.on('data',b=>stderr+=b);
    const kill=()=>{try{process.kill(-child.pid,'SIGKILL')}catch(e){if(e.code!=='ESRCH')throw e}};
    const timer=setTimeout(()=>{timedOut=true;kill()},timeout);
    try { const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}))}); return {binary,args,...status,timedOut,stdout,stderr}; }
    finally {clearTimeout(timer);kill()}
  }
  try { return await fn({root,home,work,env,launch}); } finally {await rm(root,{recursive:true,force:true})}
}
