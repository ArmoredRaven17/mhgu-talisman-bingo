# Dev server for docs/.
#
# Exists because `python -m http.server` takes its port as a POSITIONAL argument and ignores
# $PORT, so it cannot cooperate with a harness that assigns a free port. Hardcoding one in
# .claude/launch.json meant a second session -- or a stray server from an earlier one -- held
# the port and the preview refused to start.
#
# Binds $PORT when set, otherwise 5582 to match the old default.
import functools
import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT") or 5582)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs")

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(("", PORT), handler) as httpd:
    print("serving docs/ on http://localhost:%d" % PORT, flush=True)
    httpd.serve_forever()
