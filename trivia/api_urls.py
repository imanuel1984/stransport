from django.urls import path
from . import api_views

urlpatterns = [
    path("questions/", api_views.questions),
    path("chat/", api_views.ai_chat),
    path("explain/", api_views.ai_explain),
    path("translate/", api_views.translate_questions),
]
