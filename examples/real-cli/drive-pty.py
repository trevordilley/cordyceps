"""Consumer-owned POSIX PTY driver: type one prompt, capture output, close CLI."""
import errno
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time

prompt, marker, *command = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.execv(command[0], command)
print(f'CORDYCEPS_PTY_GROUP={pid}', file=sys.stderr, flush=True)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 140, 0, 0))
started = time.monotonic()
submitted = False
trusted = False
theme_selected = False
key_selected = False
security_selected = False
ready_at = None
observed = False
output = b''
try:
    while time.monotonic() - started < 20:
        if select.select([fd], [], [], 0.1)[0]:
            try:
                data = os.read(fd, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            output += data
            # Terminal capability queries from the real TUI.
            if b'\x1b[6n' in data:
                os.write(fd, b'\x1b[1;1R')
            if b'\x1b[?u' in data:
                os.write(fd, b'\x1b[?0u')
            if b'\x1b]10;?' in data:
                os.write(fd, b'\x1b]10;rgb:ffff/ffff/ffff\x1b\\')
            if b'\x1b]11;?' in data:
                os.write(fd, b'\x1b]11;rgb:0000/0000/0000\x1b\\')
            if b'\x1b[c' in data:
                os.write(fd, b'\x1b[?1;2c')
            text = re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]', b'', output).decode(errors='replace')
            if not theme_selected and 'Darkmode' in text:
                os.write(fd, b'\r')
                theme_selected = True
            if not key_selected and 'DoyouwanttousethisAPIkey?' in text:
                # The only supplied key is the local mock session key.
                os.write(fd, b'\x1b[A\r')
                key_selected = True
            if not security_selected and 'Security notes:' in text and 'continue' in text:
                os.write(fd, b'\r')
                security_selected = True
            if not trusted and ('Yes, continue' in text or 'Yes,Itrust' in text):
                # This directory was freshly created by the consumer. Let the
                # newly rendered trust screen finish installing its input handler.
                time.sleep(1.5)
                if 'Yes,Itrust' in text:
                    os.write(fd, b'\x1b[B')
                    time.sleep(0.1)
                    os.write(fd, b'\r')
                else:
                    os.write(fd, b'1')
                    time.sleep(0.15)
                    os.write(fd, b'\r')
                    ready_at = time.monotonic() + 1
                trusted = True
            if ready_at is None and ('gpt-5.4' in text or 'Sonnet' in text):
                ready_at = time.monotonic() + 0.5
            if marker in text:
                observed = True
                break
        if not submitted and ready_at is not None and time.monotonic() > ready_at:
            os.write(fd, prompt.encode())
            time.sleep(0.15)
            os.write(fd, b'\r')
            submitted = True
finally:
    # The consumer deliberately ends the persistent interactive session.
    for _ in range(2):
        try:
            os.write(fd, b'\x03')
        except OSError:
            break
        time.sleep(0.15)
    # Close the PTY master before reaping: Darwin can otherwise leave the child
    # in its terminal exit path while waitpid blocks indefinitely.
    os.close(fd)
    exited, status = os.waitpid(pid, os.WNOHANG)
    if not exited:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            # A process already exiting may no longer accept group signals.
            pass
        _, status = os.waitpid(pid, 0)
print(json.dumps({'promptBytesSent': submitted, 'trustSelectionSent': trusted, 'observedReply': observed,
                  'termination': 'consumer closed interactive process group', 'waitStatus': status,
                  'transcript': output.decode(errors='replace')}))
sys.exit(0 if submitted and observed else 1)
