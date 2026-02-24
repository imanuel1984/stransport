from django.db import models
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.utils import timezone
import re

class Profile(models.Model):
    ROLE_CHOICES = [
        ('sick', 'מטופל'),
        ('volunteer', 'מתנדב'),
    ]
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    phone = models.CharField(max_length=20, blank=True)

    def __str__(self):
        return f"{self.user.username} ({self.get_role_display()})"

    def clean(self):
        if self.phone:
            self.phone = normalize_israeli_phone(self.phone)

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


def normalize_israeli_phone(value):
    raw = value.strip()
    digits = re.sub(r"\D", "", raw)

    if digits.startswith("972"):
        digits = digits[3:]
    if digits.startswith("0"):
        digits = digits[1:]

    if not digits or len(digits) not in {8, 9}:
        raise ValidationError("Invalid Israeli phone number")

    if digits[0] not in "2345789":
        raise ValidationError("Invalid Israeli phone number")

    return f"+972{digits}"


class TransportRequest(models.Model):
    STATUS_CHOICES = [
        ('open', 'פתוחה'),
        ('accepted', 'נתפסה'),
        ('done', 'הושלמה'),
        ('cancelled', 'בוטלה'),
    ]

    sick = models.ForeignKey(User, on_delete=models.CASCADE, related_name="requests")
    pickup_address = models.CharField(max_length=255)
    pickup_lat = models.FloatField(null=True, blank=True)
    pickup_lng = models.FloatField(null=True, blank=True)
    destination = models.CharField(max_length=255)
    dest_lat = models.FloatField(null=True, blank=True)
    dest_lng = models.FloatField(null=True, blank=True)
    requested_time = models.DateTimeField()
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    created_at = models.DateTimeField(auto_now_add=True)
    no_volunteers_available = models.BooleanField(default=False)
    cancel_reason = models.CharField(max_length=50, blank=True)
    ai_summary = models.TextField(blank=True)

    def __str__(self):
        return f"{self.sick.username} -> {self.destination} ({self.requested_time})"


class TransportAssignment(models.Model):
    request = models.OneToOneField(TransportRequest, on_delete=models.CASCADE, related_name="transportassignment")
    volunteer = models.ForeignKey(User, on_delete=models.CASCADE, related_name="assignments")
    accepted_time = models.DateTimeField(default=timezone.now)
    comment = models.TextField(blank=True)

    def __str__(self):
        return f"{self.volunteer.username} accepted {self.request}"


class TransportRejection(models.Model):
    request = models.ForeignKey(TransportRequest, on_delete=models.CASCADE, related_name="rejections")
    volunteer = models.ForeignKey(User, on_delete=models.CASCADE)
    reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("request", "volunteer")
