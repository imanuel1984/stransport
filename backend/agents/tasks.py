from celery import shared_task
import logging
from django.utils import timezone

from .models import RideRequest, MatchResult
from .services import match_request_to_volunteers, send_notification

logger = logging.getLogger(__name__)


@shared_task(bind=True)
def process_new_request(self, request_id):
    try:
        req = RideRequest.objects.get(id=request_id)
    except RideRequest.DoesNotExist:
        logger.error('RideRequest %s does not exist', request_id)
        return None

    logger.info('Agent started processing request %s', request_id)
    volunteer, score = match_request_to_volunteers(req)
    if not volunteer:
        logger.info('No volunteer matched for request %s', request_id)
        return None

    # create MatchResult
    match = MatchResult.objects.create(request=req, volunteer=volunteer, match_score=score)
    # update request status
    req.status = RideRequest.STATUS_MATCHED
    req.save(update_fields=['status'])

    # send notification (stub)
    send_notification(volunteer.volunteer_name, f'Matched to request {req.id} (score {score:.2f})')
    send_notification(req.patient_name, f'We found a volunteer: {volunteer.volunteer_name} (score {score:.2f})')

    logger.info('Request %s processed: volunteer %s matched (score %s)', request_id, volunteer.id, score)
    return match.id

