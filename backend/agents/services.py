import math
import logging
from .models import VolunteerAvailability, MatchResult, RideRequest
from django.utils import timezone

logger = logging.getLogger(__name__)


def send_notification(user, message):
    # Simple notification stub — currently log to console
    logger.info('Notification for %s: %s', user, message)
    print(f'Notification for {user}: {message}')


def _haversine(lat1, lon1, lat2, lon2):
    # Calculate distance in kilometers between two lat/lon pairs
    R = 6371.0  # Earth radius in km
    try:
        from math import radians, sin, cos, sqrt, atan2
        dlat = radians(lat2 - lat1)
        dlon = radians(lon2 - lon1)
        a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
        c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return R * c
    except Exception:
        return float('inf')


def _distance_score(request, volunteer):
    # Prefer volunteers with numeric coords if available, else fallback to text match
    try:
        if request.pickup_lat is not None and request.pickup_lng is not None and volunteer.current_lat is not None and volunteer.current_lng is not None:
            dist_km = _haversine(request.pickup_lat, request.pickup_lng, volunteer.current_lat, volunteer.current_lng)
            # score in [0,1] where closer gets higher score (clamp)
            score = max(0.0, 1.0 - (dist_km / 50.0))
            return score
        return 1.0 if request.pickup_location == volunteer.current_location else 0.5
    except Exception:
        return 0.0


def _time_compatibility_score(request_time, volunteer_from, volunteer_until):
    if not request_time or not volunteer_from or not volunteer_until:
        return 0.0
    if volunteer_from <= request_time <= volunteer_until:
        return 1.0
    # partial overlap (requested time near availability)
    delta = abs((volunteer_from - request_time).total_seconds())
    return max(0.0, 1.0 - (delta / (60 * 60 * 24)))


def _experience_score(volunteer):
    # Placeholder: in future use past successful matches; for now return 0.5.
    return 0.5


def match_request_to_volunteers(request: RideRequest):
    """
    Find best volunteer for a given RideRequest.

    Steps:
    - find volunteers marked 'available'
    - compute score = distance_score + time_score + experience_score
    - return best volunteer (VolunteerAvailability instance) and score
    """
    candidates = VolunteerAvailability.objects.filter(status__iexact='available')
    best = None
    best_score = -math.inf

    for vol in candidates:
        try:
            dscore = _distance_score(request.pickup_location, vol.current_location)
            tscore = _time_compatibility_score(request.requested_time, vol.available_from, vol.available_until)
            escore = _experience_score(vol)
            score = dscore + tscore + escore
            if score > best_score:
                best_score = score
                best = vol
        except Exception:
            logger.exception('Error scoring volunteer %s', vol.id)

    return best, (best_score if best is not None else 0.0)


def explain_match(request: RideRequest, volunteer: VolunteerAvailability):
    if not volunteer:
        return 'No volunteer matched.'
    parts = []
    parts.append('This volunteer is available in the requested time window.' if (volunteer.available_from <= request.requested_time <= volunteer.available_until) else 'Volunteer availability does not fully cover the requested time.')
    parts.append('Pickup location matches volunteer current location.' if volunteer.current_location == request.pickup_location else 'Volunteer is nearby.')
    return ' '.join(parts)

