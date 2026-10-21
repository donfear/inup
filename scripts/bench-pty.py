"""Run a command in a pseudo-terminal, for scripts/bench-compare.mjs.

    python3 -I scripts/bench-pty.py <command> [args...]

Interactive pickers only draw when they see a terminal. This gives the command
one of 160 columns by 50 rows, copies everything it draws to stdout, and passes
stdin through as keystrokes. It exits when the command does, with its code.
SIGTERM stops the command too: it runs in a session of its own, which killing
this process alone would leave behind.
"""

import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

ROWS, COLUMNS = 50, 160

pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])


def stop(signum, _frame):
    try:
        os.killpg(pid, signal.SIGKILL)
        os.waitpid(pid, 0)  # gone, not just dying, before this process exits
    except (ProcessLookupError, ChildProcessError):
        pass
    os._exit(128 + signum)


signal.signal(signal.SIGTERM, stop)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLUMNS, 0, 0))
inputs = [fd, sys.stdin.fileno()]
while True:
    ready, _, _ = select.select(inputs, [], [])
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:  # the command exited and closed the terminal
            break
        if not data:
            break
        os.write(sys.stdout.fileno(), data)
    if sys.stdin.fileno() in ready:
        data = os.read(sys.stdin.fileno(), 1024)
        if data:
            os.write(fd, data)
        else:
            inputs.remove(sys.stdin.fileno())

_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))
