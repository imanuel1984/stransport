from django.db import models


class RideRequest(models.Model):
    STATUS_PENDING = 'pending'
    STATUS_MATCHED = 'matched'
    STATUS_COMPLETED = 'completed'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_MATCHED, 'Matched'),
        (STATUS_COMPLETED, 'Completed'),
    ]

    patient_name = models.CharField(max_length=200)
    pickup_location = models.CharField(max_length=500)
    # Optional numeric coords for better matching in the future
    pickup_lat = models.FloatField(null=True, blank=True)
    pickup_lng = models.FloatField(null=True, blank=True)
    destination = models.CharField(max_length=500)
    requested_time = models.DateTimeField()
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING)

    def __str__(self):
        return f"RideRequest {self.id} - {self.patient_name} ({self.status})"


class VolunteerAvailability(models.Model):
    volunteer_name = models.CharField(max_length=200)
    current_location = models.CharField(max_length=500)
    current_lat = models.FloatField(null=True, blank=True)
    current_lng = models.FloatField(null=True, blank=True)
    available_from = models.DateTimeField()
    available_until = models.DateTimeField()
    status = models.CharField(max_length=32, default='available')

    def __str__(self):
        return f"Volunteer {self.volunteer_name} ({self.status})"


class MatchResult(models.Model):
    request = models.ForeignKey(RideRequest, on_delete=models.CASCADE, related_name='matches')
    volunteer = models.ForeignKey(VolunteerAvailability, on_delete=models.CASCADE, related_name='matches')
    match_score = models.FloatField(default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Match {self.id}: request={self.request_id} volunteer={self.volunteer_id} score={self.match_score}"

