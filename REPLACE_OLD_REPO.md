# החלפת ה-repo הישן (GitHub) בגרסה החדשה

- **הישן (GitHub):** [imanuel1984/stransport](https://github.com/imanuel1984/stransport) — מבנה עם `service/` כפרויקט Django.
- **החדש (מקומי):** הפרויקט הזה — מבנה עם `stransport_pro/` כפרויקט Django, אפליקציות `stransport` + `trivia`.

## איך להחליף את ה-GitHub בגרסה החדשה

1. **חיבור ל־remote (אם עדיין לא):**
   ```bash
   git remote add origin https://github.com/imanuel1984/stransport.git
   ```
   אם כבר יש `origin` ל-repo אחר, תחליף:
   ```bash
   git remote set-url origin https://github.com/imanuel1984/stransport.git
   ```

2. **Stage ו־commit לכל השינויים:**
   ```bash
   git add -A
   git status
   git commit -m "chore: replace with stransport_pro architecture; safety and cleanup"
   ```

3. **דחיפה שמחליפה את ה-main הישן:**
   - אם ה-branch הראשי ב-GitHub הוא `main`:
     ```bash
     git push -u origin main --force
     ```
   - אם השם הוא `master`:
     ```bash
     git branch -M main
     git push -u origin main --force
     ```
   **אזהרה:** `--force` מוחק את ההיסטוריה/קבצים הישנים ב־main. וודא שיש לך גיבוי אם צריך.

4. **אחרי הדחיפה:** ב-Render עדכן את ה-repo (אם צריך) והגדר מחדש את משתני הסביבה לפי `VALIDATION_REPORT.md` / `.env.example`.

---

*אין דחיפה אוטומטית — הרץ את הפקודות ידנית.*
