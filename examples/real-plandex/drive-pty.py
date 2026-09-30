"""Consumer PTY for the real Plandex stream UI; never implements harness work."""
import errno, fcntl, os, pty, select, signal, struct, sys, termios, time
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[1], sys.argv[1:])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 160, 0, 0))
status = None
try:
    deadline = time.monotonic() + 55
    while time.monotonic() < deadline:
        if select.select([fd], [], [], .1)[0]:
            try:
                data = os.read(fd, 65536)
            except OSError as error:
                if error.errno == errno.EIO: break
                raise
            if not data: break
            sys.stdout.buffer.write(data); sys.stdout.buffer.flush()
            for query, reply in [(b'\x1b[6n', b'\x1b[1;1R'), (b'\x1b]10;?', b'\x1b]10;rgb:ffff/ffff/ffff\x1b\\'), (b'\x1b]11;?', b'\x1b]11;rgb:0000/0000/0000\x1b\\'), (b'\x1b[c', b'\x1b[?1;2c')]:
                if query in data: os.write(fd, reply)
        exited, value = os.waitpid(pid, os.WNOHANG)
        if exited: status = value; break
finally:
    os.close(fd)
    if status is None:
        exited, status = os.waitpid(pid, os.WNOHANG)
        if not exited:
            try: os.killpg(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError): pass
            _, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
