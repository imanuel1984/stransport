# --- FAVICON ---
import os
from django.http import FileResponse, Http404
from django.views import View

class FaviconView(View):
    def get(self, request):
        path = os.path.join(os.path.dirname(__file__), '../../favicon.ico')
        if not os.path.exists(path):
            raise Http404()
        return FileResponse(open(path, 'rb'), content_type='image/x-icon')
from django.shortcuts import render, get_object_or_404, redirect
from functools import wraps
from django.contrib.auth.decorators import login_required
from django.contrib.auth import login, authenticate, logout
from django.contrib.auth.forms import UserCreationForm
from django.http import JsonResponse
from django.db import models
from django.utils.dateparse import parse_datetime
from django.contrib.auth.models import User
from django.conf import settings
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
import logging
import math
import requests
from django.core.exceptions import ValidationError
from .models import (
    TransportRequest,
    TransportAssignment,
    Profile,
    TransportRejection,
    VolunteerLocation,
    RideOffer,
    normalize_israeli_phone,
)
from .tasks import notify_new_request, generate_ai_summary
import json
import re
import urllib.parse
from datetime import datetime, timedelta
import traceback
from django.utils import timezone
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt

logger = logging.getLogger(__name__)


def guest_home(request):
    """
    דף "כניסה כאורח" – מציג הסברים בלבד, בלי הפעלת פיצ'רים/קריאות לשרת.
    המעבר בין מטופל למתנדב נעשה דרך querystring: /guest/?role=sick|volunteer
    """
    role = request.GET.get("role", "sick")
    if role not in {"sick", "volunteer"}:
        role = "sick"
    return render(
        request,
        "stransport/home.html",
        {
            "guest_mode": True,
            "guest_role": role,
        },
    )


def login_required_json(view_func):
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            # Guest demo support: allow read-only GET/HEAD calls with ?guest=1
            # (write actions stay blocked because they are POST/PUT/PATCH/DELETE).
            is_guest_read = request.GET.get("guest") == "1" and request.method in {"GET", "HEAD"}
            if not is_guest_read:
                return JsonResponse({"error": "Authentication required"}, status=401)
        return view_func(request, *args, **kwargs)
    return _wrapped


# --- SIGNUP / LOGOUT ---
def signup(request):
    if request.method == "POST":
        is_json = request.content_type.startswith("application/json")
        try:
            if is_json:
                data = json.loads(request.body or "{}")
            else:
                data = request.POST

            form = UserCreationForm(data)
            role = data.get("role")
            if form.is_valid() and role in ["sick", "volunteer"]:
                user = form.save()
                Profile.objects.update_or_create(user=user, defaults={"role": role})
                login(request, user)

                if is_json:
                    return JsonResponse({"success": True})
                return redirect("home")

            if is_json:
                return JsonResponse({"success": False, "errors": form.errors})

            error_message = None
            if role not in ["sick", "volunteer"]:
                error_message = "בחר תפקיד תקין"
            return render(
                request,
                "registration/signup.html",
                {"form": form, "error_message": error_message},
            )
        except Exception as e:
            if is_json:
                return JsonResponse({"success": False, "error": str(e)})
            return render(
                request,
                "registration/signup.html",
                {"form": UserCreationForm(), "error_message": str(e)},
            )

    return render(request, "registration/signup.html", {"form": UserCreationForm()})


@csrf_exempt
def logout_view(request):
    """
    יציאה מהמערכת ללא דרישת CSRF, עבור GET או POST.
    זה בטוח כי הפעולה היחידה היא סיום הסשן.
    """
    logout(request)
    return redirect("login")


@csrf_exempt
@require_POST
def login_status_api(request):
    username = (request.POST.get("username") or "").strip()
    password = request.POST.get("password") or ""

    username_exists = False
    credentials_valid = False
    username_message = ""
    password_message = ""

    if not username:
        username_message = "יש להזין שם משתמש."
    else:
        username_exists = User.objects.filter(username=username).exists()
        username_message = (
            "שם המשתמש קיים במערכת."
            if username_exists
            else "שם המשתמש לא קיים במערכת."
        )

    if not password:
        password_message = "יש להזין סיסמה."
    elif not username_exists:
        password_message = "הסיסמה תיבדק אחרי ששם המשתמש יהיה תקין."
    else:
        credentials_valid = authenticate(
            request,
            username=username,
            password=password,
        ) is not None
        password_message = (
            "הסיסמה תואמת לשם המשתמש."
            if credentials_valid
            else "הסיסמה לא תואמת לשם המשתמש."
        )

    return JsonResponse(
        {
            "username_valid": username_exists,
            "password_valid": credentials_valid,
            "ready": username_exists and credentials_valid,
            "username_message": username_message,
            "password_message": password_message,
        }
    )


# --- CORS helper for frontend (React on port 5173) ---
def cors_json_response(response):
    response["Access-Control-Allow-Origin"] = "http://localhost:5173"
    return response


# --- HOME ---
@login_required
def home(request):
    delete_expired_requests()
    return render(request, "stransport/home.html", {"current_user": request.user})


# --- API: rides list for React frontend (id, from, to) ---
def rides_api(request):
    if request.method != "GET":
        resp = JsonResponse({"error": "Method not allowed"}, status=405)
        return cors_json_response(resp)
    try:
        # Return recent transport requests as { id, from, to } for frontend
        qs = TransportRequest.objects.all().order_by("-created_at")[:100]
        data = [
            {"id": r.id, "from": r.pickup_address or "", "to": r.destination or ""}
            for r in qs
        ]
        resp = JsonResponse(data, safe=False)
        return cors_json_response(resp)
    except Exception as e:
        resp = JsonResponse({"error": str(e)}, status=500)
        return cors_json_response(resp)


# --- SERIALIZER ---
def serialize_request(r):
    assignment = getattr(r, "transportassignment", None)
    volunteer_info = None
    if assignment:
        vol_profile = getattr(assignment.volunteer, "profile", None)
        volunteer_info = {
            "id": assignment.volunteer.id,
            "username": assignment.volunteer.username,
            "phone": vol_profile.phone if vol_profile else "",
        }

    status_label = (
        "No volunteers available"
        if (r.status == "cancelled" and getattr(r, "no_volunteers_available", False))
        else r.get_status_display()
    )

    return {
        "id": r.id,
        "sick_id": r.sick.id,
        "sick_username": r.sick.username,
        "pickup": r.pickup_address,
        "pickup_lat": r.pickup_lat,
        "pickup_lng": r.pickup_lng,
        "destination": r.destination,
        "dest_lat": r.dest_lat,
        "dest_lng": r.dest_lng,
        "requested_time": timezone.localtime(r.requested_time).strftime("%Y-%m-%d %H:%M") if not timezone.is_naive(r.requested_time) else r.requested_time.strftime("%Y-%m-%d %H:%M"),
        "status": r.status,
        "status_display": r.get_status_display(),
        "status_label": status_label,
        "notes": r.notes,
        "phone": getattr(r.sick.profile, "phone", ""),
        "volunteer": volunteer_info,
        "no_volunteers_available": r.no_volunteers_available,
        "cancel_reason": r.cancel_reason,
        "ai_summary": r.ai_summary,
    }


def delete_expired_requests():
    """
    מחק: (1) בקשות שמועד האיסוף עבר (לפחות 30 דקות), מלבד בוטלו לאחרונה.
    (2) בקשות מבוטלות ישנות – בוטלו לפני יותר מ־48 שעות (עד למחרת הביטול).
    """
    try:
        now = timezone.now()
        cutoff = now - timedelta(minutes=30)
        cancel_keep = now - timedelta(days=2)

        # (1) בקשות שמועדן עבר – לא למחוק בוטלו לאחרונה
        qs = TransportRequest.objects.filter(requested_time__lt=cutoff).exclude(
            models.Q(status="cancelled")
            & (
                models.Q(cancelled_at__gte=cancel_keep)
                | (models.Q(cancelled_at__isnull=True) & models.Q(requested_time__gte=cancel_keep))
            )
        )
        deleted_count, _ = qs.delete()
        if deleted_count:
            logger.info("delete_expired_requests: deleted %d request(s) with requested_time before %s", deleted_count, cutoff)

        # (2) בקשות מבוטלות ישנות – בוטלו לפני יותר מ־48 שעות
        old_cancelled = TransportRequest.objects.filter(
            status="cancelled"
        ).filter(
            models.Q(cancelled_at__lt=cancel_keep) | models.Q(cancelled_at__isnull=True, requested_time__lt=cancel_keep)
        )
        cancelled_count, _ = old_cancelled.delete()
        if cancelled_count:
            logger.info("delete_expired_requests: deleted %d old cancelled request(s)", cancelled_count)
    except Exception:
        logger.warning("Failed to delete expired transport requests", exc_info=True)


def check_request_not_expired(ride_request):
    """
    Block actions on a request whose time has passed.
    Do not delete here; deletion happens the next day in delete_expired_requests().
    """
    if ride_request.requested_time < timezone.now():
        return JsonResponse(
            {
                "success": False,
                "error": "תאריך הבקשה חלף. הבקשה תימחק למחרת.",
            },
            status=400,
        )
    return None


def parse_optional_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def haversine_meters(lat1, lng1, lat2, lng2):
    radius = 6371000
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius * c


def osrm_table(coords, base_url):
    if not coords:
        return None

    coord_str = ";".join([f"{lng},{lat}" for lat, lng in coords])
    url = f"{base_url.rstrip('/')}/table/v1/driving/{coord_str}"
    try:
        resp = requests.get(
            url,
            params={"annotations": "distance,duration"},
            timeout=6,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "distances": data.get("distances"),
            "durations": data.get("durations"),
        }
    except Exception:
        logger.warning("OSRM table failed", exc_info=True)
        return None


def geocode_address(address=None, place_id=None):
    api_key = getattr(settings, "GOOGLE_PLACES_API_KEY", "")
    if not api_key or (not address and not place_id):
        return None
    try:
        params = {"key": api_key, "region": "IL"}
        if place_id:
            params["place_id"] = place_id
        else:
            params["address"] = address
        resp = requests.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params=params,
            timeout=6,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "OK":
            return None
        result = (data.get("results") or [None])[0]
        if not result:
            return None
        location = result.get("geometry", {}).get("location")
        if not location:
            return None
        return (location.get("lat"), location.get("lng"))
    except Exception:
        logger.warning("Geocoding failed", exc_info=True)
        return None


def nearest_neighbor_order(start_coord, pickup_coords, matrix=None):
    if not pickup_coords:
        return []

    remaining = set(range(len(pickup_coords)))
    order = []
    current = start_coord
    current_index = 0

    while remaining:
        best = None
        best_dist = None
        for idx in remaining:
            if matrix:
                dist = matrix[current_index][idx + 1]
            else:
                dist = haversine_meters(current[0], current[1], pickup_coords[idx][0], pickup_coords[idx][1])
            if best is None or dist < best_dist:
                best = idx
                best_dist = dist
        order.append(best)
        current = pickup_coords[best]
        current_index = best + 1
        remaining.remove(best)
    return order


def two_opt(order, coords, start_coord, matrix=None):
    if len(order) < 4:
        return order

    def route_length(ord_list):
        total = 0
        prev = start_coord
        prev_index = 0
        for idx in ord_list:
            next_coord = coords[idx]
            if matrix:
                total += matrix[prev_index][idx + 1]
            else:
                total += haversine_meters(prev[0], prev[1], next_coord[0], next_coord[1])
            prev = next_coord
            prev_index = idx + 1
        return total

    improved = True
    best = order[:]
    best_len = route_length(best)

    while improved:
        improved = False
        for i in range(1, len(best) - 1):
            for j in range(i + 1, len(best)):
                candidate = best[:i] + best[i:j][::-1] + best[j:]
                cand_len = route_length(candidate)
                if cand_len < best_len:
                    best = candidate
                    best_len = cand_len
                    improved = True
        order = best
    return best


def broadcast_request_event(event, request_obj, notify_volunteers=True, notify_patient=True):
    channel_layer = get_channel_layer()
    if not channel_layer:
        return

    payload = {
        "type": "request.event",
        "event": event,
        "request": serialize_request(request_obj),
    }

    try:
        if notify_volunteers:
            async_to_sync(channel_layer.group_send)("volunteers", payload)
        if notify_patient:
            async_to_sync(channel_layer.group_send)(f"patient_{request_obj.sick_id}", payload)
    except Exception:
        logger.warning("Failed to broadcast realtime event", exc_info=True)


# --- API: OPEN REQUESTS ---
@login_required_json
def requests_api(request):
    try:
        delete_expired_requests()
        is_guest_read = request.GET.get("guest") == "1" and not request.user.is_authenticated
        role = getattr(request.user.profile, "role", "") if not is_guest_read else (request.GET.get("role") or "sick")
        now = timezone.now()
        cutoff = now - timedelta(days=1)
        if role == "volunteer":
            qs = TransportRequest.objects.filter(status="open", no_volunteers_available=False)
            if not is_guest_read:
                qs = qs.exclude(rejections__volunteer=request.user)
        elif role == "sick":
            # guest: show open requests read-only; user: show only their requests
            if is_guest_read:
                qs = TransportRequest.objects.filter(status="open")
            else:
                qs = TransportRequest.objects.filter(sick=request.user, status="open")
        else:
            qs = TransportRequest.objects.none()
        qs = qs.filter(requested_time__gte=cutoff).order_by("-created_at")
        data = []
        for r in qs:
            d = serialize_request(r)
            d["expired"] = r.requested_time < now
            data.append(d)
        return JsonResponse({"requests": data})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: CREATE REQUEST ---
@csrf_exempt
@login_required_json
def create_request_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "sick":
            return JsonResponse(
                {
                    "error": "Only sick users can create requests",
                    "message": "יש לנסות לצאת ולהיכנס שוב כמטופל.",
                },
                status=403,
            )

        data = json.loads(request.body)
        pickup = data.get("pickup")
        destination = data.get("destination")
        time_str = data.get("time")
        notes = data.get("notes", "")
        phone = data.get("phone", "")
        pickup_place_id = data.get("pickup_place_id")
        dest_place_id = data.get("dest_place_id")
        pickup_lat = parse_optional_float(data.get("pickup_lat"))
        pickup_lng = parse_optional_float(data.get("pickup_lng"))
        dest_lat = parse_optional_float(data.get("dest_lat"))
        dest_lng = parse_optional_float(data.get("dest_lng"))
        requested_time = parse_datetime(time_str)

        if not all([pickup, destination, requested_time]):
            return JsonResponse({"error": "Missing fields"}, status=400)

        if pickup_lat is None or pickup_lng is None:
            coords = geocode_address(pickup, pickup_place_id)
            if coords:
                pickup_lat, pickup_lng = coords
        if pickup_lat is None or pickup_lng is None:
            return JsonResponse({"error": "Pickup address must be selected from the list"}, status=400)

        if dest_lat is None or dest_lng is None:
            coords = geocode_address(destination, dest_place_id)
            if coords:
                dest_lat, dest_lng = coords
        if dest_lat is None or dest_lng is None:
            return JsonResponse({"error": "Destination address must be selected from the list"}, status=400)

        profile = request.user.profile
        if phone:
            try:
                profile.phone = normalize_israeli_phone(phone)
                profile.save()
            except ValidationError:
                return JsonResponse({"error": "Invalid phone number"}, status=400)

        r = TransportRequest.objects.create(
            sick=request.user,
            pickup_address=pickup,
            pickup_lat=pickup_lat,
            pickup_lng=pickup_lng,
            destination=destination,
            dest_lat=dest_lat,
            dest_lng=dest_lng,
            requested_time=requested_time,
            notes=notes,
        )
        try:
            notify_new_request.delay(r.id)
        except Exception:
            logger.warning("Failed to enqueue notify_new_request", exc_info=True)
        broadcast_request_event("request_created", r)
        return JsonResponse({"success": True, "id": r.id})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: ACCEPT REQUEST ---
@csrf_exempt
@login_required_json
def accept_request_api(request, req_id):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "volunteer":
            return JsonResponse({"error": "Only volunteers can accept"}, status=403)
        ride_request = get_object_or_404(TransportRequest, id=req_id, status="open")

        expired_response = check_request_not_expired(ride_request)
        if expired_response:
            return expired_response

        TransportAssignment.objects.create(request=ride_request, volunteer=request.user)
        ride_request.status = "accepted"
        ride_request.save()
        TransportRejection.objects.filter(request=ride_request).delete()
        broadcast_request_event("request_accepted", ride_request)
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: REJECT REQUEST ---
@login_required_json
def reject_request_api(request, req_id):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "volunteer":
            return JsonResponse({"error": "Only volunteers can reject"}, status=403)

        ride_request = get_object_or_404(TransportRequest, id=req_id)
        expired_response = check_request_not_expired(ride_request)
        if expired_response:
            return expired_response
        if ride_request.status != "open":
            return JsonResponse({"error": "Request not open"}, status=400)

        data = json.loads(request.body or "{}")
        reason = data.get("reason", "")
        TransportRejection.objects.get_or_create(
            request=ride_request,
            volunteer=request.user,
            defaults={"reason": reason},
        )

        total_volunteers = Profile.objects.filter(role="volunteer").count()
        rejected_count = TransportRejection.objects.filter(request=ride_request).count()

        if total_volunteers > 0 and rejected_count >= total_volunteers:
            ride_request.no_volunteers_available = True
            ride_request.status = "cancelled"
            ride_request.cancel_reason = "no_volunteers"
            ride_request.cancelled_at = timezone.now()
            ride_request.save()

        broadcast_request_event("request_rejected", ride_request)

        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: CANCEL REQUEST ---
@login_required_json
def cancel_request_api(request, req_id):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "sick":
            return JsonResponse({"error": "Only sick users can cancel"}, status=403)
        # Allow cancelling both open and accepted requests (e.g. joined a volunteer-published ride)
        ride_request = get_object_or_404(
            TransportRequest,
            id=req_id,
            sick=request.user,
        )
        if ride_request.status not in {"open", "accepted"}:
            return JsonResponse({"error": "Request cannot be cancelled"}, status=400)

        expired_response = check_request_not_expired(ride_request)
        if expired_response:
            return expired_response
        ride_request.status = "cancelled"
        ride_request.cancel_reason = "patient_cancelled"
        ride_request.cancelled_at = timezone.now()
        ride_request.save()
        broadcast_request_event("request_cancelled", ride_request)
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: ACCEPTED REQUESTS (VOLUNTEER) ---
@login_required_json
def accepted_requests_api(request):
    try:
        delete_expired_requests()
        is_guest_read = request.GET.get("guest") == "1" and not request.user.is_authenticated
        if is_guest_read:
            return JsonResponse({"requests": []})
        if request.user.profile.role != "volunteer":
            return JsonResponse({"requests": []})
        now = timezone.now()
        cutoff = now - timedelta(days=1)
        reqs = (
            TransportRequest.objects.filter(
                transportassignment__volunteer=request.user,
                status="accepted",
                requested_time__gte=cutoff,
            )
            .distinct()
            .order_by("requested_time")
        )
        data = []
        for r in reqs:
            d = serialize_request(r)
            d["expired"] = r.requested_time < now
            data.append(d)
        return JsonResponse({"requests": data})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: CLOSED REQUESTS (SICK) ---
@login_required_json
def closed_requests_api(request):
    try:
        delete_expired_requests()
        is_guest_read = request.GET.get("guest") == "1" and not request.user.is_authenticated
        if is_guest_read:
            return JsonResponse({"requests": []})
        if request.user.profile.role != "sick":
            return JsonResponse({"requests": []})

        now = timezone.now()
        cutoff = now - timedelta(days=1)
        # בקשות מבוטלות: להציג עד למחרת הביטול (48 שעות)
        cancel_cutoff = now - timedelta(days=2)
        qs = TransportRequest.objects.filter(sick=request.user).filter(
            models.Q(status="done", requested_time__gte=cutoff)
            | models.Q(status="accepted", transportassignment__isnull=False, requested_time__gte=cutoff)
            | models.Q(status="cancelled", cancelled_at__gte=cancel_cutoff)
            | models.Q(status="cancelled", cancelled_at__isnull=True, requested_time__gte=cancel_cutoff)
        ).order_by("requested_time")

        data = []
        for r in qs:
            d = serialize_request(r)
            d["expired"] = r.requested_time < now
            data.append(d)
        return JsonResponse({"requests": data})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: DELETE REQUEST ---
@login_required_json
def delete_request_api(request, req_id):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        role = getattr(request.user.profile, "role", "")
        if role == "volunteer":
            TransportRequest.objects.filter(
                id=req_id, transportassignment__volunteer=request.user
            ).delete()
        elif role == "sick":
            TransportRequest.objects.filter(
                id=req_id, sick=request.user, status="cancelled"
            ).delete()
        else:
            return JsonResponse({"error": "Unauthorized"}, status=403)
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: VOLUNTEER LIVE LOCATION ---
@csrf_exempt
@login_required_json
def volunteer_location_api(request, req_id):
    """
    POST (volunteer): update live location for an accepted request.
    GET (sick): get last known volunteer location for own accepted, upcoming request.
    """
    try:
        try:
            ride_request = TransportRequest.objects.get(id=req_id)
        except TransportRequest.DoesNotExist:
            return JsonResponse({"error": "request_not_found"}, status=404)

        if request.method == "POST":
            try:
                role = getattr(request.user.profile, "role", None)
            except Exception:
                role = None
            if role != "volunteer":
                return JsonResponse({"error": "Only volunteers can update location"}, status=403)
            assignment = TransportAssignment.objects.filter(
                request=ride_request,
                volunteer=request.user,
            ).first()
            if not assignment:
                return JsonResponse({"error": "not_assigned", "detail": "You are not assigned to this request"}, status=403)
            try:
                raw = request.body
                data = json.loads((raw.decode("utf-8") if raw else "{}"))
            except (ValueError, UnicodeDecodeError, AttributeError):
                return JsonResponse({"error": "Invalid JSON body"}, status=400)

            # Allow volunteer to explicitly stop sharing location for this request
            if data.get("stop") is True:
                try:
                    VolunteerLocation.objects.filter(assignment=assignment).delete()
                except Exception:
                    logger.warning("Failed to delete VolunteerLocation (req_id=%s)", req_id, exc_info=True)
                return JsonResponse({"success": True, "stopped": True})

            lat = parse_optional_float(data.get("lat"))
            lng = parse_optional_float(data.get("lng"))
            if lat is None or lng is None:
                return JsonResponse({"error": "Invalid coordinates"}, status=400)
            try:
                loc, _created = VolunteerLocation.objects.update_or_create(
                    assignment=assignment,
                    defaults={"lat": float(lat), "lng": float(lng)},
                )
            except Exception as e:
                logger.exception("VolunteerLocation update_or_create failed (req_id=%s): %s", req_id, e)
                return JsonResponse(
                    {"error": "Server error saving location", "detail": str(e)},
                    status=500,
                )
            updated_at = getattr(loc, "updated_at", None)
            return JsonResponse(
                {
                    "success": True,
                    "lat": loc.lat,
                    "lng": loc.lng,
                    "updated_at": updated_at.isoformat() if updated_at else timezone.now().isoformat(),
                }
            )

        # GET: patient side
        profile = getattr(request.user, "profile", None)
        if not profile or getattr(profile, "role", None) != "sick" or ride_request.sick_id != request.user.id:
            return JsonResponse({"error": "Only the owning patient can view location"}, status=403)

        # Show location only from 45 min before until 30 min after requested pickup time
        window_minutes = 45
        now = timezone.now()
        window_start = ride_request.requested_time - timedelta(minutes=window_minutes)
        window_end = ride_request.requested_time + timedelta(minutes=30)
        if now < window_start:
            return JsonResponse({"too_early": True})
        if now > window_end:
            return JsonResponse({"too_late": True})

        assignment = getattr(ride_request, "transportassignment", None)
        if not assignment:
            return JsonResponse({"no_assignment": True})
        try:
            loc = assignment.location
        except VolunteerLocation.DoesNotExist:
            return JsonResponse({"no_location": True})

        return JsonResponse(
            {
                "lat": loc.lat,
                "lng": loc.lng,
                "updated_at": loc.updated_at.isoformat(),
                "pickup_lat": ride_request.pickup_lat,
                "pickup_lng": ride_request.pickup_lng,
            }
        )
    except Http404:
        raise
    except Exception as e:
        logger.exception("volunteer_location_api error (req_id=%s): %s", req_id, e)
        payload = {"error": "Server error. Check server logs."}
        if getattr(settings, "DEBUG", False):
            payload["detail"] = str(e)
        return JsonResponse(payload, status=500)


# --- API: ROUTE SUGGESTION ---
@csrf_exempt
@login_required_json
def suggest_route_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "volunteer":
            return JsonResponse({"error": "Only volunteers can suggest routes"}, status=403)

        delete_expired_requests()

        data = json.loads(request.body or "{}")
        start_lat = parse_optional_float(data.get("start_lat"))
        start_lng = parse_optional_float(data.get("start_lng"))
        request_ids = data.get("request_ids", [])
        mode = data.get("mode", "pickup_only")

        if start_lat is None or start_lng is None:
            return JsonResponse({"error": "Missing start location"}, status=400)
        if not isinstance(request_ids, list) or not request_ids:
            return JsonResponse({"error": "No requests selected"}, status=400)
        if len(request_ids) > 6:
            return JsonResponse({"error": "Max 6 requests"}, status=400)
        if mode not in {"pickup_only", "pickup_then_dropoff"}:
            return JsonResponse({"error": "Invalid mode"}, status=400)

        now = timezone.now()
        # אפשר לבחור גם בקשות פתוחות וגם בקשות מאושרות (שהמתנדב מקושר אליהן)
        qs = TransportRequest.objects.filter(id__in=request_ids).filter(
            models.Q(
                status="open",
                no_volunteers_available=False,
                requested_time__gte=now,
            )
            | models.Q(
                status="accepted",
                transportassignment__volunteer=request.user,
            )
        ).distinct()
        requests_map = {r.id: r for r in qs}
        if len(requests_map) != len(request_ids):
            return JsonResponse({"error": "Some requests are not available or not assigned to you"}, status=400)

        for req in requests_map.values():
            updated = False
            if req.pickup_address and (req.pickup_lat is None or req.pickup_lng is None):
                coords = geocode_address(req.pickup_address)
                if coords:
                    req.pickup_lat, req.pickup_lng = coords
                    updated = True
            if mode == "pickup_then_dropoff" and req.destination and (req.dest_lat is None or req.dest_lng is None):
                coords = geocode_address(req.destination)
                if coords:
                    req.dest_lat, req.dest_lng = coords
                    updated = True
            if updated:
                req.save(update_fields=["pickup_lat", "pickup_lng", "dest_lat", "dest_lng"])

        missing_coords = [
            r.id
            for r in requests_map.values()
            if r.pickup_lat is None
            or r.pickup_lng is None
            or (mode == "pickup_then_dropoff" and (r.dest_lat is None or r.dest_lng is None))
        ]

        missing_dest = [
            r.id
            for r in requests_map.values()
            if mode == "pickup_then_dropoff" and (r.dest_lat is None or r.dest_lng is None)
        ]

        warning = None
        if mode == "pickup_then_dropoff" and missing_dest:
            mode = "pickup_only"
            warning = "יש בקשות ללא יעד. מחשב מסלול לאיסופים בלבד."

        valid_requests = [r for r in requests_map.values() if r.id not in set(missing_coords)]
        if not valid_requests:
            return JsonResponse(
                {
                    "success": True,
                    "mode": mode,
                    "stops": [],
                    "legs": [],
                    "total_distance_m": 0,
                    "total_duration_s": 0,
                    "matrix_source": "n/a",
                    "skipped": missing_coords,
                    "warning": "אין בקשות עם קואורדינטות למסלול.",
                }
            )

        pickup_coords = [(r.pickup_lat, r.pickup_lng) for r in valid_requests]
        pickups_list = list(valid_requests)
        start_coord = (start_lat, start_lng)

        coords_for_matrix = [start_coord] + pickup_coords
        if mode == "pickup_then_dropoff":
            coords_for_matrix += [(r.dest_lat, r.dest_lng) for r in pickups_list]

        osrm = osrm_table(coords_for_matrix, settings.OSRM_BASE_URL)
        matrix_dist = osrm["distances"] if osrm else None
        matrix_dur = osrm["durations"] if osrm else None

        order = nearest_neighbor_order(start_coord, pickup_coords, matrix_dist)
        order = two_opt(order, pickup_coords, start_coord, matrix_dist)

        ordered_requests = [pickups_list[idx] for idx in order]

        stops = []
        for req in ordered_requests:
            stops.append(
                {
                    "type": "pickup",
                    "request_id": req.id,
                    "label": req.pickup_address,
                    "lat": req.pickup_lat,
                    "lng": req.pickup_lng,
                }
            )
        if mode == "pickup_then_dropoff":
            for req in ordered_requests:
                stops.append(
                    {
                        "type": "dropoff",
                        "request_id": req.id,
                        "label": req.destination,
                        "lat": req.dest_lat,
                        "lng": req.dest_lng,
                    }
                )

        nodes = [
            {
                "type": "start",
                "label": "start",
                "lat": start_lat,
                "lng": start_lng,
            }
        ] + stops

        total_distance = 0
        total_duration = 0
        legs = []

        for idx in range(len(nodes) - 1):
            a = nodes[idx]
            b = nodes[idx + 1]
            if matrix_dist and matrix_dur:
                dist = matrix_dist[idx][idx + 1]
                dur = matrix_dur[idx][idx + 1]
            else:
                dist = haversine_meters(a["lat"], a["lng"], b["lat"], b["lng"])
                dur = dist / 11.11

            legs.append(
                {
                    "from": a,
                    "to": b,
                    "distance_m": dist,
                    "duration_s": dur,
                }
            )
            total_distance += dist
            total_duration += dur

        return JsonResponse(
            {
                "success": True,
                "mode": mode,
                "stops": stops,
                "legs": legs,
                "total_distance_m": total_distance,
                "total_duration_s": total_duration,
                "matrix_source": "osrm" if osrm else "haversine",
                "skipped": missing_coords,
                "warning": warning,
            }
        )
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: ROUTE LINKS ---
@login_required_json
def route_links_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        data = json.loads(request.body or "{}")
        start = data.get("start") or {}
        stops = data.get("stops") or []

        def parse_coord(value):
            try:
                return float(value)
            except (TypeError, ValueError):
                return None

        start_lat = parse_coord(start.get("lat"))
        start_lng = parse_coord(start.get("lng"))
        if start_lat is None or start_lng is None:
            return JsonResponse({"error": "Missing start location"}, status=400)
        if not (-90 <= start_lat <= 90 and -180 <= start_lng <= 180):
            return JsonResponse({"error": "Invalid start location"}, status=400)

        if not isinstance(stops, list) or len(stops) < 1:
            return JsonResponse({"error": "At least one stop is required"}, status=400)

        clean_stops = []
        for stop in stops:
            if not isinstance(stop, dict):
                return JsonResponse({"error": "Invalid stop"}, status=400)
            lat = parse_coord(stop.get("lat"))
            lng = parse_coord(stop.get("lng"))
            if lat is None or lng is None:
                return JsonResponse({"error": "Invalid stop"}, status=400)
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                return JsonResponse({"error": "Invalid stop"}, status=400)
            clean_stops.append((lat, lng))

        warning = None
        if len(clean_stops) > 10:
            clean_stops = clean_stops[:10]
            warning = "Too many stops. Limited to 10."

        def fmt(lat, lng):
            return f"{lat},{lng}"

        origin = fmt(start_lat, start_lng)
        destination = fmt(clean_stops[-1][0], clean_stops[-1][1])
        waypoints_list = clean_stops[:-1]
        google_params = {
            "api": 1,
            "origin": origin,
            "destination": destination,
        }
        if waypoints_list:
            google_params["waypoints"] = "|".join(fmt(lat, lng) for lat, lng in waypoints_list)

        google_full_route = "https://www.google.com/maps/dir/?" + urllib.parse.urlencode(google_params)

        google_legs = []
        waze_legs = []
        current_lat, current_lng = start_lat, start_lng
        for lat, lng in clean_stops:
            leg_params = {
                "api": 1,
                "origin": fmt(current_lat, current_lng),
                "destination": fmt(lat, lng),
            }
            google_legs.append("https://www.google.com/maps/dir/?" + urllib.parse.urlencode(leg_params))
            waze_legs.append(f"https://waze.com/ul?ll={lat},{lng}&navigate=yes")
            current_lat, current_lng = lat, lng

        return JsonResponse(
            {
                "google_full_route": google_full_route,
                "google_legs": google_legs,
                "waze_legs": waze_legs,
                "warning": warning,
            }
        )
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: UPDATE REQUEST ---
@csrf_exempt
@login_required_json
def update_request_api(request, req_id):
    if request.method not in {"PATCH", "POST"}:
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "sick":
            return JsonResponse({"error": "Only sick users can update requests"}, status=403)

        ride_request = get_object_or_404(
            TransportRequest,
            id=req_id,
            sick=request.user,
            status="open",
        )

        expired_response = check_request_not_expired(ride_request)
        if expired_response:
            return expired_response

        data = json.loads(request.body or "{}")
        pickup = data.get("pickup")
        destination = data.get("destination")
        time_str = data.get("time")
        notes = data.get("notes")
        pickup_place_id = data.get("pickup_place_id")
        dest_place_id = data.get("dest_place_id")
        pickup_lat = parse_optional_float(data.get("pickup_lat"))
        pickup_lng = parse_optional_float(data.get("pickup_lng"))
        dest_lat = parse_optional_float(data.get("dest_lat"))
        dest_lng = parse_optional_float(data.get("dest_lng"))

        if pickup is not None:
            if pickup_lat is None or pickup_lng is None:
                coords = geocode_address(pickup, pickup_place_id)
                if coords:
                    pickup_lat, pickup_lng = coords
            if pickup_lat is None or pickup_lng is None:
                return JsonResponse({"error": "Pickup address must be selected from the list"}, status=400)
            ride_request.pickup_address = pickup
            ride_request.pickup_lat = pickup_lat
            ride_request.pickup_lng = pickup_lng

        if destination is not None:
            if dest_lat is None or dest_lng is None:
                coords = geocode_address(destination, dest_place_id)
                if coords:
                    dest_lat, dest_lng = coords
            if dest_lat is None or dest_lng is None:
                return JsonResponse({"error": "Destination address must be selected from the list"}, status=400)
            ride_request.destination = destination
            ride_request.dest_lat = dest_lat
            ride_request.dest_lng = dest_lng

        if time_str is not None:
            requested_time = parse_datetime(time_str)
            if not requested_time:
                return JsonResponse({"error": "Invalid time"}, status=400)
            ride_request.requested_time = requested_time

        if notes is not None:
            ride_request.notes = notes

        ride_request.save()
        broadcast_request_event("request_updated", ride_request)
        return JsonResponse({"success": True, "request": serialize_request(ride_request)})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: GENERATE AI SUMMARY ---
@login_required_json
def generate_summary_api(request, req_id):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "sick":
            return JsonResponse({"error": "Only sick users can summarize"}, status=403)
        ride_request = get_object_or_404(TransportRequest, id=req_id, sick=request.user)
        generate_ai_summary.delay(ride_request.id)
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- מצב AI: ולידציה לטקסט חופשי (מוצא, יעד, זמן) ---
def validate_ai_ride_text(raw_text):
    """
    בודק אם בטקסט יש רמזים למוצא, יעד וזמן. מחזיר (True, None) אם תקין, אחרת (False, רשימת חסרים).
    """
    if not raw_text or len(raw_text.strip()) < 3:
        return False, ["מוצא", "יעד", "זמן"]
    t = raw_text.strip().lower()
    # זמן: שעה (12:00, 10:30), "בשעה", "ב-10", "מחר", "יום ראשון", תאריך עם ספרות
    time_ok = (
        bool(re.search(r"\d{1,2}\s*:\s*\d{2}", t))  # 10:00
        or "בשעה" in t
        or re.search(r"\bב[- ]?\d{1,2}\b", t)  # ב-10, ב 10
        or "מחר" in t
        or "היום" in t
        or "יום " in t  # יום ראשון וכו'
        or bool(re.search(r"\d{1,2}[./]\d{1,2}", t))  # 15.3 או 15/03
    )
    # מוצא: "מ-", "מתל", "מירושלים", "מאיפה", "מ " + מילה
    origin_ok = (
        "מ-" in t
        or t.startswith("מ ")
        or "מתל" in t
        or "מירושלים" in t
        or "מחיפה" in t
        or "מאיפה" in t
        or "מוצא" in t
        or bool(re.search(r"\bמ\s+\w+", t))
    )
    # יעד: "ל-", "לתל", "לירושלים", "ליעד", "עד "
    dest_ok = (
        "ל-" in t
        or t.startswith("ל ")
        or "לתל" in t
        or "לירושלים" in t
        or "לחיפה" in t
        or "ליעד" in t
        or "יעד" in t
        or "עד " in t
        or bool(re.search(r"\bל\s+\w+", t))
    )
    missing = []
    if not time_ok:
        missing.append("זמן (תאריך/שעה)")
    if not origin_ok:
        missing.append("מוצא (מאיפה)")
    if not dest_ok:
        missing.append("יעד (לאן)")
    if missing:
        return False, missing
    return True, None


def parse_ai_ride_to_request(raw_text):
    """
    מנסה לחלץ מטקסט חופשי: מוצא, יעד, זמן. מחזיר dict עם pickup_address, destination, requested_time (datetime)
    או None אם לא הצלחנו לפרסר. בלי AI – רק חוקים פשוטים (מ X ל Y, מחר/שעה).
    """
    if not raw_text or len(raw_text.strip()) < 5:
        return None
    t = raw_text.strip()
    # חילוץ מוצא ויעד: "מ... ל..." או "מתל אביב לירושלים"
    from_to = re.search(r"מ\s*(.+?)\s+ל\s*(.+)", t, re.DOTALL)
    if not from_to:
        from_to = re.search(r"ממ\s*(.+?)\s+ל\s*(.+)", t)  # טעות הקלדה
    if from_to:
        pickup_address = from_to.group(1).strip()
        destination = from_to.group(2).strip()
        # להסיר מיעד רק סוף משפט (זמן): מחר, היום, ב-10, בשעה
        for sep in [" מחר", " היום", " ב-", " בשעה", ".", ","]:
            if sep in destination:
                destination = destination.split(sep)[0].strip()
    else:
        pickup_address = destination = ""
    # חילוץ זמן: שעה (10:00), מחר, היום
    requested_time = None
    time_match = re.search(r"(\d{1,2})\s*:\s*(\d{2})", t)
    hour = 10
    minute = 0
    if time_match:
        hour = int(time_match.group(1)) % 24
        minute = int(time_match.group(2)) % 60
    from datetime import datetime as dt
    now = timezone.now()
    if "מחר" in t:
        day = now.date() + timedelta(days=1)
    elif "היום" in t:
        day = now.date()
    else:
        day = now.date() + timedelta(days=1)  # ברירת מחדל מחר
    try:
        requested_time = timezone.make_aware(dt(day.year, day.month, day.day, hour, minute, 0), timezone.get_current_timezone())
    except Exception:
        requested_time = now + timedelta(days=1)
        requested_time = requested_time.replace(hour=10, minute=0, second=0, microsecond=0)
    if not pickup_address or not destination:
        return None
    return {
        "pickup_address": pickup_address[:255],
        "destination": destination[:255],
        "requested_time": requested_time,
    }


@csrf_exempt
@login_required_json
def ai_offer_api(request):
    """מתנדב מפרסם נסיעה עתידית (טופס פרסום נסיעה)."""
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if getattr(request.user.profile, "role", None) != "volunteer":
            return JsonResponse({"error": "רק מתנדבים יכולים לפרסם הצעת נסיעה"}, status=403)
        data = json.loads(request.body or "{}")
        from_addr = (data.get("from") or "").strip()
        to_addr = (data.get("to") or "").strip()
        date = (data.get("date") or "").strip()
        time = (data.get("time") or "").strip()
        notes = (data.get("notes") or "").strip()
        phone = (data.get("phone") or "").strip()
        from_lat = parse_optional_float(data.get("from_lat"))
        from_lng = parse_optional_float(data.get("from_lng"))
        to_lat = parse_optional_float(data.get("to_lat"))
        to_lng = parse_optional_float(data.get("to_lng"))

        if not from_addr or not to_addr or not date or not time:
            return JsonResponse({"error": "יש למלא מוצא, יעד, תאריך ושעה."}, status=400)

        parsed_date = None
        parsed_time = None
        try:
            parsed_date = datetime.strptime(date, "%Y-%m-%d").date()
        except Exception:
            parsed_date = None
        try:
            parsed_time = datetime.strptime(time, "%H:%M").time()
        except Exception:
            parsed_time = None

        # Fallback: try geocoding if coords not provided
        if (from_lat is None or from_lng is None) and from_addr:
            coords = geocode_address(from_addr)
            if coords:
                from_lat, from_lng = coords
        if (to_lat is None or to_lng is None) and to_addr:
            coords = geocode_address(to_addr)
            if coords:
                to_lat, to_lng = coords

        raw_text = (
            f"נסיעה עתידית מ-{from_addr} אל {to_addr} בתאריך {date} בשעה {time}"
            + (f" · הערות: {notes}" if notes else "")
            + (f" · טלפון: {phone}" if phone else "")
        )

        offer = RideOffer.objects.create(
            volunteer=request.user,
            raw_text=raw_text,
            status="open",
            parsed_from=from_addr,
            parsed_to=to_addr,
            parsed_date=parsed_date,
            parsed_time=parsed_time,
            from_lat=from_lat,
            from_lng=from_lng,
            to_lat=to_lat,
            to_lng=to_lng,
        )
        return JsonResponse({"success": True, "id": offer.id, "message": "הנסיעה פורסמה ומוצעת למטופלים."})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@login_required_json
def ai_offers_list_api(request):
    """רשימת הצעות נסיעה פתוחות (למטופל להצגת התאמות)."""
    if request.method != "GET":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        offers = RideOffer.objects.filter(status="open").select_related("volunteer").order_by("-created_at")[:50]
        data = [
            {
                "id": o.id,
                "raw_text": o.raw_text,
                "volunteer_username": o.volunteer.username,
                "created_at": o.created_at.isoformat(),
                "parsed_from": o.parsed_from or "",
                "parsed_to": o.parsed_to or "",
                "from_lat": o.from_lat,
                "from_lng": o.from_lng,
                "to_lat": o.to_lat,
                "to_lng": o.to_lng,
            }
            for o in offers
        ]
        return JsonResponse({"offers": data})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@login_required_json
def ai_auto_suggestions_api(request):
    """
    סוכן AI אוטומטי: מזהה התאמות בין המטופל למתנדב ומחזיר הצעות לרול הנוכחי.
    אין כאן "דחיפה" אמיתית בזמן-אמת (ללא WebSockets בדף) — ה-frontend עושה Poll.
    """
    if request.method != "GET":
        return JsonResponse({"error": "Invalid request"}, status=400)

    try:
        role = getattr(request.user.profile, "role", None) or ""
    except Exception:
        role = ""

    # Patient side: show matching RideOffers for the latest open TransportRequest
    if role == "sick":
        req = (
            TransportRequest.objects.filter(sick=request.user, status="open")
            .order_by("-created_at")
            .first()
        )
        if not req:
            return JsonResponse({"role": "sick", "suggestion_key": "", "offers": []})

        offers_qs = (
            RideOffer.objects.filter(status="open")
            .select_related("volunteer")
            .order_by("-created_at")[:30]
        )
        scored_offers = []
        for o in offers_qs:
            offer_when = _parse_offer_datetime(o) or (timezone.now() + timedelta(hours=1))
            sc = _score_request_against_offer(req, o, offer_when)
            if sc >= 0.2:
                scored_offers.append(
                    {
                        "id": o.id,
                        "raw_text": o.raw_text,
                        "volunteer_username": o.volunteer.username,
                        "score": round(sc, 2),
                    }
                )

        scored_offers.sort(key=lambda x: x.get("score") or 0, reverse=True)
        matches = scored_offers[:5]

        best_offer_id = ''
        if matches and isinstance(matches, list) and len(matches) > 0:
            try:
                best_offer_id = str(matches[0].get('id') or '')
            except Exception:
                best_offer_id = ''
        suggestion_key = "sick|" + str(req.id) + "|" + best_offer_id
        return JsonResponse({"role": "sick", "suggestion_key": suggestion_key, "offers": matches})

    # Volunteer side: show matching patient TransportRequests for the volunteer's open RideOffers
    if role == "volunteer":
        offers_qs = (
            RideOffer.objects.filter(volunteer=request.user, status="open")
            .order_by("-created_at")[:8]
        )
        offers_list = list(offers_qs)
        if not offers_list:
            return JsonResponse({"role": "volunteer", "suggestion_key": "", "requests": []})

        requests_qs = (
            TransportRequest.objects.filter(status="open", no_volunteers_available=False)
            .exclude(rejections__volunteer=request.user)
            .order_by("-requested_time")[:20]
        )

        candidates = []
        for r in requests_qs:
            best_score = 0.0
            best_offer_id = None
            for o in offers_list:
                offer_when = _parse_offer_datetime(o) or (timezone.now() + timedelta(hours=1))
                sc = _score_request_against_offer(r, o, offer_when)
                if sc > best_score:
                    best_score = sc
                    best_offer_id = o.id

            if best_score < 0.2:
                continue
            sr = serialize_request(r)
            sr["match_score"] = round(best_score, 2)
            sr["match_reason"] = "התאמה לפי קואורדינטות/כתובות וזמן"
            sr["matched_offer_id"] = best_offer_id
            candidates.append(sr)

        candidates.sort(key=lambda x: (x.get("match_score") or 0), reverse=True)
        candidates = candidates[:5]

        best_req_id = ''
        best_offer_id = ''
        if candidates and isinstance(candidates, list) and len(candidates) > 0:
            best_req_id = str(candidates[0].get('id') or '')
            best_offer_id = str(candidates[0].get('matched_offer_id') or '')
        suggestion_key = "vol|" + best_req_id + "|" + best_offer_id
        return JsonResponse({"role": "volunteer", "suggestion_key": suggestion_key, "requests": candidates})

    return JsonResponse({"role": role, "suggestion_key": "", "offers": [], "requests": []})


@csrf_exempt
@login_required_json
def ai_my_offers_api(request):
    """
    רשימת נסיעות שפורסמו ע"י המתנדב המחובר – להצגה בפאנל המתנדב.
    """
    if request.method != "GET":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        profile = getattr(request.user, "profile", None)
        if not profile or getattr(profile, "role", None) != "volunteer":
            return JsonResponse({"offers": []})
        # Show only currently published (open) offers in the "My published rides" list.
        # Once a patient joins, the offer becomes "matched" and should disappear from here.
        offers = (
            RideOffer.objects.filter(volunteer=request.user, status="open")
            .order_by("-created_at")[:50]
        )
        data = [
            {
                "id": o.id,
                "raw_text": o.raw_text,
                "status": o.status,
                "created_at": o.created_at.isoformat(),
                "from": o.parsed_from or "",
                "to": o.parsed_to or "",
            }
            for o in offers
        ]
        return JsonResponse({"offers": data})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@login_required_json
def ai_offer_cancel_api(request, offer_id):
    """
    ביטול פרסום נסיעה של מתנדב.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        profile = getattr(request.user, "profile", None)
        if not profile or getattr(profile, "role", None) != "volunteer":
            return JsonResponse({"error": "רק מתנדב יכול לבטל פרסום נסיעה"}, status=403)
        offer = get_object_or_404(RideOffer, id=offer_id, volunteer=request.user)
        offer.status = "cancelled"
        offer.save(update_fields=["status"])
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


def _parse_offer_datetime(offer):
    """
    ניסיון להוציא את התאריך/שעה מהנסיעה הפורסמה.
    קודם משתמש ב-parsed_date/parsed_time ואז fallback דרך regex על raw_text.
    """
    try:
        if getattr(offer, "parsed_date", None) and getattr(offer, "parsed_time", None):
            dt = datetime.combine(offer.parsed_date, offer.parsed_time)
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_current_timezone())
            return dt
    except Exception:
        pass

    # Fallback לפי הטקסט:
    # "נסיעה עתידית מ-{from} אל {to} בתאריך YYYY-MM-DD בשעה HH:MM ..."
    try:
        raw = getattr(offer, "raw_text", "") or ""
        m = re.search(r"בתאריך\s+(\d{4}-\d{2}-\d{2})\s+בשעה\s+(\d{2}:\d{2})", raw)
        if not m:
            return None
        d = datetime.strptime(m.group(1), "%Y-%m-%d").date()
        t = datetime.strptime(m.group(2), "%H:%M").time()
        dt = datetime.combine(d, t)
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt
    except Exception:
        return None


def _score_request_against_offer(req, offer, offer_when):
    """
    ציון התאמה פשוט כדי לזהות אם יש ללקוח כבר TransportRequest פתוחה תואמת,
    כדי שלא ניצור בקשה כפולה.
    """
    score = 0.0
    pickup_req = (getattr(req, "pickup_address", "") or "").strip()
    dest_req = (getattr(req, "destination", "") or "").strip()
    pickup_offer = (getattr(offer, "parsed_from", "") or "").strip()
    dest_offer = (getattr(offer, "parsed_to", "") or "").strip()

    if pickup_req and pickup_offer:
        a = pickup_req.lower()
        b = pickup_offer.lower()
        if b in a or a in b:
            score += 0.45

    if dest_req and dest_offer:
        a = dest_req.lower()
        b = dest_offer.lower()
        if b in a or a in b:
            score += 0.45

    # ציון לפי מרחק קואורדינטות (אם קיימות)
    try:
        if (
            getattr(req, "pickup_lat", None) is not None
            and getattr(req, "pickup_lng", None) is not None
            and getattr(offer, "from_lat", None) is not None
            and getattr(offer, "from_lng", None) is not None
        ):
            dist_pickup = haversine_meters(req.pickup_lat, req.pickup_lng, offer.from_lat, offer.from_lng)
            if dist_pickup <= 2000:
                score += 0.15
    except Exception:
        pass

    try:
        if (
            getattr(req, "dest_lat", None) is not None
            and getattr(req, "dest_lng", None) is not None
            and getattr(offer, "to_lat", None) is not None
            and getattr(offer, "to_lng", None) is not None
        ):
            dist_dest = haversine_meters(req.dest_lat, req.dest_lng, offer.to_lat, offer.to_lng)
            if dist_dest <= 2000:
                score += 0.15
    except Exception:
        pass

    # זמן (חלון ±3 שעות)
    try:
        if offer_when and getattr(req, "requested_time", None):
            if timezone.is_naive(req.requested_time):
                req_time = timezone.make_aware(req.requested_time, timezone.get_current_timezone())
            else:
                req_time = req.requested_time
            delta_hours = abs((req_time - offer_when).total_seconds()) / 3600.0
            if delta_hours <= 3.0:
                score += 0.2
    except Exception:
        pass

    return min(1.0, score)


@csrf_exempt
@login_required_json
def ai_join_offer_api(request, offer_id):
    """
    מטופל לוחץ "הצטרפות לנסיעה" על הצעת נסיעה:
    - יוצר בקשת נסיעה (TransportRequest) עבור המטופל
    - מסמן את ההצעה כ"הותאם"
    - יוצר שיוך למתנדב (TransportAssignment) כך שהנסיעה תופיע כמאושרת אצל המתנדב.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        # רק מטופל יכול להצטרף
        profile = getattr(request.user, "profile", None)
        if not profile or getattr(profile, "role", None) != "sick":
            return JsonResponse({"error": "רק מטופלים יכולים להצטרף לנסיעה"}, status=403)

        offer = get_object_or_404(RideOffer, id=offer_id, status="open")

        pickup = offer.parsed_from or "לא צוין מוצא"
        destination = offer.parsed_to or "לא צוין יעד"

        # תאריך/שעה מתוך ההצעה (כדי להתאים לבקשה קיימת ולא ליצור כפילויות)
        offer_when = _parse_offer_datetime(offer) or (timezone.now() + timedelta(hours=1))

        pickup_lat = offer.from_lat
        pickup_lng = offer.from_lng
        dest_lat = offer.to_lat
        dest_lng = offer.to_lng

        # fallback geocode
        if (pickup_lat is None or pickup_lng is None) and pickup and pickup != "לא צוין מוצא":
            coords = geocode_address(pickup)
            if coords:
                pickup_lat, pickup_lng = coords
        if (dest_lat is None or dest_lng is None) and destination and destination != "לא צוין יעד":
            coords = geocode_address(destination)
            if coords:
                dest_lat, dest_lng = coords

        if pickup_lat is None or pickup_lng is None:
            return JsonResponse({"error": "חסרות קואורדינטות למוצא. יש לפרסם שוב ולבחור כתובת מתוך ההצעות."}, status=400)
        if dest_lat is None or dest_lng is None:
            return JsonResponse({"error": "חסרות קואורדינטות ליעד. יש לפרסם שוב ולבחור כתובת מתוך ההצעות."}, status=400)

        # אם למטופל כבר יש TransportRequest פתוחה תואמת, נעדכן אותה במקום ליצור בקשה כפולה
        existing_request = None
        best_score = 0.0
        try:
            open_reqs = (
                TransportRequest.objects.filter(sick=request.user, status="open")
                .order_by("-created_at")[:10]
            )
            for r in open_reqs:
                # אם כבר יש שיוך, אין טעם לעדכן
                if TransportAssignment.objects.filter(request=r).exists():
                    continue
                sc = _score_request_against_offer(r, offer, offer_when)
                if sc > best_score:
                    best_score = sc
                    existing_request = r
        except Exception:
            existing_request = None
            best_score = 0.0

        ride_request = None
        updated_existing = False
        if existing_request is not None and best_score >= 0.65:
            updated_existing = True
            ride_request = existing_request
            ride_request.pickup_address = pickup
            ride_request.pickup_lat = pickup_lat
            ride_request.pickup_lng = pickup_lng
            ride_request.destination = destination
            ride_request.dest_lat = dest_lat
            ride_request.dest_lng = dest_lng
            ride_request.requested_time = offer_when
            ride_request.notes = f"עודכן מהצטרפות לנסיעת מתנדב: {offer.raw_text[:200]}"
            ride_request.status = "accepted"
            ride_request.save(
                update_fields=[
                    "pickup_address",
                    "pickup_lat",
                    "pickup_lng",
                    "destination",
                    "dest_lat",
                    "dest_lng",
                    "requested_time",
                    "notes",
                    "status",
                ]
            )
        else:
            ride_request = TransportRequest.objects.create(
                sick=request.user,
                pickup_address=pickup,
                pickup_lat=pickup_lat,
                pickup_lng=pickup_lng,
                destination=destination,
                dest_lat=dest_lat,
                dest_lng=dest_lng,
                requested_time=offer_when,
                notes=f"נוצר מהצטרפות לנסיעת מתנדב: {offer.raw_text[:200]}",
                status="accepted",
            )

        # שיוך מתנדב (שיוך קיים יעודכן)
        TransportAssignment.objects.update_or_create(
            request=ride_request,
            defaults={"volunteer": offer.volunteer, "accepted_time": timezone.now()},
        )

        offer.status = "matched"
        offer.save(update_fields=["status"])

        broadcast_request_event("request_created", ride_request)
        broadcast_request_event("request_accepted", ride_request)

        return JsonResponse(
            {
                "success": True,
                "request_id": ride_request.id,
                "message": "הבקשה עודכנה והצטרפת לנסיעה. המתנדב רואה עכשיו את הנסיעה כמאושרת." if updated_existing else "הצטרפת לנסיעה. המתנדב רואה עכשיו את הנסיעה כמאושרת.",
            }
        )
    except Http404 as e:
        # RideOffer אינו קיים במצב open (או לא קיים בכלל) ולכן זו לא שגיאת שרת.
        payload = {"error": "ההצעה לא פתוחה או לא קיימת"}
        if getattr(settings, "DEBUG", False):
            payload["detail"] = str(e)
        return JsonResponse(payload, status=404)
    except Exception as e:
        logger.exception("ai_join_offer_api error (offer_id=%s): %s", offer_id, e)
        payload = {"error": "Server error"}
        if getattr(settings, "DEBUG", False):
            payload["detail"] = str(e)
            payload["traceback"] = traceback.format_exc()
        return JsonResponse(payload, status=500)


@csrf_exempt
@login_required_json
def ai_request_api(request):
    """מטופל שולח בקשת טקסט חופשי → מחזיר התאמות מהצעות קיימות (לוגיקה פשוטה) + אפשרות ליצור בקשה מסודרת."""
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if getattr(request.user.profile, "role", None) != "sick":
            return JsonResponse({"error": "רק מטופלים יכולים לשלוח בקשת נסיעה במצב AI"}, status=403)
        data = json.loads(request.body or "{}")
        raw_text = (data.get("raw_text") or "").strip()
        if not raw_text:
            return JsonResponse({"error": "יש להזין מה אתה צריך"}, status=400)
        ok, missing = validate_ai_ride_text(raw_text)
        if not ok:
            return JsonResponse({
                "error": "נא לכלול בטקסט: " + ", ".join(missing) + ". לדוגמה: צריך נסיעה ביום ראשון מתל אביב לירושלים.",
            }, status=400)
        # ניסיון ליצור בקשה אמיתית (TransportRequest) מהטקסט – פירוק "מ X ל Y" + זמן (בלי מודל AI)
        created_request_id = None
        parsed = parse_ai_ride_to_request(raw_text)
        if parsed:
            try:
                pickup = parsed["pickup_address"]
                dest = parsed["destination"]
                req_time = parsed["requested_time"]
                pickup_lat, pickup_lng = None, None
                dest_lat, dest_lng = None, None
                coords_pickup = geocode_address(pickup)
                if coords_pickup:
                    pickup_lat, pickup_lng = coords_pickup
                coords_dest = geocode_address(dest)
                if coords_dest:
                    dest_lat, dest_lng = coords_dest
                r = TransportRequest.objects.create(
                    sick=request.user,
                    pickup_address=pickup,
                    pickup_lat=pickup_lat,
                    pickup_lng=pickup_lng,
                    destination=dest,
                    dest_lat=dest_lat,
                    dest_lng=dest_lng,
                    requested_time=req_time,
                    notes="נוצר ממצב AI: " + raw_text[:200],
                )
                created_request_id = r.id
                try:
                    notify_new_request.delay(r.id)
                except Exception:
                    logger.warning("Failed to enqueue notify_new_request", exc_info=True)
                broadcast_request_event("request_created", r)
            except Exception as e:
                logger.warning("AI create request failed: %s", e, exc_info=True)
        # התאמת AI: דירוג הצעות לפי התאמה לבקשה (OpenAI אם יש AI_API_KEY, אחרת מילות מפתח)
        offers_qs = RideOffer.objects.filter(status="open").select_related("volunteer").order_by("-created_at")[:20]
        offers_list = [
            {
                "id": o.id,
                "raw_text": o.raw_text,
                "volunteer_username": o.volunteer.username,
                "created_at": o.created_at.isoformat(),
            }
            for o in offers_qs
        ]
        request_summary = {}
        if parsed:
            request_summary = {
                "pickup": parsed.get("pickup_address", ""),
                "destination": parsed.get("destination", ""),
                "time_text": raw_text,
            }
        else:
            request_summary = {"pickup": "", "destination": "", "time_text": raw_text}
        try:
            from .ai_matching import ai_match_offers_to_request
            matches = ai_match_offers_to_request(request_summary, offers_list)
        except Exception as e:
            logger.warning("AI matching failed, using raw list: %s", e)
            matches = [{**o, "score": 0, "reason": ""} for o in offers_list]
        message = "להצעות למעלה תוכל להגיב או ליצור בקשה מסודרת מדף הבית."
        if created_request_id:
            message = "נוצרה בקשה בהתאם לטקסט (דף הבית). מומלץ לעדכן כתובות מדויקות אם צריך."
        return JsonResponse({
            "success": True,
            "matches": matches,
            "created_request_id": created_request_id,
            "message": message,
        })
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
def ai_grok_chat_api(request):
    """
    Chat with Groq (OpenAI-compatible). Patient describes need in free text.
    Grok should ask for missing details (date/time, pickup, destination, seats, constraints),
    and when enough info exists, it returns best matching volunteer offers (ids).
    """
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        # Auth:
        # - Normal flow: authenticated patient user
        # - Debug automation: allow token-based access in DEBUG (useful for PowerShell / automation)
        debug_token = request.headers.get("X-Debug-Token") or request.GET.get("token") or ""
        token_ok = bool(
            getattr(settings, "DEBUG", False)
            and getattr(settings, "DEBUG_AUTOMATION_TOKEN", "")
            and debug_token
            and debug_token == getattr(settings, "DEBUG_AUTOMATION_TOKEN", "")
        )

        if not request.user.is_authenticated and not token_ok:
            return JsonResponse({"error": "Authentication required"}, status=401)

        if request.user.is_authenticated:
            if getattr(request.user.profile, "role", None) != "sick":
                return JsonResponse({"error": "רק מטופלים יכולים להשתמש בסוכן AI"}, status=403)

        api_key = getattr(settings, "GROQ_API_KEY", "") or ""
        if not api_key:
            return JsonResponse({"error": "חסר GROQ_API_KEY בשרת."}, status=500)

        data = json.loads(request.body or "{}")
        messages = data.get("messages") or []
        if not isinstance(messages, list) or not messages:
            return JsonResponse({"error": "Missing messages"}, status=400)

        # Keep only last ~12 messages for cost/safety
        messages = messages[-12:]

        offers = (
            RideOffer.objects.filter(status="open")
            .select_related("volunteer")
            .order_by("-created_at")[:20]
        )
        offers_payload = [
            {
                "id": o.id,
                "raw_text": o.raw_text,
                "from": o.parsed_from or "",
                "to": o.parsed_to or "",
                "volunteer_username": o.volunteer.username,
                "created_at": o.created_at.isoformat(),
            }
            for o in offers
        ]

        system_prompt = (
            "אתה סוכן עוזר למטופל למצוא נסיעת מתנדב קיימת.\n"
            "התנהגות חובה:\n"
            "- אם חסר מידע חשוב (מוצא, יעד, תאריך/שעה, מספר נוסעים/כיסא גלגלים/דחיפות) שאל שאלות קצרות.\n"
            "- אל תמציא פרטים.\n"
            "- כשהמידע מספיק, תבחר התאמות מתוך רשימת ההצעות שסיפקתי.\n"
            "פורמט תשובה חובה: החזר JSON בלבד, בלי טקסט מסביב, בצורה:\n"
            "{"
            "\"mode\":\"ask\"|\"match\","
            "\"reply\":\"טקסט בעברית\","
            "\"match_ids\":[1,2,3]"
            "}\n"
            "- ב mode=ask: match_ids חייב להיות [].\n"
            "- ב mode=match: match_ids הם מזהים מתוך ההצעות בלבד.\n"
        )

        xai_messages = [{"role": "system", "content": system_prompt}]

        # Add context as a system message to keep Grok grounded
        xai_messages.append(
            {
                "role": "system",
                "content": "הצעות מתנדבים זמינות (JSON): " + json.dumps(offers_payload, ensure_ascii=False),
            }
        )

        # Forward user chat history
        for m in messages:
            if not isinstance(m, dict):
                continue
            role = m.get("role")
            content = m.get("content")
            if role not in {"user", "assistant"}:
                continue
            if not isinstance(content, str):
                continue
            xai_messages.append({"role": role, "content": content[:2000]})

        try:
            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": xai_messages,
                    "temperature": 0.2,
                    "stream": False,
                    "max_tokens": 600,
                },
                timeout=40,
            )
            resp.raise_for_status()
            out = resp.json()
            content = (
                (((out.get("choices") or [{}])[0]).get("message") or {}).get("content") or ""
            )
        except Exception as e:
            logger.exception("Groq chat failed: %s", e)
            return JsonResponse({"error": "שגיאה בקריאה ל־GROQ."}, status=500)

        # Parse JSON-only response
        try:
            parsed = json.loads(content)
        except Exception:
            # If model returned non-JSON, still pass it as reply
            return JsonResponse({"mode": "ask", "reply": content.strip() or "מה מוצא/יעד/תאריך/שעה?", "match_ids": []})

        mode = parsed.get("mode") if isinstance(parsed, dict) else "ask"
        reply = (parsed.get("reply") if isinstance(parsed, dict) else "") or ""
        match_ids = parsed.get("match_ids") if isinstance(parsed, dict) else []
        if mode not in {"ask", "match"}:
            mode = "ask"
        if not isinstance(match_ids, list):
            match_ids = []
        match_ids = [int(x) for x in match_ids if isinstance(x, (int, float, str)) and str(x).isdigit()]

        # Return matches details so frontend can render cards + join buttons
        matches = []
        if mode == "match" and match_ids:
            offers_map = {o.id: o for o in offers}
            for oid in match_ids:
                o = offers_map.get(oid)
                if not o:
                    continue
                matches.append(
                    {
                        "id": o.id,
                        "raw_text": o.raw_text,
                        "volunteer_username": o.volunteer.username,
                        "created_at": o.created_at.isoformat(),
                    }
                )
        return JsonResponse({"mode": mode, "reply": reply, "matches": matches})
    except Exception as e:
        logger.exception("ai_grok_chat_api error: %s", e)
        return JsonResponse({"error": "Server error"}, status=500)


@csrf_exempt
def ai_grok_volunteer_chat_api(request):
    """
    Chat with Groq for volunteers.
    Volunteer describes when/where he is driving and how many seats, Groq suggests matching patient requests.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        # Auth: volunteer user or debug token
        debug_token = request.headers.get("X-Debug-Token") or request.GET.get("token") or ""
        token_ok = bool(
            getattr(settings, "DEBUG", False)
            and getattr(settings, "DEBUG_AUTOMATION_TOKEN", "")
            and debug_token
            and debug_token == getattr(settings, "DEBUG_AUTOMATION_TOKEN", "")
        )

        if not request.user.is_authenticated and not token_ok:
            return JsonResponse({"error": "Authentication required"}, status=401)

        if request.user.is_authenticated:
            if getattr(request.user.profile, "role", None) != "volunteer":
                return JsonResponse({"error": "רק מתנדבים יכולים להשתמש בסוכן AI למתנדב"}, status=403)

        api_key = getattr(settings, "GROQ_API_KEY", "") or ""
        if not api_key:
            return JsonResponse({"error": "חסר GROQ_API_KEY בשרת."}, status=500)

        data = json.loads(request.body or "{}")
        messages = data.get("messages") or []
        if not isinstance(messages, list) or not messages:
            return JsonResponse({"error": "Missing messages"}, status=400)

        messages = messages[-12:]

        # Candidate patient requests: open, not cancelled, upcoming
        now = timezone.now()
        reqs = (
            TransportRequest.objects.filter(status="open", requested_time__gte=now)
            .select_related("sick", "sick__profile")
            .order_by("requested_time")[:30]
        )
        reqs_payload = [
            {
                "id": r.id,
                "pickup": r.pickup_address,
                "destination": r.destination,
                "requested_time": timezone.localtime(r.requested_time).strftime("%Y-%m-%d %H:%M"),
                "phone": getattr(r.sick.profile, "phone", ""),
            }
            for r in reqs
        ]

        system_prompt = (
            "אתה סוכן AI שעוזר למתנדב לבחור מטופלים להסעה.\n"
            "יש לך רשימת בקשות פתוחות של מטופלים (pickup, destination, requested_time, phone).\n"
            "התנהגות חובה:\n"
            "- אם חסר מידע חשוב מהמתנדב (מוצא, יעד, תאריך/שעה, כמה מקומות, מגבלות) שאל שאלות קצרות וברורות.\n"
            "- אל תמציא פרטים.\n"
            "- כשהמידע מספיק, בחר עד כמה בקשות שמתאימות למסלול של המתנדב.\n"
            "פורמט תשובה חובה: JSON בלבד, בלי טקסט מסביב, בצורה:\n"
            "{"
            "\"mode\":\"ask\"|\"match\","
            "\"reply\":\"טקסט בעברית למתנדב\","
            "\"match_ids\":[1,2,3]"
            "}\n"
            "- ב mode=ask: match_ids חייב להיות [].\n"
            "- ב mode=match: match_ids הם מזהים מתוך רשימת הבקשות בלבד.\n"
        )

        xai_messages = [{"role": "system", "content": system_prompt}]
        xai_messages.append(
            {
                "role": "system",
                "content": "בקשות מטופלים פתוחות (JSON): " + json.dumps(reqs_payload, ensure_ascii=False),
            }
        )

        for m in messages:
            if not isinstance(m, dict):
                continue
            role = m.get("role")
            content = m.get("content")
            if role not in {"user", "assistant"}:
                continue
            if not isinstance(content, str):
                continue
            xai_messages.append({"role": role, "content": content[:2000]})

        try:
            resp = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": xai_messages,
                    "temperature": 0.2,
                    "stream": False,
                    "max_tokens": 600,
                },
                timeout=40,
            )
            resp.raise_for_status()
            out = resp.json()
            content = (
                (((out.get("choices") or [{}])[0]).get("message") or {}).get("content") or ""
            )
        except Exception as e:
            logger.exception("Groq volunteer chat failed: %s", e)
            return JsonResponse({"error": "שגיאה בקריאה ל־GROQ."}, status=500)

        try:
            parsed = json.loads(content)
        except Exception:
            return JsonResponse({"mode": "ask", "reply": content.strip() or "מתי אתה יוצא, מאיפה ולאן וכמה מקומות יש?", "match_ids": []})

        mode = parsed.get("mode") if isinstance(parsed, dict) else "ask"
        reply = (parsed.get("reply") if isinstance(parsed, dict) else "") or ""
        match_ids = parsed.get("match_ids") if isinstance(parsed, dict) else []
        if mode not in {"ask", "match"}:
            mode = "ask"
        if not isinstance(match_ids, list):
            match_ids = []
        match_ids = [int(x) for x in match_ids if isinstance(x, (int, float, str)) and str(x).isdigit()]

        matches = []
        if mode == "match" and match_ids:
            req_map = {r.id: r for r in reqs}
            for rid in match_ids:
                r = req_map.get(rid)
                if not r:
                    continue
                matches.append(serialize_request(r))

        return JsonResponse({"mode": mode, "reply": reply, "matches": matches})
    except Exception as e:
        logger.exception("ai_grok_volunteer_chat_api error: %s", e)
        return JsonResponse({"error": "Server error"}, status=500)
