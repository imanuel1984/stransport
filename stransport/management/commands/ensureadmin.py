"""
יוצר משתמש אדמין בהפעלה אם לא קיים. לשימוש ב-Render: הגדר ADMIN_PASSWORD ב-Environment.
"""
import os
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User


class Command(BaseCommand):
    help = "יוצר superuser 'admin' אם לא קיים (קורא ADMIN_PASSWORD מ-env, לשימוש ב-Render)"

    def handle(self, *args, **options):
        username = os.environ.get("ADMIN_USERNAME", "admin")
        email = os.environ.get("ADMIN_EMAIL", "admin@example.com")
        password = os.environ.get("ADMIN_PASSWORD", "").strip()

        if User.objects.filter(username=username).exists():
            self.stdout.write(self.style.SUCCESS(f"משתמש '{username}' כבר קיים."))
            return

        if not password:
            self.stdout.write(
                self.style.WARNING("הגדר ADMIN_PASSWORD ב-Render Environment כדי ליצור אדמין אוטומטית.")
            )
            return

        User.objects.create_superuser(username=username, email=email, password=password)
        self.stdout.write(self.style.SUCCESS(f"נוצר אדמין '{username}'."))
