MCP Errors MVP

This MCP server exposes a small tool `get_errors` that returns the latest errors collected by the Django app
via `/api/errors/latest/` (already present in the project at `stransport/error_views.py`).

Usage (local):

1. Start Django dev server: `python manage.py runserver`
2. Run MCP server (stdio): `python mcp_errors.py`
3. From an MCP-capable client (e.g. Roo local MCP runner) call `tools/list` then `tools/call` with `name: get_errors`.

HTTP mode:

`python mcp_errors.py --http` will start a small HTTP JSON-RPC endpoint on port 3001.

Notes:
- Client-side code already posts console errors to `/api/errors/` (see `stransport/static/stransport/stransport.js`).
- Server-side middleware writes server errors to same `errors.log` (see `stransport/middleware.py`).

