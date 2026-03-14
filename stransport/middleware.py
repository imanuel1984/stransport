"""
Middleware to ensure every authenticated user has a Profile.
Prevents 500 when templates access request.user.profile and the user was created without one.
"""
from .models import Profile


def EnsureProfileMiddleware(get_response):
    def middleware(request):
        if request.user.is_authenticated:
            try:
                request.user.profile
            except Profile.DoesNotExist:
                Profile.objects.create(user=request.user, role="sick")
        return get_response(request)
    return middleware
