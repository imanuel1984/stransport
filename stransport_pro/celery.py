import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "stransport_pro.settings")

app = Celery("stransport_pro")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
