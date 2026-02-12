from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import ensure_csrf_cookie
from django.shortcuts import render

@login_required
@ensure_csrf_cookie
def index(request):
    return render(request, "trivia/index.html", {"current_user": request.user})
