# 🚀 הדרכת הגדרה מהירה - Docker & GitHub Actions

## שלב 1️⃣: הכן את Docker Hub

1. צור חשבון ב-[Docker Hub](https://hub.docker.com/) אם אין לך
2. צור Access Token:
   - לחץ על שם המשתמש → Account Settings → Security
   - לחץ "New Access Token"
   - שמור את ה-token (תוכל לראות אותו רק פעם אחת!)

## שלב 2️⃣: הגדר Secrets ב-GitHub

1. עלה את הפרויקט ל-GitHub repository
2. עבור ל-Settings → Secrets and variables → Actions
3. לחץ "New repository secret" והוסף:

   **DOCKER_USERNAME**
   ```
   your-dockerhub-username
   ```

   **DOCKER_PASSWORD**
   ```
   your-docker-hub-access-token
   ```

4. (אופציונלי) הוסף GROQ_API_KEY אם רוצה לבדוק deployment:
   ```
   GROQ_API_KEY=your_groq_api_key
   ```

## שלב 3️⃣: בדוק את ה-Workflow

כעת כל push ל-branch `main` יפעיל אוטומטית:

1. ✅ בניית Docker image
2. ✅ דחיפה ל-Docker Hub
3. ✅ יצירת tags אוטומטית
4. ✅ תיעוד ב-Docker Hub

**לצפות ב-workflow:**
- עבור ל-Actions tab ב-GitHub
- ראה את ה-workflow "Build and Push Docker Image"

## שלב 4️⃣: בדיקה מקומית

### בדוק את ה-Docker build:

```bash
docker build -t trivia-test .
docker run -p 8000:8000 -e GROQ_API_KEY=your_key trivia-test
```

פתח דפדפן: http://localhost:8000

### בדוק עם Docker Compose:

```bash
# הגדר את API KEY
export GROQ_API_KEY=your_groq_api_key_here

# הרץ
docker-compose up

# בטאב אחר - בדוק logs
docker-compose logs -f web

# עצור
docker-compose down
```

## שלב 5️⃣: Push ל-GitHub והמתן לקסם ✨

```bash
git add .
git commit -m "Add Docker & CI/CD setup"
git push origin main
```

עכשיו:
1. עבור ל-Actions tab ב-GitHub
2. ראה את ה-workflow רץ בזמן אמת
3. כשמסתיים - הקובץ נמצא ב-Docker Hub!

## שלב 6️⃣: משוך את ה-Image מ-Docker Hub

אחרי ש-workflow הסתיים:

```bash
docker pull your-username/trivia-app:latest
docker run -p 8000:8000 -e GROQ_API_KEY=your_key your-username/trivia-app:latest
```

---

## 🎯 טיפים מתקדמים

### יצירת גרסה חדשה עם Tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

זה ייצור images עם:
- `v1.0.0`
- `1.0`
- `1`
- `latest`

### הרצה עם Docker Compose בפרודקשן:

ערוך `docker-compose.yml`:
```yaml
environment:
  - DEBUG=False
  - ALLOWED_HOSTS=yourdomain.com,www.yourdomain.com
```

### בדיקת Health:

```bash
# Container health
docker ps

# Application health
curl http://localhost:8000/

# Logs
docker logs trivia-web --tail 50 -f
```

---

## 🔧 פתרון בעיות

### Build נכשל?
- בדוק שכל הקבצים התווספו ל-git
- ודא ש-requirements.txt מעודכן
- בדוק logs ב-Actions tab

### Push ל-Docker Hub נכשל?
- ודא שה-secrets נכונים
- בדוק שה-Access Token תקף
- ודא ש-repository name תואם ב-docker-compose.yml

### Container לא עולה?
```bash
docker logs trivia-web
docker-compose logs web
```

### Port כבר בשימוש?
```bash
# שנה ל-port אחר
docker run -p 8080:8000 ...
```

---

## 📚 קישורים שימושיים

- [Docker Hub](https://hub.docker.com/)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Docker Compose Docs](https://docs.docker.com/compose/)

**בהצלחה! 🎉**
