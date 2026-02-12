import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import TransportRequest

logger = logging.getLogger(__name__)


@shared_task
def notify_new_request(request_id):
    logger.info("New transport request created: %s", request_id)


@shared_task
def auto_cancel_stale_requests():
    minutes = int(getattr(settings, "STALE_REQUEST_MINUTES", 30))
    cutoff = timezone.now() - timedelta(minutes=minutes)
    updated = TransportRequest.objects.filter(
        status="open",
        created_at__lt=cutoff,
    ).update(status="cancelled", cancel_reason="stale")
    if updated:
        logger.info("Auto-cancelled %s stale requests", updated)
    return updated
