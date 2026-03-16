#!/usr/bin/env python3
"""
MCP Server: exposes get_errors() tool from Django /api/errors/latest/.
- Default: stdio (for Cursor .cursor/mcp.json command).
- With --http: HTTP server on port 3001.
"""
import json
import sys
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler

PORT = 3001
import os

API_BASE = os.environ.get("ERRORS_API_BASE", "http://localhost:8000")
LATEST_URL = f"{API_BASE}/api/errors/latest/"


def fetch_latest_errors():
    try:
        req = urllib.request.Request(LATEST_URL, headers={"Accept": "application/json"})
        # pass token header if set in environment
        TOKEN = os.environ.get("ERRORS_TOKEN", "")
        if TOKEN:
            req.add_header("X-ERRORS-TOKEN", TOKEN)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            return data.get("errors", [])
    except Exception as e:
        return [{"_fetch_error": str(e)}]


class MCPHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_POST(self):
        if self.path != "/" and self.path != "/mcp":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(body.decode())
        except json.JSONDecodeError:
            self._send_json({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
            return
        req_id = req.get("id")
        result = handle_jsonrpc(req)
        if result is not None:
            self._send_json({"jsonrpc": "2.0", "id": req_id, "result": result})
        else:
            self._send_json({"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found"}})

    def _send_json(self, obj):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.end_headers()
        self.wfile.write(json.dumps(obj, ensure_ascii=False).encode())

    def log_message(self, format, *args):
        pass


def handle_jsonrpc(req):
    method = req.get("method")
    params = req.get("params") or {}
    req_id = req.get("id")
    if method == "tools/list":
        return {"tools": [{"name": "get_errors", "description": "Returns the latest 20 client/deploy errors from the app (Django /api/errors/latest/)", "inputSchema": {"type": "object", "properties": {}}}]}
    if method == "tools/call":
        name = params.get("name") or (params.get("arguments") or {}).get("name")
        if name == "get_errors" or not name:
            errors = fetch_latest_errors()
            return {"content": [{"type": "text", "text": json.dumps(errors, ensure_ascii=False, indent=2)}]}
        return {"content": [{"type": "text", "text": json.dumps({"error": "Unknown tool"})}], "isError": True}
    return None


def run_stdio():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            result = handle_jsonrpc(req)
            if result is not None:
                print(json.dumps({"jsonrpc": "2.0", "id": req.get("id"), "result": result}, ensure_ascii=False))
            else:
                print(json.dumps({"jsonrpc": "2.0", "id": req.get("id"), "error": {"code": -32601, "message": "Method not found"}}, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32603, "message": str(e)}}, ensure_ascii=False))
        sys.stdout.flush()


def main():
    if "--http" in sys.argv:
        server = HTTPServer(("127.0.0.1", PORT), MCPHandler)
        print(f"MCP errors server on http://127.0.0.1:{PORT}", file=sys.stderr)
        server.serve_forever()
    else:
        run_stdio()


if __name__ == "__main__":
    main()
