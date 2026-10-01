import { lstat, mkdir, realpath, rmdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Environment } from './injection.js';

export interface ClaudeSettingsOptions {
  /** An explicitly supplied disposable home. Existing Claude files are never overwritten. */
  home: string;
}
export interface ClaudeSettingsInstallation {
  home: string;
  configDir: string;
  settingsPath: string;
  /** Uses apiKeyHelper instead of an environment API key that may need approval. */
  environment(base: Environment): Environment;
}

/** Session-owned setup; it never changes the caller's environment or starts Claude. */
export async function installClaudeSettings(options: ClaudeSettingsOptions, baseUrl: string, apiKey: string,
  providerEnvironment: (base: Environment) => Environment): Promise<ClaudeSettingsInstallation & { dispose(): Promise<void> }> {
  if (process.platform === 'win32') throw new Error('Claude apiKeyHelper setup currently requires a POSIX shell');
  if (!isAbsolute(options.home)) throw new TypeError('Claude settings require an absolute disposable home path');
  let madeHome = false, madeConfig = false;
  const owned: string[] = [];
  let home = options.home;
  let configDir = join(home, '.claude');
  const dispose = async () => {
    for (const path of owned.splice(0).reverse()) await rm(path, { force: true });
    if (madeConfig) { await rm(configDir, { recursive: true, force: true }); madeConfig = false; }
    // Keep unrelated files the application may have placed in its disposable home.
    if (madeHome) {
      try { await rmdir(home); madeHome = false; }
      catch (error) { if (!['ENOTEMPTY', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
    }
  };
  try {
    try { await mkdir(home, { mode: 0o700 }); madeHome = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const stat = await lstat(home);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TypeError('Disposable home must be a directory, not a symlink');
    home = await realpath(home);
    configDir = join(home, '.claude');
    await mkdir(configDir, { mode: 0o700 });
    madeConfig = true;
    const write = async (path: string, value: unknown) => {
      await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      owned.push(path);
    };
    // Claude's default-home and explicit CLAUDE_CONFIG_DIR layouts use these locations.
    const onboarding = { hasCompletedOnboarding: true };
    await write(join(home, '.claude.json'), onboarding);
    await write(join(configDir, '.claude.json'), onboarding);
    const settingsPath = join(configDir, 'settings.json');
    await write(settingsPath, {
      apiKeyHelper: `printf '%s' '${apiKey.replace(/'/g, "'\\''")}'`,
      env: { ANTHROPIC_BASE_URL: baseUrl, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
    });
    return {
      home, configDir, settingsPath,
      environment(base) {
        const env = providerEnvironment({ ...base, HOME: home, CLAUDE_CONFIG_DIR: configDir });
        // A helper-supplied key avoids the environment-key approval path.
        delete env.ANTHROPIC_API_KEY;
        delete env.ANTHROPIC_AUTH_TOKEN;
        delete env.CLAUDE_CODE_OAUTH_TOKEN;
        // The ACP recipe supplies a different private config directory; use this installation.
        env.CLAUDE_CONFIG_DIR = configDir;
        return env;
      },
      dispose,
    };
  } catch (error) {
    try { await dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Claude settings setup and rollback failed'); }
    throw error;
  }
}
