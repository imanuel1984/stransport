from django.test import TestCase
from django.utils import timezone
from .models import RideRequest, VolunteerAvailability, MatchResult
from .services import match_request_to_volunteers, explain_match
from .tasks import process_new_request


class MatchingServiceTests(TestCase):
    def setUp(self):
        # create volunteers
        self.vol1 = VolunteerAvailability.objects.create(
            volunteer_name='Alice',
            current_location='CityA',
            available_from=timezone.now(),
            available_until=timezone.now() + timezone.timedelta(hours=4),
            status='available'
        )
        self.vol2 = VolunteerAvailability.objects.create(
            volunteer_name='Bob',
            current_location='CityB',
            available_from=timezone.now() - timezone.timedelta(hours=1),
            available_until=timezone.now() + timezone.timedelta(hours=1),
            status='available'
        )

        self.request = RideRequest.objects.create(
            patient_name='Patient1',
            pickup_location='CityA',
            destination='Hospital',
            requested_time=timezone.now(),
        )

    def test_match_request_to_volunteers_returns_best(self):
        vol, score = match_request_to_volunteers(self.request)
        self.assertIsNotNone(vol)
        # Alice is same location so should score higher
        self.assertEqual(vol.volunteer_name, 'Alice')

    def test_explain_match(self):
        explanation = explain_match(self.request, self.vol1)
        self.assertIsInstance(explanation, str)


class TasksIntegrationTests(TestCase):
    def setUp(self):
        self.vol = VolunteerAvailability.objects.create(
            volunteer_name='Charlie',
            current_location='CityX',
            available_from=timezone.now(),
            available_until=timezone.now() + timezone.timedelta(hours=2),
            status='available'
        )
        self.req = RideRequest.objects.create(
            patient_name='Patient2',
            pickup_location='CityX',
            destination='Clinic',
            requested_time=timezone.now(),
        )

    def test_process_new_request_creates_match(self):
        # Run task synchronously (task already supports being called directly)
        match_id = process_new_request(self.req.id)
        self.assertIsNotNone(match_id)
        m = MatchResult.objects.get(id=match_id)
        self.assertEqual(m.request.id, self.req.id)
        self.assertEqual(m.volunteer.id, self.vol.id)

