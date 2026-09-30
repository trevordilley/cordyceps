"""Actual terminal transport only. Never executes an agent tool or fabricates a result."""
import errno, fcntl, json, os, pty, re, select, signal, struct, sys, termios, time
marker, *command = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execv(command[0], command)
print(f'CORDYCEPS_PTY_GROUP={pid}', file=sys.stderr, flush=True)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 180, 0, 0))
started = time.monotonic(); output = b''; observed = False
try:
    while time.monotonic() - started < 30:
        if not select.select([fd], [], [], .1)[0]: continue
        try: data = os.read(fd, 65536)
        except OSError as e:
            if e.errno == errno.EIO: break
            raise
        if not data: break
        output += data
        for query, reply in [(b'\x1b[6n', b'\x1b[1;1R'), (b'\x1b[?u', b'\x1b[?0u'), (b'\x1b[c', b'\x1b[?1;2c'), (b'\x1b]10;?', b'\x1b]10;rgb:ffff/ffff/ffff\x1b\\'), (b'\x1b]11;?', b'\x1b]11;rgb:0000/0000/0000\x1b\\')]:
            if query in data: os.write(fd, reply)
        text = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', output).decode(errors='replace')
        if marker in text:
            observed = True; break
finally:
    os.close(fd)
    exited, status = os.waitpid(pid, os.WNOHANG)
    if not exited:
        try: os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError: pass
        _, status = os.waitpid(pid, 0)
print(json.dumps({'observedReply': observed, 'waitStatus': status, 'termination': 'consumer closed terminal process group', 'transcript': output.decode(errors='replace')}))
sys.exit(0 if observed else 1)
