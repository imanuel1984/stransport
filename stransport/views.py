from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.contrib.auth import login
from django.contrib.auth.forms import UserCreationForm
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.db import models
from django.utils.dateparse import parse_datetime
from django.contrib.auth.models import User
from .models import TransportRequest, TransportAssignment, Profile, TransportRejection
import json


# --- SIGNUP ---
def signup(request):
    if request.method == "POST":
        try:
            if request.content_type == "application/json":
                data = json.loads(request.body or "{}")
            else:
                data = request.POST

            form = UserCreationForm(data)
            role = data.get("role")
            if form.is_valid() and role in ["sick", "volunteer"]:
                user = form.save()
                Profile.objects.update_or_create(user=user, defaults={"role": role})
                login(request, user)

                if request.content_type == "application/json":
                    return JsonResponse({"success": True})
                return redirect("home")

            if request.content_type == "application/json":
                return JsonResponse({"success": False, "errors": form.errors})
        except Exception as e:
            if request.content_type == "application/json":
                return JsonResponse({"success": False, "error": str(e)})

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
        "destination": r.destination,
        "requested_time": r.requested_time.strftime("%Y-%m-%d %H:%M"),
        "status": r.status,
        "status_display": r.get_status_display(),
        "status_label": status_label,
        "notes": r.notes,
        "phone": getattr(r.sick.profile, "phone", ""),
        "volunteer": volunteer_info,
        "no_volunteers_available": r.no_volunteers_available,
    }


# --- API: OPEN REQUESTS ---
@login_required
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
@csrf_exempt
@login_required
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
        requested_time = parse_datetime(time_str)

        if not all([pickup, destination, requested_time]):
            return JsonResponse({"error": "Missing fields"}, status=400)

        profile = request.user.profile
        if phone:
            profile.phone = phone
            profile.save()

        r = TransportRequest.objects.create(
            sick=request.user,
            pickup_address=pickup,
            destination=destination,
            requested_time=requested_time,
            notes=notes,
        )
        return JsonResponse({"success": True, "id": r.id})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: ACCEPT REQUEST ---
@csrf_exempt
@login_required
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
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: REJECT REQUEST ---
@csrf_exempt
@login_required
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
            ride_request.save()

        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: CANCEL REQUEST ---
@csrf_exempt
@login_required
def cancel_request_api(request, req_id):
    if request.method != "POST":
        return JsonResponse({"error": "Invalid request"}, status=400)
    try:
        if request.user.profile.role != "sick":
            return JsonResponse({"error": "Only sick users can cancel"}, status=403)
        ride_request = get_object_or_404(TransportRequest, id=req_id, sick=request.user, status="open")
        ride_request.status = "cancelled"
        ride_request.save()
        return JsonResponse({"success": True})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)


# --- API: ACCEPTED REQUESTS (VOLUNTEER) ---
@login_required
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
@login_required
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
@csrf_exempt
@login_required
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
