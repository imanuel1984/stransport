from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("stransport", "0011_ride_offer"),
    ]

    operations = [
        migrations.AddField(
            model_name="rideoffer",
            name="from_lat",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="rideoffer",
            name="from_lng",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="rideoffer",
            name="to_lat",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="rideoffer",
            name="to_lng",
            field=models.FloatField(blank=True, null=True),
        ),
    ]

