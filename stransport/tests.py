from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from .models import Profile, TransportRequest, TransportAssignment, TransportRejection
import json
from datetime import timedelta


from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from datetime import timedelta
import json

from stransport.models import (
    Profile,
    TransportRequest,
    TransportAssignment,
    TransportRejection,
)
from django.db.models.signals import post_save
from stransport.signals import create_profile

# Disable signal duplication during testing
post_save.disconnect(create_profile, sender=User)


class TransportAppTests(TestCase):
    def setUp(self):
        # Create users manually
        self.sick_user = User.objects.create_user(username="patient1", password="1234")
        self.volunteer_user = User.objects.create_user(username="volunteer1", password="1234")

        # Attach profiles manually
        Profile.objects.create(user=self.sick_user, role="sick", phone="111-222")
        Profile.objects.create(user=self.volunteer_user, role="volunteer", phone="333-444")

        # Django test client
        self.client = Client()

    # -------------------- MODEL TESTS --------------------
    def test_profile_creation(self):
        profile = Profile.objects.get(user=self.sick_user)
        self.assertEqual(profile.role, "sick")
        self.assertEqual(profile.phone, "111-222")

    def test_request_str_and_status(self):
        req = TransportRequest.objects.create(
            sick=self.sick_user,
            pickup_address="A",
            destination="B",
            requested_time=timezone.now() + timedelta(hours=1),
        )
        self.assertEqual(req.status, "open")
        self.assertIn("patient1", str(req))

    # -------------------- VIEW HELPERS --------------------
    def login_sick(self):
        self.client.login(username="patient1", password="1234")

    def login_volunteer(self):
        self.client.login(username="volunteer1", password="1234")

    def create_request(self):
        return TransportRequest.objects.create(
            sick=self.sick_user,
            pickup_address="Home",
            destination="Hospital",
            requested_time=timezone.now() + timedelta(hours=1),
            notes="urgent"
        )

    # -------------------- VIEW TESTS --------------------
    def test_home_page_requires_login(self):
        response = self.client.get(reverse("home"))
        self.assertEqual(response.status_code, 302)

    def test_patient_can_create_request(self):
        self.login_sick()
        data = {
            "pickup": "Home",
            "destination": "Clinic",
            "time": (timezone.now() + timedelta(hours=1)).isoformat(),
            "notes": "Need help",
            "phone": "555-000"
        }
        response = self.client.post(
            reverse("create_request_api"),
            json.dumps(data),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(TransportRequest.objects.exists())

    def test_volunteer_can_accept_request(self):
        req = self.create_request()
        self.login_volunteer()
        url = reverse("accept_request_api", args=[req.id])
        response = self.client.post(url)
        req.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(req.status, "accepted")
        self.assertTrue(TransportAssignment.objects.filter(request=req).exists())

    def test_volunteer_can_reject_and_auto_cancel_if_all_rejected(self):
        req = self.create_request()
        self.login_volunteer()
        url = reverse("reject_request_api", args=[req.id])
        response = self.client.post(
            url, json.dumps({"reason": "busy"}), content_type="application/json"
        )
        self.assertEqual(response.status_code, 200)
        req.refresh_from_db()
        # Since only one volunteer exists, should auto-cancel
        self.assertEqual(req.status, "cancelled")
        self.assertTrue(req.no_volunteers_available)

    def test_patient_can_cancel_request(self):
        req = self.create_request()
        self.login_sick()
        url = reverse("cancel_request_api", args=[req.id])
        response = self.client.post(url)
        req.refresh_from_db()
        self.assertEqual(req.status, "cancelled")
        self.assertEqual(response.status_code, 200)

    def test_volunteer_can_delete_request(self):
        req = self.create_request()
        TransportAssignment.objects.create(request=req, volunteer=self.volunteer_user)
        req.status = "accepted"
        req.save()
        self.login_volunteer()
        url = reverse("delete_request_api", args=[req.id])
        response = self.client.post(url)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(TransportRequest.objects.filter(id=req.id).exists())

    def test_patient_cannot_create_request_when_logged_out(self):
        data = {
            "pickup": "Home",
            "destination": "Clinic",
            "time": (timezone.now() + timedelta(hours=1)).isoformat(),
            "notes": "Need help"
        }
        response = self.client.post(
            reverse("create_request_api"),
            json.dumps(data),
            content_type="application/json"
        )
        self.assertEqual(response.status_code, 302)

    def test_no_volunteers_available_flag(self):
        """If all volunteers reject, request becomes cancelled with flag True"""
        # Setup two volunteers
        vol2 = User.objects.create_user(username="vol2", password="1234")
        Profile.objects.create(user=vol2, role="volunteer")

        req = self.create_request()
        self.login_volunteer()
        # Reject by volunteer1
        self.client.post(
            reverse("reject_request_api", args=[req.id]),
            json.dumps({"reason": "busy"}),
            content_type="application/json",
        )

        # Reject by vol2
        self.client.logout()
        self.client.login(username="vol2", password="1234")
        self.client.post(
            reverse("reject_request_api", args=[req.id]),
            json.dumps({"reason": "no car"}),
            content_type="application/json",
        )

        req.refresh_from_db()
        self.assertEqual(req.status, "cancelled")
        self.assertTrue(req.no_volunteers_available)
