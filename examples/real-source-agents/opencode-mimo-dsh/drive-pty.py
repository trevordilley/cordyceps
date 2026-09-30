"""Drive an argv-prompt TUI in a real controlling terminal, preserve raw output."""
import errno, fcntl, json, os, pty, re, select, signal, struct, sys, termios, time
marker, input_prompt, *command = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execv(command[0], command)
print(f'CORDYCEPS_PTY_GROUP={pid}', file=sys.stderr, flush=True)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 180, 0, 0))
started = time.monotonic()
output = b''
observed = False
submitted = False
ready_at = None
try:
    while time.monotonic() - started < 15:
        if input_prompt and not submitted and ready_at is not None and time.monotonic() >= ready_at:
            os.write(fd, input_prompt.encode())
            time.sleep(0.15)
            os.write(fd, b'\r')
            submitted = True
        if not select.select([fd], [], [], 0.1)[0]:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not data:
            break
        output += data
        for query, reply in [(b'\x1b[6n', b'\x1b[1;1R'), (b'\x1b[?u', b'\x1b[?0u'),
                             (b'\x1b[c', b'\x1b[?1;2c'), (b'\x1b]10;?', b'\x1b]10;rgb:ffff/ffff/ffff\x1b\\'),
                             (b'\x1b]11;?', b'\x1b]11;rgb:0000/0000/0000\x1b\\')]:
            if query in data:
                os.write(fd, reply)
        text = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', output).decode(errors='replace')
        if input_prompt and ready_at is None and 'Anthropic' in text:
            ready_at = time.monotonic() + 0.5
        if marker in text:
            observed = True
            break
finally:
    try:
        os.write(fd, b'\x03')
        time.sleep(0.2)
    except OSError:
        pass
    os.close(fd)
    # Kill the entire PTY child group even if the main child already exited.
    try:
        os.killpg(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    _, status = os.waitpid(pid, 0)
print(json.dumps({'observedRawMarker': observed, 'promptBytesSent': submitted, 'termination': 'consumer closed TUI process group',
                  'waitStatus': status, 'transcript': output.decode(errors='replace')}))
# Transport completion is not agent success. The caller renders the captured terminal
# with xterm and asserts the actual reply and provider/file-read evidence.
sys.exit(0)
