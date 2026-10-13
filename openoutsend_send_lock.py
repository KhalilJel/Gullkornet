"""Build-time lock that disables `outsend send` in the Gullkornet OpenOutSend image.

`outsend send` mails every stored lead (openers and follow-ups) using only
OpenOutSend's own pacing. It never consults Gullkornet's kill switch, Airtable
approval, suppression file or Phase 11 caps, so in this image it must not run.
Ingest (`outsend` on a pipe) and `outsend check` are unaffected.

Usage at image build time:  python openoutsend_send_lock.py <path to cold_outreach/__main__.py>
The patch fails the build if the upstream dispatch line changes, instead of silently no-oping.
"""
from __future__ import annotations

import sys
from pathlib import Path

DISPATCH = 'return {"check": _check, "send": _send}.get(args.command, _ingest)(args)'
LOCKED_DISPATCH = 'return {"check": _check, "send": _gullkornet_send_locked}.get(args.command, _ingest)(args)'
LOCK_MESSAGE = (
    "outsend send is disabled in the Gullkornet image: it bypasses the Gullkornet "
    "kill switch, Airtable approval and suppression gates. Use the guarded "
    "single-recipient sender (npm run send:email) after explicit approval."
)
LOCK_FUNCTION = f'''

def _gullkornet_send_locked(args: argparse.Namespace) -> int:
    """Gullkornet send lock; see openoutsend_send_lock.py."""
    sys.stderr.write({LOCK_MESSAGE!r} + "\\n")
    return 3
'''
EXIT_CODE = 3


def lock_source(source: str) -> str:
    if LOCKED_DISPATCH in source:
        return source
    if source.count(DISPATCH) != 1:
        raise SystemExit("OPENOUTSEND_SEND_LOCK_FAILED: upstream dispatch line not found exactly once")
    return source.replace(DISPATCH, LOCKED_DISPATCH) + LOCK_FUNCTION


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        raise SystemExit("usage: openoutsend_send_lock.py <cold_outreach/__main__.py>")
    path = Path(argv[1])
    path.write_text(lock_source(path.read_text(encoding="utf-8")), encoding="utf-8")
    print("OPENOUTSEND_SEND_LOCK=applied")


if __name__ == "__main__":
    main(sys.argv)
