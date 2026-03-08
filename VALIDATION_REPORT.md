# Safety & Validation Report — Stransport Pro (Django)

**Date:** Pre-upgrade validation  
**Scope:** Full safety and validation review; no automatic push or deploy.

---

## 1) Issues found

| # | Severity | Issue | Location |
|---|----------|--------|----------|
| 1 | **High** | `SECRET_KEY` had a hardcoded fallback; in production (DEBUG=False) the app could run with a default key. | `stransport_pro/settings.py` |
| 2 | **Medium** | Duplicate/obsolete code: `stransport/views/favicon.py` defined the same `FaviconView` as `views.py`; urls import from `views` (module), so the file was dead code. | `stransport/views/favicon.py` |
| 3 | **Low** | Edit-request form had no CSRF token in markup; API calls use `X-CSRFToken` from cookie, so it worked, but form lacked explicit token for consistency. | `stransport/templates/stransport/home.html` (edit modal form) |
| 4 | **Info** | `staticfiles/` directory missing locally; Django logs a warning. On Render, `collectstatic` creates it at build time. | Project root / Render build |
| 5 | **Info** | `TEMPLATES['DIRS']` points to `BASE_DIR / "templates"`; app templates live under `stransport/templates/` and `trivia/templates/` (APP_DIRS=True). Root `templates` can be empty or unused. | `settings.py` |

**Not issues (verified):**

- **Imports/routes:** All `stransport` URLs and views resolve; `FaviconView` comes from `stransport.views` (module `views.py`).
- **Templates/static:** Layout extends correctly; static refs use `{% static 'stransport/...' %}`; Leaflet and stransport JS/CSS exist.
- **CSRF:** Create form and logout form have `{% csrf_token %}` or hidden `csrfmiddlewaretoken`; API calls send `X-CSRFToken` via `getCookie('csrftoken')`.
- **Auth/roles:** API views use `@login_required` or `@login_required_json`; role checks (`sick`/`volunteer`) applied where needed.
- **Secrets:** No hardcoded secrets; `SECRET_KEY`, DB, Redis, RabbitMQ, AI/Google keys read from env (and optional `.env`).
- **Django:** `manage.py check` passes; stransport tests run (10 tests OK).

---

## 2) Fixes applied

| Fix | File | Change |
|-----|------|--------|
| Require SECRET_KEY in production | `stransport_pro/settings.py` | If `DEBUG` is False and `SECRET_KEY` is empty, raise `RuntimeError`. Use env-only `_DEBUG`/`_SECRET_KEY` so production cannot start without `SECRET_KEY`. |
| CSRF on edit form | `stransport/templates/stransport/home.html` | Added `{% csrf_token %}` inside `<form id="edit-request-form">`. |

---

## 3) Files removed

| File | Reason |
|------|--------|
| `stransport/views/favicon.py` | Obsolete duplicate of `FaviconView` in `stransport/views.py`. URLs import from `views` (the module), so this file was never used. |

**Note:** No other files were removed. Single architecture retained (stransport + trivia apps; one `views.py` for stransport).

---

## 4) Required Render env vars

Set these in the Render dashboard for the web service (and worker if using Celery).

**Required (app will not start without them in production):**

| Variable | Description |
|----------|-------------|
| `SECRET_KEY` | Django secret (generate a new one for production, e.g. `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"`) |
| `DATABASE_URL` | Postgres connection string (Render provides this for Postgres add-on) |

**Strongly recommended:**

| Variable | Description |
|----------|-------------|
| `DEBUG` | Set to `False` in production |
| `ALLOWED_HOSTS` | Your Render host, e.g. `stransport-djm8.onrender.com` |
| `CSRF_TRUSTED_ORIGINS` | `https://stransport-djm8.onrender.com` (or your Render URL) |
| `REDIS_URL` | If using WebSockets (Channels); Render Redis add-on provides this |
| `RABBITMQ_URL` | If using Celery (background tasks) |

**Optional (features):**

| Variable | Description |
|----------|-------------|
| `GOOGLE_PLACES_API_KEY` | Google Places API key for address autocomplete |
| `OSRM_BASE_URL` | Default `https://router.project-osrm.org` (route matrix) |
| `AI_API_KEY` | Optional AI summary for requests |

**Build:**

- Run `python manage.py collectstatic --noinput` in the build command so `staticfiles/` is populated and Whitenoise can serve static files.

---

## 5) Warnings before push

1. **Do not push `.env`** — It must remain in `.gitignore`; only `.env.example` (no real secrets) should be committed.
2. **Run tests before push** — `py manage.py test stransport` (and `py manage.py test trivia` if you use it).
3. **Render build** — Ensure build command runs migrations and collectstatic, e.g. `python manage.py migrate --noinput && python manage.py collectstatic --noinput`.
4. **SECRET_KEY** — On first production deploy after this change, set `SECRET_KEY` in Render env; otherwise the app will raise on startup when `DEBUG=False`.
5. **Backup DB** — If you have production data, backup before deploying.

---

## 6) Recommended commit message

```
chore: safety review and cleanup before upgrade

- Require SECRET_KEY in production (settings)
- Add CSRF token to edit-request form (home.html)
- Remove obsolete stransport/views/favicon.py (duplicate of views.FaviconView)
- Add VALIDATION_REPORT.md with Render env vars and pre-push warnings
```

---

*End of report. No automatic push or deploy was performed.*
