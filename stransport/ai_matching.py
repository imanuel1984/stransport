"""
התאמת הצעות נסיעה (RideOffer) לבקשה באמצעות AI (OpenAI API).
מקבל סיכום בקשה + רשימת הצעות, מחזיר הצעות ממוינות לפי ציון התאמה + הסבר קצר.

שלב הבא: חיבור התאמת AI ל־UI – הצגת התאמות למטופל במפה/במודל (נסיעות מתנדבים ממוינות לפי התאמה לבקשה).
"""
import json
import logging
import os
import re

import requests

logger = logging.getLogger(__name__)


def _get_api_key():
    try:
        from django.conf import settings
        return (os.environ.get("AI_API_KEY") or "").strip() or getattr(settings, "AI_API_KEY", "")
    except Exception:
        return (os.environ.get("AI_API_KEY") or "").strip()


def _fallback_score(request_summary: dict, offer_text: str) -> float:
    """התאמה פשוטה בלי API: חפיפה מילות מפתח (מוצא, יעד)."""
    pickup = (request_summary.get("pickup") or "").lower().replace("-", " ")
    dest = (request_summary.get("destination") or "").lower().replace("-", " ")
    t = (offer_text or "").lower()
    score = 0.0
    if pickup and pickup in t:
        score += 0.5
    if dest and dest in t:
        score += 0.5
    # אם יש גם מוצא וגם יעד בטקסט (מ... ל...)
    if re.search(r"מ\s*\S+.*ל\s*\S+", t):
        score += 0.2
    return min(1.0, score)


def ai_match_offers_to_request(request_summary: dict, offers: list) -> list:
    """
    מחזיר רשימת הצעות ממוינת לפי התאמה לבקשה.
    request_summary: { "pickup", "destination", "time_text" }
    offers: [ {"id", "raw_text", "volunteer_username"}, ... ]
    מחזיר: [ {"id", "raw_text", "volunteer_username", "created_at", "score", "reason"}, ... ]
    """
    if not offers:
        return []
    api_key = _get_api_key()
    request_summary = request_summary or {}
    pickup = (request_summary.get("pickup") or "").strip()
    destination = (request_summary.get("destination") or "").strip()
    time_text = (request_summary.get("time_text") or "").strip()

    if api_key:
        try:
            prompt = f"""בקשה לנסיעה:
מוצא: {pickup}
יעד: {destination}
זמן: {time_text}

הצעות מתנדבים (כל שורה: מזהה, טקסט):
"""
            for o in offers:
                prompt += f"- id={o.get('id')}: {o.get('raw_text', '')}\n"
            prompt += """
החזר JSON בלבד, מערך של אובייקטים עם השדות: id (מספר), score (0-1), reason (משפט קצר בעברית).
מיין מההתאמה הגבוהה לנמוכה. רק הצעות רלוונטיות (score >= 0.3).
דוגמה: [{"id":1,"score":0.9,"reason":"מוצא ויעד תואמים וזמן קרוב."}]
"""
            resp = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": "You respond only with valid JSON array. No markdown."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.2,
                    "max_tokens": 800,
                },
                timeout=15,
            )
            if resp.status_code == 200:
                data = resp.json()
                choices = data.get("choices") or []
                if choices:
                    text = (choices[0].get("message") or {}).get("content") or ""
                    text = text.strip()
                    if text.startswith("```"):
                        text = re.sub(r"^```\w*\n?", "", text).rstrip("`\n")
                    try:
                        arr = json.loads(text)
                        id_to_score = {int(x.get("id", 0)): (float(x.get("score", 0)), (x.get("reason") or "")) for x in arr if isinstance(x, dict)}
                        result = []
                        for o in offers:
                            oid = o.get("id")
                            score, reason = id_to_score.get(oid, (0.0, ""))
                            result.append({
                                **o,
                                "score": round(score, 2),
                                "reason": reason or "התאמה לפי AI",
                            })
                        result.sort(key=lambda x: x.get("score", 0), reverse=True)
                        return result
                    except (json.JSONDecodeError, ValueError) as e:
                        logger.warning("AI response parse failed: %s", e)
        except Exception as e:
            logger.warning("AI matching request failed: %s", e, exc_info=True)

    # Fallback: no API or error – score by keyword overlap
    result = []
    for o in offers:
        score = _fallback_score(request_summary, o.get("raw_text") or "")
        result.append({
            **o,
            "score": round(score, 2),
            "reason": "התאמה לפי מילות מפתח (ללא מודל AI)." if score > 0 else "",
        })
    result.sort(key=lambda x: x.get("score", 0), reverse=True)
    return result
