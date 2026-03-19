import json
from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from .models import TransportRequest, VolunteerLocation


def _forbidden(message="Not allowed"):
    return JsonResponse({"ok": False, "error": message}, status=403)


def _check_debug_token(request):
    if not getattr(settings, "DEBUG", False):
        return False
    token = getattr(settings, "DEBUG_AUTOMATION_TOKEN", "")
    if not token:
        return False
    provided = request.headers.get("X-DEBUG-TOKEN") or request.GET.get("debug_token")
    return bool(provided) and provided == token


@csrf_exempt
@require_http_methods(["GET"])
def debug_health(request):
    if not _check_debug_token(request):
        return _forbidden()
    return JsonResponse({"ok": True, "debug": True})


@csrf_exempt
@require_http_methods(["GET", "POST"])
def debug_request_location(request, req_id: int):
    """
    Debug-only endpoint that bypasses login (token-protected) to:
    - GET current stored VolunteerLocation for a request
    - POST {"stop": true} to delete stored VolunteerLocation
    This enables terminal automation without browser cookies.
    """
    if not _check_debug_token(request):
        return _forbidden()

    try:
        ride_request = TransportRequest.objects.get(id=req_id)
    except TransportRequest.DoesNotExist:
        return JsonResponse({"ok": False, "error": "request_not_found"}, status=404)

    assignment = getattr(ride_request, "transportassignment", None)
    if not assignment:
        return JsonResponse({"ok": True, "no_assignment": True})

    if request.method == "POST":
        try:
            data = json.loads(request.body or "{}")
        except Exception:
            data = {}
        if data.get("stop") is True:
            VolunteerLocation.objects.filter(assignment=assignment).delete()
            return JsonResponse({"ok": True, "stopped": True})
        return JsonResponse({"ok": False, "error": "unsupported"}, status=400)

    # GET
    try:
        loc = assignment.location
    except VolunteerLocation.DoesNotExist:
        return JsonResponse({"ok": True, "no_location": True})

    return JsonResponse(
        {
            "ok": True,
            "lat": loc.lat,
            "lng": loc.lng,
            "updated_at": loc.updated_at.isoformat() if loc.updated_at else "",
        }
    )

