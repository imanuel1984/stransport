STransport & Trivia
Video Demo:

<https://youtu.be/DhUeRmmpLrs>

---


## 🚗 STransport - Volunteer Transport Coordination Platform

Description

STransport is a lightweight web-based transportation coordination platform designed to connect patients who need rides with volunteer drivers. The system allows patients to create transport requests and volunteers to view, accept, or reject those requests. All behavior is role-aware, strictly enforced on the server, and reflected dynamically in the user interface.

This project applies core concepts learned throughout CS50x, including algorithms, data modeling, SQL databases, web development with Python, server-side authorization, and dynamic front-end interaction. The goal of the project is to solve a real-world coordination problem using a non-trivial, stateful web application.

The application implements a two-sided workflow with a clear request lifecycle (open → accepted → done / cancelled). If all volunteers reject a request, the system automatically cancels it and records that no volunteers were available, allowing the patient to clearly understand why the request was closed.

Distinctiveness and Complexity
Distinctiveness

This is not a simple CRUD application. The platform implements a two-party workflow with role-dependent behavior:

Volunteers see only requests they can act on: open requests they have not previously rejected and that have not already been globally cancelled due to lack of availability. Volunteers can accept or reject requests with a single click, and rejections are tracked per volunteer.

Patients see only their own requests. Open requests appear separately from closed or cancelled ones, and historical records include rides that were accepted but already assigned to a volunteer. Patients can cancel open requests and delete cancelled ones from their history.

The user interface and API responses change based on who is logged in, making the system fundamentally different from generic blog or to-do applications.

Complexity

Under the hood, the project includes several non-trivial components:

Aggregated rejection logic: Each volunteer’s rejection is stored with an optional reason. When all volunteers have rejected a request, the server automatically marks it as cancelled and sets no_volunteers_available = True, producing a clear explanation for the patient.

Role-scoped deletion endpoints: Volunteers may delete only requests they accepted and completed, while patients may delete only their own cancelled requests. All permissions are enforced server-side.

Optimized open-request feed: Volunteers never see requests they already rejected or requests that were globally cancelled due to lack of availability.

CSRF-aware, SPA-like front end: Pages are rendered server-side, but the UI behaves like a small single-page application using JavaScript to switch panels and update content dynamically.

Clear serialization boundary: A centralized serialization function controls how request objects are exposed to the front end, keeping templates minimal and front-end logic clean.

These elements together make the project both distinctive and significantly more complex than standard CRUD examples.

Project Structure
service/                    # Django project
  manage.py
  service/
    settings.py
    urls.py
    wsgi.py

  stransport/               # Main application
    apps.py
    models.py               # Profile, TransportRequest, TransportAssignment, TransportRejection
    views.py                # Role-aware JSON APIs + page view
    urls.py                 # Page routes + API routes
    signals.py              # Auto-create Profile for new User

    static/stransport/
      stransport.js         # SPA-like UI logic (fetch, CSRF, panels)
      stransport.css        # UI styling + animations

    templates/
      stransport/
        layout.html
        home.html
      registration/
        login.html
        signup.html

README.md
requirements.txt

Data Model

Profile: (user, role {patient | volunteer}, phone)

TransportRequest:
(patient, pickup_address, destination, requested_time, notes, status {open | accepted | done | cancelled}, no_volunteers_available)

TransportAssignment:
(request, volunteer, accepted_time, comment)

TransportRejection:
(request, volunteer, reason) — unique per volunteer per request

API Endpoints (JSON)

GET /api/requests/

Volunteer: open requests excluding previous rejections and globally cancelled ones

Patient: own open requests

POST /api/requests/create/ — Patient only

POST /api/requests/accept/<id>/ — Volunteer only

POST /api/requests/reject/<id>/ — Volunteer only (auto-cancels if all volunteers reject)

POST /api/requests/cancel/<id>/ — Patient only

GET /api/requests/accepted/ — Volunteer’s accepted requests

GET /api/requests/closed/ — Patient request history

POST /api/requests/delete/<id>/ — Role-restricted deletion

All write endpoints require authentication and CSRF protection.

Front End

static/stransport/stransport.js provides a dynamic interface:

Smooth panel switching between Open, Closed, and Accepted views

Inline actions for both roles

Visual emphasis for open requests via CSS animations

How to Run
python -m venv venv
source venv/bin/activate   # or venv\Scripts\activate on Windows
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver


Visit: http://localhost:8000

Design Decisions

Security: Django session authentication and CSRF protection; all role checks are enforced server-side.

Database: SQLite chosen for simplicity and portability.

Architecture: Clear separation between models, views, and serialized API responses.

UI strategy: Server-rendered pages enhanced with JavaScript to balance simplicity and interactivity.

Limitations and Future Work

No real-time updates (WebSockets could be added)

No geocoding or maps yet

No background cleanup of stale requests

Could add a distinct “completed” state instead of deletion for full audit history

Use of AI Tools

AI-based tools were used as an assistant for debugging and clarification. All architectural decisions, logic, and final implementation were completed by the author.
## 🎮 Trivia App - משחק טריוויה אינטראקטיבי עם AI

משחק טריוויה מתקדם עם תכונות AI חכמות, בנוי על Django.

### ✨ תכונות Trivia

- 💡 **רמזים חכמים מבוססי AI** - מקסימום 1 לכל שאלה
- 💬 **צ'אט עם AI לעזרה** - מקסימום 2 הודעות לכל שאלה
- 📖 **הסברים מפורטים** - מקסימום 1 לכל שאלה
- 🎯 **הגבלת שימוש** למניעת עומס API
- 🌐 **תמיכה מלאה בעברית**
- 🏆 **מערכת ניקוד ומעקב הישגים**

### 🐳 Docker - הרצה עם Docker Compose

```bash
# Clone the repository
git clone <your-repo-url>
cd cs50x-final-project

# הגדר משתני סביבה
export GROQ_API_KEY=your_groq_api_key_here
export DOCKER_USERNAME=your_dockerhub_username

# הרץ את האפליקציה
docker-compose up -d

# בדוק לוגים
docker-compose logs -f web

# עצור
docker-compose down
```

האפליקציה תהיה זמינה: http://localhost:8000

### 🚀 CI/CD עם GitHub Actions

הפרויקט כולל workflow אוטומטי לבניה ודחיפה אוטומטית ל-Docker Hub.

**הגדרת Secrets ב-GitHub:**
1. Settings → Secrets and variables → Actions
2. הוסף:
   - `DOCKER_USERNAME` - שם משתמש Docker Hub
   - `DOCKER_PASSWORD` - סיסמה או Access Token

**Workflow מופעל ב:**
- Push ל-`main`, `master`, `develop`
- יצירת tags: `v*.*.*`
- Pull Requests
- הפעלה ידנית

**Docker Images נוצרים:**
- `latest` - גרסה אחרונה
- `main` / `develop` - לפי branch
- `v1.0.0` - version tags
- `sha-abc123` - commit hash

### 📦 Docker Hub - דחיפה ידנית

```bash
docker login
docker tag trivia-app your-username/trivia-app:latest
docker push your-username/trivia-app:latest
```

### 🛠️ התקנה מקומית (ללא Docker)

```bash
pip install -r requirements.txt
export GROQ_API_KEY=your_api_key
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py runserver
```

### 🔑 משתני סביבה

- `GROQ_API_KEY` - (נדרש) API key לשירות Groq AI
- `SECRET_KEY` - Django secret key
- `DEBUG` - False בפרודקשן
- `ALLOWED_HOSTS` - רשימת hosts מורשים

---
