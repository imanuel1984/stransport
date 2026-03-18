MCP Errors MVP

This MCP server exposes a small tool `get_errors` that returns the latest errors collected by the Django app
via `/api/errors/latest/` (already present in the project at `stransport/error_views.py`).


Usage (local):

1. Start Django dev server: `python manage.py runserver`
2. Optionally set a shared token for production/testing locally:
   - export ERRORS_TOKEN="your-secret"
3. Run MCP server (stdio): `python mcp_errors.py`
4. From an MCP-capable client (e.g. Roo local MCP runner) call `tools/list` then `tools/call` with `name: get_errors`.

HTTP mode:

`python mcp_errors.py --http --port 3001` will start a small HTTP JSON-RPC endpoint on the specified port.

Security / Render deployment notes:
- In production set `ERRORS_TOKEN` in environment; the endpoint will require header `X-ERRORS-TOKEN: <token>` on POST requests.
- On Render, configure a Log Drain or attach a Webhook that forwards logs to your app's `/api/errors/` endpoint with the `X-ERRORS-TOKEN` header.

Notes:
- Client-side code already posts console errors to `/api/errors/` (see `stransport/static/stransport/stransport.js`).
- Server-side middleware writes server errors to same `errors.log` (see `stransport/middleware.py`).

Trigger (how to use with AI):
- You don't need to paste logs. When you write messages like: "it doesn't work", "500", "do you see the error?", the AI should first read `errors.log` (or call the MCP tool `get_errors`) and respond based on the JSON.

Quick local watcher (PowerShell):

Run while Django is running:

`powershell -ExecutionPolicy Bypass -File .\watch_errors.ps1`

The watcher also appends to `errors_watch.log` in the project root.

