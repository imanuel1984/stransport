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
from django.contrib.auth import login
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
    normalize_israeli_phone,
)
from .tasks import notify_new_request, generate_ai_summary
import json
import urllib.parse

logger = logging.getLogger(__name__)


def login_required_json(view_func):
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Authentication required"}, status=401)
        return view_func(request, *args, **kwargs)
    return _wrapped


# --- SIGNUP ---
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


# --- HOME ---
@login_required
def home(request):
    return render(request, "stransport/home.html", {"current_user": request.user})


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
        "requested_time": r.requested_time.strftime("%Y-%m-%d %H:%M"),
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
        role = getattr(request.user.profile, "role", "")
        if role == "volunteer":
            qs = TransportRequest.objects.filter(status="open", no_volunteers_available=False).exclude(
                rejections__volunteer=request.user
            )
        elif role == "sick":
            qs = TransportRequest.objects.filter(sick=request.user, status="open")
        else:
            qs = TransportRequest.objects.none()
        data = [serialize_request(r) for r in qs.order_by("-created_at")]
        return JsonResponse({"requests": data})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: CREATE REQUEST ---
@login_required_json
def create_request_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "sick":
            return JsonResponse({"error": "Only sick users can create requests"}, status=403)

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
@login_required_json
def accept_request_api(request, req_id):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "volunteer":
            return JsonResponse({"error": "Only volunteers can accept"}, status=403)
        ride_request = get_object_or_404(TransportRequest, id=req_id, status="open")
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
        ride_request = get_object_or_404(TransportRequest, id=req_id, sick=request.user, status="open")
        ride_request.status = "cancelled"
        ride_request.cancel_reason = "patient_cancelled"
        ride_request.save()
        broadcast_request_event("request_cancelled", ride_request)
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: ACCEPTED REQUESTS (VOLUNTEER) ---
@login_required_json
def accepted_requests_api(request):
    try:
        if request.user.profile.role != "volunteer":
            return JsonResponse({"requests": []})
        reqs = TransportRequest.objects.filter(
            transportassignment__volunteer=request.user,
            status="accepted"
        ).distinct().order_by("-created_at")
        return JsonResponse({"requests": [serialize_request(r) for r in reqs]})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: CLOSED REQUESTS (SICK) ---
@login_required_json
def closed_requests_api(request):
    try:
        if request.user.profile.role != "sick":
            return JsonResponse({"requests": []})

        qs = TransportRequest.objects.filter(
            sick=request.user
        ).filter(
            models.Q(status__in=["cancelled", "done"]) |
            models.Q(status="accepted", transportassignment__isnull=False)
        ).order_by("-created_at")

        return JsonResponse({"requests": [serialize_request(r) for r in qs]})
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


# --- API: ROUTE SUGGESTION ---
@login_required_json
def suggest_route_api(request):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "volunteer":
            return JsonResponse({"error": "Only volunteers can suggest routes"}, status=403)

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

        qs = TransportRequest.objects.filter(
            id__in=request_ids,
            status="open",
            no_volunteers_available=False,
        )
        requests_map = {r.id: r for r in qs}
        if len(requests_map) != len(request_ids):
            return JsonResponse({"error": "Some requests are not available"}, status=400)

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
