# Real-time errors in the IDE (MCP)

**Browser console and server errors flow into your editor as JSON. The AI sees what actually failed—no copy-paste, no guessing.**

---

## What this is

A small **MCP (Model Context Protocol) server** that connects your app’s error stream to Cursor (or any MCP-capable IDE). When you ask the AI to fix a bug, it can call a tool (`get_errors`) and get the latest client and server errors in one JSON payload. No manual pasting of console or log output.

- **Browser**: `console.error`, `window.onerror`, and unhandled promise rejections are sent to `POST /api/errors/`.
- **Server**: 500s and other server errors are logged to the same store (e.g. `errors.log`).
- **API**: `GET /api/errors/latest/` returns the last N errors as JSON.
- **MCP**: `mcp_errors.py` calls that API and exposes one tool, `get_errors`, to the IDE.

So the AI doesn’t guess—it reads the same errors you’d see in DevTools and server logs.

---

## Flow (high level)

```
Browser (console/errors)  ──POST /api/errors/──►  Django  ──append──►  errors.log
                                                                           │
Server (500, middleware)   ──────────────────────►  Django  ──append──►  errors.log
                                                                           │
                                                                           ▼
Cursor / IDE  ◄── get_errors (MCP tool)  ◄──  mcp_errors.py  ◄── GET /api/errors/latest/
```

---

## How to run it

### 1. Backend and errors API (already in this project)

- **Django**  
  - `POST /api/errors/` — receives error payloads (see `stransport/error_views.py`).  
  - `GET /api/errors/latest/` — returns `{"errors": [...]}` (last 20).  
- **Frontend**  
  - `stransport/static/stransport/stransport.js` sends console/runtime errors to `/api/errors/`.  
- **Server errors**  
  - Middleware (e.g. `stransport/middleware.py`) writes 500s to the same log used by the API.

Start the app:

```bash
python manage.py runserver
```

### 2. MCP server (this repo)

From the project root:

```bash
# Optional: point to your app (default is http://localhost:8000)
set ERRORS_API_BASE=http://127.0.0.1:8000
# Optional: if your API is protected
set ERRORS_TOKEN=your-secret

python mcp_errors.py
```

For a quick HTTP test:

```bash
python mcp_errors.py --http --port 3001
```

### 3. Cursor (or other MCP client)

In this project, add or merge into `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "errors": {
      "command": "python",
      "args": ["mcp_errors.py"],
      "env": {
        "ERRORS_API_BASE": "http://127.0.0.1:8000"
      }
    }
  }
}
```

Restart or reload Cursor so it picks up the MCP server. The AI will then have access to the `get_errors` tool.

---

## How to verify it works

1. **Generate an error**  
   - Open the app in the browser (e.g. `http://127.0.0.1:8000/`).  
   - In DevTools → Console run:  
     `nonexistentFunctionCall()`  
   - Or trigger any action that causes a 500.

2. **Check the API**  
   - Open:  
     `http://127.0.0.1:8000/api/errors/latest/`  
   - You should see JSON with `"errors": [ ... ]` containing the event you just caused.

3. **Use the AI**  
   - In Cursor, ask: *“Fetch the latest errors using the MCP tool and summarize them.”*  
   - The AI should call `get_errors` and show the same entries—no copy-paste from you.

---

## Trigger (how the AI knows to look)

There is **no background streaming** into the chat by default. The trigger is **your message**.

When you write anything that implies a problem (for example: *“it’s broken”, “500”, “error”, “doesn’t work”, “do you see the error?”*), the AI should automatically:

1. Read `errors.log` (project root), or call the MCP tool `get_errors`
2. Diagnose from the JSON fields (`message`, `stack`, `url`, `kind`, etc.)
3. Propose a fix

Optional local terminal watcher (PowerShell) to make issues obvious while you work:

```powershell
powershell -ExecutionPolicy Bypass -File .\watch_errors.ps1
```

---

## Demo for stakeholders (e.g. employer)

1. **Show the pipeline**  
   - Trigger a console error or 500.  
   - Show ` /api/errors/latest/` in the browser with the new error.  
   - In Cursor, ask the AI to “get the latest errors” and show the AI’s answer.  

2. **One-liner you can say**  
   *“We wired our app’s errors into the IDE via MCP: the AI pulls real console and server errors on demand, so debugging is data-driven instead of guesswork—no manual log copying.”*

3. **Production**  
   - Set `ERRORS_API_BASE` to your deployed URL (e.g. on Render).  
   - Set `ERRORS_TOKEN` and send `X-ERRORS-TOKEN` from any log drain or client that posts to `/api/errors/`.  
   - Same `mcp_errors.py` and Cursor config then show production errors in the IDE.

---

## Files in this repo

| File / folder | Role |
|--------------|------|
| `mcp_errors.py` | MCP server (stdio by default; `--http` for testing). |
| `stransport/error_views.py` | `POST /api/errors/`, `GET /api/errors/latest/`. |
| `stransport/static/stransport/stransport.js` | Sends browser errors to `/api/errors/`. |
| `stransport/middleware.py` | Writes server errors to the same log. |
| `errors.log` | Append-only log (one JSON object per line). Not committed. |

---

## Reusable template

A standalone template (browser script, Django example views, generic MCP server) lives in:

**`mcp-realtime-errors`** (sibling folder under `my mods`).

Copy from there to add the same flow to any other project.
