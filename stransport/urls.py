from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("signup/", views.signup, name="signup"),
    path("api/requests/", views.requests_api, name="requests_api"),
    path("api/requests/create/", views.create_request_api, name="create_request_api"),
    path("api/requests/accept/<int:req_id>/", views.accept_request_api, name="accept_request_api"),
    path("api/requests/reject/<int:req_id>/", views.reject_request_api, name="reject_request_api"),
    path("api/requests/cancel/<int:req_id>/", views.cancel_request_api, name="cancel_request_api"),
    path("api/requests/accepted/", views.accepted_requests_api, name="accepted_requests_api"),
    path("api/requests/closed/", views.closed_requests_api, name="closed_requests_api"),
    path("api/requests/delete/<int:req_id>/", views.delete_request_api, name="delete_request_api"),

]
