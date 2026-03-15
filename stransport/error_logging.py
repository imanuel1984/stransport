"""
Handler that appends server/deploy errors to errors.log (same file as client errors)
so the AI / Cursor can read one file for both.
"""
import json
import logging
import os
from django.conf import settings

ERRORS_LOG = getattr(settings, "ERRORS_LOG_PATH", os.path.join(settings.BASE_DIR, "errors.log"))


class ErrorsLogHandler(logging.Handler):
    """Writes each log record as one JSON line to errors.log (server errors)."""

    def emit(self, record):
        try:
            msg = self.format(record)
            request_path = ""
            if hasattr(record, "request") and record.request:
                request_path = getattr(record.request, "path", "") or getattr(record.request, "get_raw_uri", lambda: "")() or ""
            stack = ""
            if record.exc_info:
                import traceback
                stack = "".join(traceback.format_exception(*record.exc_info))
            payload = {
                "message": msg,
                "stack": stack,
                "source": "server",
                "line": None,
                "column": None,
                "timestamp": self.formatter.formatTime(record, "%Y-%m-%dT%H:%M:%S") if self.formatter else "",
                "url": request_path,
                "kind": "server",
            }
            with open(ERRORS_LOG, "a", encoding="utf-8") as f:
                f.write(json.dumps(payload, ensure_ascii=False) + "\n")
        except Exception:
            self.handleError(record)
