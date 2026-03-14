from django.conf import settings


def google_places_api_key(request):
    return {
        "google_places_api_key": getattr(settings, "GOOGLE_PLACES_API_KEY", ""),
    }


def current_user(request):
    """Make current_user available in all templates (request.user)."""
    return {"current_user": request.user}
