from django.views.decorators.http import require_http_methods
from django.http import JsonResponse, HttpResponseBadRequest
import json
from django.utils import timezone

from .models import RideRequest, VolunteerAvailability
from .tasks import process_new_request
from .models import MatchResult
from django.shortcuts import render


@require_http_methods(['POST'])
def request_ride(request):
    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        return HttpResponseBadRequest('Invalid JSON')

    patient_name = data.get('patient_name')
    pickup = data.get('pickup_location')
    destination = data.get('destination')
    requested_time = data.get('requested_time')

    if not (patient_name and pickup and destination and requested_time):
        return HttpResponseBadRequest('Missing fields')

    # naive parse — expect ISO timestamp
    try:
        from dateutil import parser
        dt = parser.isoparse(requested_time)
    except Exception:
        return HttpResponseBadRequest('Invalid requested_time')

    req = RideRequest.objects.create(
        patient_name=patient_name,
        pickup_location=pickup,
        destination=destination,
        requested_time=dt,
    )

    # Trigger background matching
    try:
        process_new_request.delay(req.id)
    except Exception:
        # If Celery not available, try sync
        process_new_request(req.id)

    return JsonResponse({'success': True, 'request_id': req.id})


@require_http_methods(['GET'])
def available_rides(request):
    # Return pending ride requests
    qs = RideRequest.objects.filter(status=RideRequest.STATUS_PENDING)
    data = []
    for r in qs:
        data.append({
            'id': r.id,
            'patient_name': r.patient_name,
            'pickup_location': r.pickup_location,
            'destination': r.destination,
            'requested_time': r.requested_time.isoformat(),
        })
    return JsonResponse({'success': True, 'requests': data})


@require_http_methods(['POST'])
def volunteer_availability(request):
    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        return HttpResponseBadRequest('Invalid JSON')

    name = data.get('volunteer_name')
    location = data.get('current_location')
    available_from = data.get('available_from')
    available_until = data.get('available_until')

    if not (name and location and available_from and available_until):
        return HttpResponseBadRequest('Missing fields')

    try:
        from dateutil import parser
        af = parser.isoparse(available_from)
        au = parser.isoparse(available_until)
    except Exception:
        return HttpResponseBadRequest('Invalid datetimes')

    vol = VolunteerAvailability.objects.create(
        volunteer_name=name,
        current_location=location,
        available_from=af,
        available_until=au,
        status='available'
    )

    return JsonResponse({'success': True, 'volunteer_id': vol.id})


@require_http_methods(['GET'])
def list_matches(request):
    qs = MatchResult.objects.select_related('request', 'volunteer').order_by('-created_at')[:50]
    data = []
    for m in qs:
        data.append({
            'id': m.id,
            'request_id': m.request.id,
            'patient_name': m.request.patient_name,
            'volunteer_id': m.volunteer.id,
            'volunteer_name': m.volunteer.volunteer_name,
            'match_score': m.match_score,
            'created_at': m.created_at.isoformat(),
        })
    return JsonResponse({'success': True, 'matches': data})


@require_http_methods(['GET'])
def ai_demo(request):
    """Public demo page that renders recent matches for quick verification."""
    qs = MatchResult.objects.select_related('request', 'volunteer').order_by('-created_at')[:50]
    matches = [
        {
            'id': m.id,
            'request_id': m.request.id,
            'patient_name': m.request.patient_name,
            'volunteer_id': m.volunteer.id,
            'volunteer_name': m.volunteer.volunteer_name,
            'match_score': m.match_score,
            'created_at': m.created_at,
        }
        for m in qs
    ]
    return render(request, 'agents/demo.html', {'matches': matches})

