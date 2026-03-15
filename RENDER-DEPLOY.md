# פריסה ב-Render (Docker)

## אם מקבלים `Name or service not known` ב-Deploy

ה-Container לא מצליח לפתור את כתובת ה-DB (DNS). ב-Render, לרוב זה קורה כי לשירות Docker מוזרק **Internal** Database URL, וה-host שלו לא נפתר מתוך ה-Container.

### מה לעשות (חובה)

1. ב-**Render Dashboard** → השירות **PostgreSQL** (מסד הנתונים).
2. **Connect** (או **Info**) → העתק את **External Database URL** (לא Internal).
3. השירות **stransport** (ה-Web Service עם Docker) → **Environment**.
4. הוסף או ערוך משתנה:
   - **Key:** `DATABASE_URL`
   - **Value:** ההעתקה של ה-**External** URL (משלב 2).
5. **Save Changes** → **Manual Deploy** → **Deploy latest commit**.

אחרי שה-DATABASE_URL מצביע על **External**, ה-host נפתר מ-Docker וה-migrate אמור לעבור.
