from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = PROJECT_DIR / "frontend"
SERVER_DIR = PROJECT_DIR / "server"


class FrontendHandler(SimpleHTTPRequestHandler):
    """Serve the static frontend from the project's frontend directory."""

    def __init__(self, *args, directory: str, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the presentation reviewer backend and frontend."
    )
    parser.add_argument(
        "--frontend-port",
        type=int,
        default=8080,
        help="Port for the static frontend (default: 8080).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not FRONTEND_DIR.is_dir() or not SERVER_DIR.is_dir():
        raise RuntimeError("Expected frontend/ and server/ directories next to run.py")

    npm_command = "npm.cmd" if sys.platform == "win32" else "npm"
    backend = subprocess.Popen(
        [npm_command, "start"],
        cwd=SERVER_DIR,
        env=os.environ.copy(),
    )

    httpd = ThreadingHTTPServer(
        ("127.0.0.1", args.frontend_port),
        lambda *handler_args: FrontendHandler(
            *handler_args, directory=str(FRONTEND_DIR)
        ),
    )

    def stop_servers(signum, frame):
        httpd.shutdown()

    signal.signal(signal.SIGINT, stop_servers)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, stop_servers)

    print(f"Frontend: http://localhost:{args.frontend_port}")
    print("Backend:  http://localhost:3000")
    print("Press Ctrl+C to stop both servers.")

    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
        if backend.poll() is None:
            backend.terminate()
            try:
                backend.wait(timeout=5)
            except subprocess.TimeoutExpired:
                backend.kill()
                backend.wait()

    return backend.returncode or 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
