"""
יוצר משתמש אדמין בהפעלה אם לא קיים. לשימוש ב-Render: הגדר ADMIN_PASSWORD ב-Environment.
"""
import os
import logging
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "יוצר superuser 'admin' אם לא קיים (קורא ADMIN_PASSWORD מ-env, לשימוש ב-Render)"

    def handle(self, *args, **options):
        username = os.environ.get("ADMIN_USERNAME", "admin")
        email = os.environ.get("ADMIN_EMAIL", "admin@example.com")
        password = os.environ.get("ADMIN_PASSWORD", "").strip()

        if User.objects.filter(username=username).exists():
            self.stdout.write(self.style.SUCCESS(f"משתמש '{username}' כבר קיים."))
            try:
                from stransport.models import Profile
                u = User.objects.get(username=username)
                if not getattr(u, "profile", None):
                    Profile.objects.get_or_create(user=u, defaults={"role": "volunteer"})
                    self.stdout.write(self.style.SUCCESS("נוסף Profile לאדמין."))
                # If ADMIN_PASSWORD is provided, ensure the admin password matches the current env.
                # This fixes the common case where the user already exists from a previous deploy.
                if password:
                    changed_flags = False
                    if not u.is_active:
                        u.is_active = True
                        changed_flags = True
                    if not u.is_staff:
                        u.is_staff = True
                        changed_flags = True
                    if not u.is_superuser:
                        u.is_superuser = True
                        changed_flags = True
                    if changed_flags:
                        u.save(update_fields=["is_active", "is_staff", "is_superuser"])
                        self.stdout.write(self.style.SUCCESS("עודכנו הרשאות אדמין (is_staff/is_superuser/is_active)."))
                    u.set_password(password)
                    u.save(update_fields=["password"])
                    self.stdout.write(self.style.SUCCESS("עודכנה סיסמת האדמין לפי ADMIN_PASSWORD."))
            except Exception as e:
                logger.warning("ensureadmin profile check: %s", e)
            return

        if not password:
            self.stdout.write(
                self.style.WARNING("הגדר ADMIN_PASSWORD ב-Render Environment כדי ליצור אדמין אוטומטית.")
            )
            return

        try:
            u = User.objects.create_superuser(username=username, email=email, password=password)
            try:
                from stransport.models import Profile
                Profile.objects.get_or_create(user=u, defaults={"role": "volunteer"})
            except Exception as e:
                logger.warning("ensureadmin profile create: %s", e)
            self.stdout.write(self.style.SUCCESS(f"נוצר אדמין '{username}'."))
        except Exception as e:
            logger.exception("ensureadmin failed")
            self.stdout.write(self.style.ERROR(f"שגיאה: {e}"))
