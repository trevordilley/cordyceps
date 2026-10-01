// Application code: select and invoke the agent using ordinary app configuration.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

process.once('message', async ({ prompt }) => {
  let reply;
  try {
    const pending = promisify(execFile)(process.env.CODEX_BINARY ?? 'codex', [
      'exec', '--skip-git-repo-check', '--ephemeral', '--ignore-rules', '--json',
      '-m', 'gpt-5.4', '-s', 'danger-full-access',
      '-c', 'shell_environment_policy.inherit="none"', prompt,
    ], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    // No provider URL, test API, or special env forwarding here: ordinary inheritance.
    pending.child.stdin.end();
    const { stdout } = await pending;
    const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const messages = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message');
    if (!messages.length) throw new Error(`No agent reply: ${stdout}`);
    reply = { text: messages.at(-1).item.text, workerPid: process.pid,
      workerParentPid: process.ppid, harnessPid: pending.child.pid };
  } catch (error) {
    reply = { error: error.message };
    process.exitCode = 1;
  }
  process.send(reply, () => process.disconnect());
});
