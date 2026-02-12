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


@shared_task
def generate_ai_summary(request_id):
    try:
        req = TransportRequest.objects.get(id=request_id)
    except TransportRequest.DoesNotExist:
        return None

    notes = (req.notes or "").strip()
    api_key = getattr(settings, "AI_API_KEY", "")

    if not notes:
        summary = "No notes to summarize."
    elif not api_key:
        summary = f"Summary unavailable (set AI_API_KEY). Notes: {notes[:200]}"
    else:
        summary = f"Stub summary: {notes[:200]}"

    req.ai_summary = summary
    req.save(update_fields=["ai_summary"])
    logger.info("Generated AI summary for request %s", request_id)
    return summary
