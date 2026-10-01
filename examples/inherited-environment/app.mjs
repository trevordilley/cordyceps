// A small application with a background worker. It has no Cordyceps dependency.
import { fork } from 'node:child_process';

const prompt = process.argv[2];
if (!prompt) throw new Error('Usage: node app.mjs <prompt>');
const worker = fork(new URL('./worker.mjs', import.meta.url), [], {
  stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  // Node inherits this application's environment by default.
});
let reply;
worker.on('message', message => { reply = message; });
worker.on('error', error => { console.error(error); process.exitCode = 1; });
worker.on('exit', code => {
  if (code !== 0 || !reply || reply.error) {
    console.error(reply?.error ?? `Worker exited ${code} without a reply`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ...reply, appPid: process.pid }));
});
worker.send({ prompt });
