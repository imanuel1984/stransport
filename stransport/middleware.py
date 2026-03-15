import json
import os
import traceback
from django.conf import settings


ERRORS_LOG = getattr(
    settings,
    "ERRORS_LOG_PATH",
    os.path.join(settings.BASE_DIR, "errors.log"),
)


def _append_error(payload):
    try:
        with open(ERRORS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        # לא להפיל את האתר בגלל לוג שגוי
        pass


def ErrorsLogMiddleware(get_response):
    """
    Middleware שרושם שגיאות שרת (500 / חריגות לא מטופלות) ל-errors.log
    באותו פורמט כמו /api/errors/ (kind='server').
    """

    def middleware(request):
        try:
            response = get_response(request)
        except Exception as exc:  # pragma: no cover - שומר על השרת, לא הליבה העסקית
            _append_error(
                {
                    "kind": "server",
                    "message": str(exc),
                    "stack": traceback.format_exc(),
                    "url": request.build_absolute_uri() if hasattr(request, "build_absolute_uri") else "",
                    "method": request.method,
                    "path": request.path,
                }
            )
            raise

        if response.status_code >= 500:
            _append_error(
                {
                    "kind": "server",
                    "message": f"HTTP {response.status_code} at {request.path}",
                    "stack": "",
                    "url": request.build_absolute_uri() if hasattr(request, "build_absolute_uri") else "",
                    "method": request.method,
                    "path": request.path,
                }
            )

        return response

    return middleware

