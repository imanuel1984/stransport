from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name='riderequest',
            name='pickup_lat',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='riderequest',
            name='pickup_lng',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='volunteeravailability',
            name='current_lat',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='volunteeravailability',
            name='current_lng',
            field=models.FloatField(blank=True, null=True),
        ),
    ]

