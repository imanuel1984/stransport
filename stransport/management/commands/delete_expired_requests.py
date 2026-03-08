from django.core.management.base import BaseCommand
from stransport.views import delete_expired_requests


class Command(BaseCommand):
    help = "מחיקת בקשות הסעה שמועד האיסוף שלהן עבר (לפחות 30 דקות)"

    def handle(self, *args, **options):
        delete_expired_requests()
        self.stdout.write(self.style.SUCCESS("ניקוי בקשות ישנות הושלם."))
