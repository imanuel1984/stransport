"""
Error tracking API: receive client errors (frontend), log to errors.log, serve latest.
"""
import json
import os
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings

# Path for errors.log (project root or base dir)
ERRORS_LOG = getattr(settings, "ERRORS_LOG_PATH", os.path.join(settings.BASE_DIR, "errors.log"))
LATEST_COUNT = 20

def _cors_headers(response):
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@csrf_exempt
@require_http_methods(["POST", "OPTIONS"])
def errors_api(request):
    if request.method == "OPTIONS":
        r = JsonResponse({})
        return _cors_headers(r)
    try:
        data = json.loads(request.body or "{}")
        payload = {
            "message": data.get("message", ""),
            "stack": data.get("stack", ""),
            "source": data.get("source", ""),
            "line": data.get("line"),
            "column": data.get("column"),
            "timestamp": data.get("timestamp", ""),
            "url": data.get("url", ""),
            "kind": data.get("kind", "client"),
        }
        with open(ERRORS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
        r = JsonResponse({"ok": True})
        return _cors_headers(r)
    except Exception as e:
        r = JsonResponse({"ok": False, "error": str(e)}, status=500)
        return _cors_headers(r)


@require_http_methods(["GET"])
def errors_latest_api(request):
    try:
        if not os.path.exists(ERRORS_LOG):
            r = JsonResponse({"errors": []})
            return _cors_headers(r)
        with open(ERRORS_LOG, "r", encoding="utf-8") as f:
            lines = f.readlines()
        errors = []
        for line in reversed(lines[-LATEST_COUNT:]):
            line = line.strip()
            if not line:
                continue
            try:
                errors.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        errors = errors[:LATEST_COUNT]
        r = JsonResponse({"errors": errors})
        return _cors_headers(r)
    except Exception as e:
        r = JsonResponse({"errors": [], "error": str(e)}, status=500)
        return _cors_headers(r)
<<<<<<< HEAD
=======

>>>>>>> 34d0b0f (Error tracking + auth/trivia fixes)
