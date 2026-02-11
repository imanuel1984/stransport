from django.contrib import admin
from .models import Profile, TransportRequest, TransportAssignment

admin.site.register(Profile)
admin.site.register(TransportRequest)
admin.site.register(TransportAssignment)
