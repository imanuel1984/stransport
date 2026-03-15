from django.urls import path
from . import views

urlpatterns = [
    path('api/request-ride', views.request_ride, name='api_request_ride'),
    path('api/available-rides', views.available_rides, name='api_available_rides'),
    path('api/volunteer-availability', views.volunteer_availability, name='api_volunteer_availability'),
    path('api/matches', views.list_matches, name='api_list_matches'),
    # Demo UI for quick verification
    path('agents/demo', views.ai_demo, name='ai_demo'),
]

