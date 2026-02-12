from django.urls import path

from . import consumers

websocket_urlpatterns = [
    path("ws/requests/", consumers.RequestsConsumer.as_asgi()),
]
