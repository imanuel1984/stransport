from django.contrib import admin
from .models import RideRequest, VolunteerAvailability, MatchResult


@admin.register(RideRequest)
class RideRequestAdmin(admin.ModelAdmin):
    list_display = ('id', 'patient_name', 'status', 'requested_time')
    search_fields = ('patient_name', 'pickup_location', 'destination')


@admin.register(VolunteerAvailability)
class VolunteerAvailabilityAdmin(admin.ModelAdmin):
    list_display = ('id', 'volunteer_name', 'status', 'available_from', 'available_until')
    search_fields = ('volunteer_name', 'current_location')


@admin.register(MatchResult)
class MatchResultAdmin(admin.ModelAdmin):
    list_display = ('id', 'request', 'volunteer', 'match_score', 'created_at')
    readonly_fields = ('created_at',)

