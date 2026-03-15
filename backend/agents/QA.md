How to test the AI Matching Agent (quick QA)
===========================================

1) Start the Django dev server (if not already running):

   py -3 manage.py runserver

2) Verify available API endpoints (use curl or browser):

   - List pending requests:
     GET http://127.0.0.1:8000/api/available-rides

   - Create a ride request (POST JSON) — from browser use a REST client (Postman) or curl with CSRF cookie; easiest is via Django shell:
     py -3 manage.py shell
     >>> from backend.agents.models import RideRequest
     >>> from django.utils import timezone
     >>> RideRequest.objects.create(patient_name='QA Patient', pickup_location='CityX', destination='Hospital', requested_time=timezone.now())

   - List matches:
     GET http://127.0.0.1:8000/api/matches

3) Demo UI page (simple HTML) — no auth required:

   Visit: http://127.0.0.1:8000/agents/demo

   This page renders recent MatchResult entries so you can quickly confirm matches appear.

4) Run matching for a request (if Celery broker not configured, task will run synchronously when triggered from the view or you can run from shell):

   py -3 manage.py shell
   >>> from backend.agents.tasks import process_new_request
   >>> process_new_request(<request_id>)

5) Admin UI (optional):

   - Create superuser: py -3 manage.py createsuperuser
   - Visit: http://127.0.0.1:8000/admin and inspect Agents models

6) If you can't see changes in the browser:

   - Ensure the local dev server is running in the same workspace (runserver must be started from this repo)
   - Use hard refresh (Ctrl+F5) or clear cache
   - Confirm the URL is correct: /agents/demo (special demo page) or the API endpoints above
   - If POST requests fail with CSRF, either use the Django admin/shell or include CSRF cookie in your client

7) Logs & troubleshooting

   - View server console output where runserver is running for printed notifications and task logs
   - Check database (sqlite file) to confirm records exist or use Django shell to query models

If you want, I can also add a small React widget to the existing frontend that shows matches live. Reply and I'll implement it.

