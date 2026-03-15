AI Matching Agent (agents)
=========================

Overview
--------
This lightweight Django app provides an AI Matching Agent that:

- stores ride requests and volunteer availability
- runs a matching service to select a volunteer for a request
- enqueues matching as a Celery task and logs notifications

Files
-----
- [`backend/agents/models.py`](backend/agents/models.py:1) — Django models: RideRequest, VolunteerAvailability, MatchResult
- [`backend/agents/services.py`](backend/agents/services.py:1) — matching logic + notification stub
- [`backend/agents/tasks.py`](backend/agents/tasks.py:1) — Celery worker task process_new_request
- [`backend/agents/views.py`](backend/agents/views.py:1) — simple API endpoints
- [`backend/agents/urls.py`](backend/agents/urls.py:1) — URL routes for the API

Quickstart (local)
------------------
1. Add the app to INSTALLED_APPS (already done in repository):

   - [`stransport_pro/settings.py`](stransport_pro/settings.py:1)

2. Install dependencies (recommended in a virtualenv):

   - python-dateutil (used to parse ISO datetimes)

     pip install python-dateutil

3. Create and apply migrations:

   - python manage.py makemigrations agents
   - python manage.py migrate

4. Run Celery worker (the project uses the CELERY_BROKER_URL setting):

   - celery -A stransport_pro worker --loglevel=info

   If you don't have a broker during development, the view will try to call the task synchronously.

API
---
- POST /api/request-ride — create a ride request and enqueue matching (JSON body with patient_name, pickup_location, destination, requested_time (ISO))
- GET /api/available-rides — list pending requests
- POST /api/volunteer-availability — create volunteer availability (JSON body with volunteer_name, current_location, available_from, available_until (ISO))

Notes & next steps
------------------
- Matching is a simple heuristic (distance/time/experience stubs). For better accuracy:
  - store numeric lat/lng instead of free-text locations, use a geocoder
  - compute haversine distance for scoring
  - persist historical match success to compute experience_score
- Notification is a console log stub: replace `send_notification` in [`backend/agents/services.py`](backend/agents/services.py:1) with integrations (WhatsApp/SMS/Email)
- Consider adding authentication and rate-limiting to the API endpoints

If you want, I can:

- add unit tests for services and the Celery task
- extend models with lat/lng and update the matching algorithm (requires migrations)
- scaffold a minimal React dashboard that calls these endpoints

