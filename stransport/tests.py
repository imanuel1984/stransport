import json
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse
from django.utils import timezone

from .models import Profile, TransportAssignment, TransportRequest, TransportRejection


class TransportAppTests(TestCase):
    def setUp(self):
        self.sick_user = User.objects.create_user(username="patient1", password="1234")
        self.volunteer_user = User.objects.create_user(username="volunteer1", password="1234")

        Profile.objects.create(user=self.sick_user, role="sick", phone="050-1234567")
        Profile.objects.create(user=self.volunteer_user, role="volunteer", phone="052-7654321")

        self.client = Client()

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
            notes="urgent",
        )

    def test_home_page_requires_login(self):
        response = self.client.get(reverse("home"))
        self.assertEqual(response.status_code, 302)

    def test_login_status_api_accepts_matching_credentials(self):
        response = self.client.post(
            reverse("login_status_api"),
            {"username": "patient1", "password": "1234"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["username_valid"])
        self.assertTrue(data["password_valid"])
        self.assertTrue(data["ready"])

    def test_login_status_api_rejects_wrong_password(self):
        response = self.client.post(
            reverse("login_status_api"),
            {"username": "patient1", "password": "wrong-pass"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["username_valid"])
        self.assertFalse(data["password_valid"])
        self.assertFalse(data["ready"])

    @patch("stransport.views.notify_new_request.delay")
    def test_patient_can_create_request(self, mock_notify):
        self.login_sick()
        data = {
            "pickup": "Home",
            "destination": "Clinic",
            "time": (timezone.now() + timedelta(hours=1)).isoformat(),
            "notes": "Need help",
            "phone": "050-1234567",
            "pickup_lat": 32.0853,
            "pickup_lng": 34.7818,
            "dest_lat": 32.0853,
            "dest_lng": 34.7818,
        }
        response = self.client.post(
            reverse("create_request_api"),
            json.dumps(data),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(TransportRequest.objects.exists())
        mock_notify.assert_called_once()

    def test_volunteer_can_accept_request(self):
        req = self.create_request()
        self.login_volunteer()
        response = self.client.post(reverse("accept_request_api", args=[req.id]))
        req.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(req.status, "accepted")
        self.assertTrue(TransportAssignment.objects.filter(request=req).exists())

    def test_volunteer_can_reject_and_auto_cancel_if_all_rejected(self):
        req = self.create_request()
        self.login_volunteer()
        response = self.client.post(
            reverse("reject_request_api", args=[req.id]),
            json.dumps({"reason": "busy"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, "cancelled")
        self.assertTrue(req.no_volunteers_available)
        self.assertEqual(req.cancel_reason, "no_volunteers")

    def test_patient_can_cancel_request(self):
        req = self.create_request()
        self.login_sick()
        response = self.client.post(reverse("cancel_request_api", args=[req.id]))
        req.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(req.status, "cancelled")
        self.assertEqual(req.cancel_reason, "patient_cancelled")

    def test_volunteer_can_delete_request(self):
        req = self.create_request()
        TransportAssignment.objects.create(request=req, volunteer=self.volunteer_user)
        req.status = "accepted"
        req.save()
        self.login_volunteer()
        response = self.client.post(reverse("delete_request_api", args=[req.id]))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(TransportRequest.objects.filter(id=req.id).exists())

    def test_no_volunteers_available_flag(self):
        vol2 = User.objects.create_user(username="vol2", password="1234")
        Profile.objects.create(user=vol2, role="volunteer")

        req = self.create_request()
        self.login_volunteer()
        self.client.post(
            reverse("reject_request_api", args=[req.id]),
            json.dumps({"reason": "busy"}),
            content_type="application/json",
        )

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
        self.assertEqual(req.cancel_reason, "no_volunteers")

    def test_route_links_valid(self):
        self.login_volunteer()
        payload = {
            "start": {"lat": 32.0853, "lng": 34.7818},
            "stops": [
                {"lat": 32.08, "lng": 34.78},
                {"lat": 32.09, "lng": 34.79},
                {"lat": 32.10, "lng": 34.80},
            ],
        }
        response = self.client.post(
            reverse("route_links_api"),
            json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("google_full_route", data)
        self.assertEqual(len(data["google_legs"]), 3)
        self.assertEqual(len(data["waze_legs"]), 3)

    def test_route_links_invalid_coordinate(self):
        self.login_volunteer()
        payload = {
            "start": {"lat": 132.0, "lng": 34.7818},
            "stops": [{"lat": 32.08, "lng": 34.78}],
        }
        response = self.client.post(
            reverse("route_links_api"),
            json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_route_links_truncation(self):
        self.login_volunteer()
        stops = [{"lat": 32.0 + i * 0.01, "lng": 34.0 + i * 0.01} for i in range(12)]
        payload = {"start": {"lat": 32.0853, "lng": 34.7818}, "stops": stops}
        response = self.client.post(
            reverse("route_links_api"),
            json.dumps(payload),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(len(data["google_legs"]), 10)
        self.assertEqual(data["warning"], "Too many stops. Limited to 10.")
