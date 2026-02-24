from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.apps import apps


@database_sync_to_async
def get_user_role(user_id):
    Profile = apps.get_model("stransport", "Profile")
    try:
        return Profile.objects.get(user_id=user_id).role
    except Profile.DoesNotExist:
        return ""


class RequestsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close()
            return

        role = await get_user_role(user.id)
        if role == "volunteer":
            await self.channel_layer.group_add("volunteers", self.channel_name)
        elif role == "sick":
            await self.channel_layer.group_add(f"patient_{user.id}", self.channel_name)

        await self.accept()

    async def disconnect(self, code):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            return

        role = await get_user_role(user.id)
        if role == "volunteer":
            await self.channel_layer.group_discard("volunteers", self.channel_name)
        elif role == "sick":
            await self.channel_layer.group_discard(f"patient_{user.id}", self.channel_name)

    async def request_event(self, event):
        await self.send_json(
            {
                "event": event.get("event"),
                "request": event.get("request"),
            }
        )
