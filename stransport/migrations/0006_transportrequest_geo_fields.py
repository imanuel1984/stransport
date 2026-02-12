from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("stransport", "0005_transportrequest_cancel_reason"),
    ]

    operations = [
        migrations.AddField(
            model_name="transportrequest",
            name="pickup_lat",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="transportrequest",
            name="pickup_lng",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="transportrequest",
            name="dest_lat",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="transportrequest",
            name="dest_lng",
            field=models.FloatField(blank=True, null=True),
        ),
    ]
