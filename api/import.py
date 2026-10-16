import json
import pathlib
import sys
from http.server import BaseHTTPRequestHandler

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from server.vercel_worker import run_import


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                return self.respond(400, {"error": "Invalid import request."})
            authorization = self.headers.get("Authorization", "")
            if not authorization.startswith("Bearer ") or len(authorization) > 8192:
                return self.respond(401, {"error": "Sign in before importing media."})
            payload = json.loads(self.rfile.read(length))
            result = run_import(authorization[7:], payload["itemId"], payload["leaseId"])
            self.respond(200, result)
        except PermissionError:
            self.respond(401, {"error": "Only the Gather owner can import media. Sign in again."})
        except (ValueError, KeyError, TypeError):
            self.respond(400, {"error": "Invalid import request."})
        except Exception:
            self.respond(503, {"error": "Import is temporarily unavailable. Retry to collect missing media."})

    def do_GET(self):
        self.respond(405, {"error": "Use POST to request an import."})

    def respond(self, status, body):
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, *args):
        pass
