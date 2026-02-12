import json
import os
from pathlib import Path
import hashlib
import time
from django.core.cache import cache

import requests
from functools import wraps
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.1-8b-instant"


def login_required_json(view_func):
    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Authentication required"}, status=401)
        return view_func(request, *args, **kwargs)
    return _wrapped


# =========================
# Files
# =========================
def _extract_json_array(text: str):
    """
    מחלץ מערך JSON מהטקסט גם אם המודל עטף אותו בטקסט נוסף.
    """
    import json, re

    # מקרה אידאלי: המודל החזיר רק JSON
    text = text.strip()
    if text.startswith("[") and text.endswith("]"):
        return json.loads(text)

    # חיפוש מערך JSON בתוך טקסט
    match = re.search(r"\[\s*\{.*?\}\s*\]", text, re.DOTALL)
    if match:
        return json.loads(match.group(0))

    raise ValueError("לא נמצא מערך JSON תקין בתשובת ה-AI")

def _app_root() -> Path:
    return Path(__file__).resolve().parent


def _questions_path() -> Path:
    """
    אפשרות 1 (מומלץ): trivia/questions.json
    אפשרות 2: trivia/static/trivia/questions.json
    הקוד ינסה קודם את #1 ואם לא קיים יעבור ל-#2
    """
    p1 = _app_root() / "questions.json"
    if p1.exists():
        return p1

    p2 = _app_root() / "static" / "trivia" / "questions.json"
    return p2


# =========================
# Groq core
# =========================
def _groq_request(messages, temperature=0.25, max_tokens=1200):
    print("GROQ_API_KEY seen by Django:", bool(os.environ.get("GROQ_API_KEY")))

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("חסר GROQ_API_KEY במשתני הסביבה")

    payload = {
        "model": GROQ_MODEL,  # למשל "llama-3.1-8b-instant"
        "temperature": temperature,
        "messages": messages,
        "max_tokens": max_tokens,
    }

    r = requests.post(
        GROQ_BASE_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Groq error {r.status_code}: {r.text}")

    data = r.json()
    return (data.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()



# =========================
# API: Questions
# =========================
@require_GET
@login_required_json
def questions(request):
    """
    מחזיר:
    { "topics": { "Python":[...], "JavaScript":[...], ... } }
    """
    try:
        p = _questions_path()
        if not p.exists():
            return JsonResponse(
                {"error": "Questions file not found", "details": str(p)},
                status=500,
            )

        raw = json.loads(p.read_text(encoding="utf-8"))

        # תמיכה אם הקובץ שלך כבר עוטף בתוך "topics"
        if isinstance(raw, dict) and "topics" in raw and isinstance(raw["topics"], dict):
            raw = raw["topics"]

        if not isinstance(raw, dict):
            return JsonResponse({"error": "Bad questions.json structure"}, status=500)

        return JsonResponse({"topics": raw}, json_dumps_params={"ensure_ascii": False})

    except Exception as e:
        return JsonResponse({"error": "Failed to load questions", "details": str(e)}, status=500)


# =========================
# Rate Limiting Helper
# =========================
def _get_rate_limit_key(user_id, question_text, feature):
    """יוצר מפתח ייחודי לשאלה ומשתמש עבור cache"""
    q_hash = hashlib.md5(question_text.encode('utf-8')).hexdigest()[:12]
    return f"rate_limit:{user_id}:{q_hash}:{feature}"

def _check_rate_limit(user_id, question_text, feature, max_uses):
    """
    בודק והגביל שימוש בפיצ'ר לפי שאלה.
    מחזיר (allowed: bool, current_count: int, max_uses: int)
    """
    key = _get_rate_limit_key(user_id, question_text, feature)
    current = cache.get(key, 0)
    
    if current >= max_uses:
        return False, current, max_uses
    
    # הגדל מונה ושמור ל-1 שעה (או עד שמתחילים שאלה חדשה)
    cache.set(key, current + 1, timeout=3600)
    return True, current + 1, max_uses


# =========================
# API: Chat (no spoilers)
# =========================
@require_POST
@login_required_json
def ai_chat(request):
    """
    גוף:
    {
      "question": {question, choices, correctIndex},
      "userMessage": "....",
      "history": [ {role, content}, ... ]  (אופציונלי),
      "isHint": true/false  (אופציונלי - לזיהוי בקשת רמז)
    }
    מחזיר:
    { "text": "...", "history": [...], "usageCount": X, "maxUsage": Y }
    
    הגבלה: מקסימום 1 רמז + 2 הודעות צ'אט לכל שאלה.
    """
    try:
        payload = json.loads(request.body.decode("utf-8"))
        q = payload.get("question") or {}
        user_message = (payload.get("userMessage") or "").strip()
        history = payload.get("history") or []
        is_hint = payload.get("isHint", False)

        if not q.get("question") or not q.get("choices"):
            return JsonResponse({"text": "לא התקבלה שאלה תקינה.", "history": history})

        if not user_message:
            return JsonResponse({"text": "כתוב הודעה לצ'אט.", "history": history})

        # בדוק הגבלת שימוש - רמזים ו-צ'אט נפרדים
        if is_hint:
            feature = 'hint'
            max_uses = 1
            limit_msg = "כבר קיבלת רמז לשאלה זו. נסה לפתור בעצמך! 💪"
        else:
            feature = 'chat'
            max_uses = 2
            limit_msg = f"הגעת למקסימום {max_uses} הודעות צ'אט לשאלה זו. נסה לפתור בעצמך! 💪"
        
        allowed, count, max_allowed = _check_rate_limit(
            request.user.id, 
            q['question'], 
            feature, 
            max_uses=max_uses
        )
        
        if not allowed:
            return JsonResponse({
                "text": limit_msg,
                "history": history,
                "usageCount": count,
                "maxUsage": max_allowed,
                "limitReached": True
            })

        system = (
            "אתה עוזר למידה במשחק טריוויה.\n"
            "חוקים:\n"
            "- אסור לגלות תשובה נכונה או לרמוז במפורש 'התשובה היא X'.\n"
            "- אם מבקשים תשובה ישירה: מסרב בנימוס ונותן רמז + שאלת הכוונה.\n"
            "- תשובות קצרות, ענייניות, בעברית.\n"
        )

        messages = [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": f"שאלה: {q['question']}\nאפשרויות: {', '.join(q['choices'])}",
            },
            *history,
            {"role": "user", "content": user_message},
        ]

        text = _groq_request(messages, temperature=0.35, max_tokens=700)
        new_history = [*history, {"role": "user", "content": user_message}, {"role": "assistant", "content": text}]
        return JsonResponse({
            "text": text, 
            "history": new_history,
            "usageCount": count,
            "maxUsage": max_allowed
        }, json_dumps_params={"ensure_ascii": False})

    except Exception as e:
        return JsonResponse({"text": "שגיאה בצ’אט.", "details": str(e), "history": []}, status=500)


# =========================
# API: Explain (after answer)
# =========================
@require_POST
@login_required_json
def ai_explain(request):
    """
    גוף:
    { "question": {...}, "userAnswerIndex": 2 }
    מחזיר:
    { "text": "...", "usageCount": X, "maxUsage": Y }
    
    הגבלה: מקסימום 1 הסבר לכל שאלה.
    """
    try:
        payload = json.loads(request.body.decode("utf-8"))
        q = payload.get("question") or {}
        user_idx = payload.get("userAnswerIndex")

        if not q.get("question") or not q.get("choices"):
            return JsonResponse({"text": "לא התקבלה שאלה תקינה."})

        if user_idx is None:
            return JsonResponse({"text": "ענה קודם ואז אוכל להסביר."})

        # בדוק הגבלת שימוש - מקסימום 1 הסבר לשאלה
        allowed, count, max_uses = _check_rate_limit(
            request.user.id, 
            q['question'], 
            'explain', 
            max_uses=1
        )
        
        if not allowed:
            return JsonResponse({
                "text": f"כבר השתמשת בהסבר לשאלה זו. המשך לשאלה הבאה!",
                "usageCount": count,
                "maxUsage": max_uses,
                "limitReached": True
            })

        system = (
            "אתה מסביר טריוויה.\n"
            "מותר להסביר תשובה נכונה ולמה.\n"
            "תשובה קצרה וברורה בעברית.\n"
        )

        messages = [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "question": q.get("question"),
                        "choices": q.get("choices"),
                        "correctIndex": q.get("correctIndex"),
                        "userAnswerIndex": user_idx,
                    },
                    ensure_ascii=False,
                ),
            },
        ]

        text = _groq_request(messages, temperature=0.2, max_tokens=750)
        return JsonResponse({
            "text": text,
            "usageCount": count,
            "maxUsage": max_uses
        }, json_dumps_params={"ensure_ascii": False})

    except Exception as e:
        return JsonResponse({"text": "שגיאה בהסבר.", "details": str(e)}, status=500)


# =========================
# API: Translate (JSON Schema - stable)
# =========================
@require_POST
@login_required_json
def translate_questions(request):
    """
    גוף:
    { "lang":"he", "questions":[{question,choices,correctIndex}, ...] }

    מחזיר:
    { "questions":[...] }
    """
    try:
        payload = json.loads(request.body.decode("utf-8"))
        lang = payload.get("lang", "he")
        questions = payload.get("questions") or []

        if lang != "he":
            return JsonResponse({"error": "Unsupported language"}, status=400)

        if not isinstance(questions, list) or len(questions) == 0:
            return JsonResponse({"error": "No questions provided"}, status=400)

        questions = questions[:10]

        system = (
            "אתה מתרגם מקצועי מאנגלית לעברית.\n"
            "תקבל JSON עם questions.\n"
            "החזר *רק* מערך JSON (בלי שום טקסט נוסף) בפורמט הבא:\n"
            "[\n"
            "  {\"question\":\"...\",\"choices\":[\"...\"],\"correctIndex\":0},\n"
            "  ...\n"
            "]\n"
            "כללים:\n"
            "- אל תשנה correctIndex.\n"
            "- השאר מונחי קוד/מילות מפתח באנגלית (SQL, JSON, API, def, let וכו').\n"
            "- תרגם שאלה + choices לעברית טבעית.\n"
        )

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps({"questions": questions}, ensure_ascii=False)},
        ]

        text = _groq_request(messages, temperature=0.2, max_tokens=1800)
        translated = _extract_json_array(text)

        # ולידציה בסיסית
        if not isinstance(translated, list) or len(translated) == 0:
            raise ValueError("המודל לא החזיר מערך תקין")

        for q in translated:
            if not all(k in q for k in ("question", "choices", "correctIndex")):
                raise ValueError("מבנה תרגום לא תקין")
            if not isinstance(q["choices"], list):
                raise ValueError("choices לא תקין")

        return JsonResponse({"questions": translated}, json_dumps_params={"ensure_ascii": False})

    except Exception as e:
        return JsonResponse({"error": "Translation failed", "details": str(e)}, status=500)
