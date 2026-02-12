from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("stransport", "0006_transportrequest_geo_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="transportrequest",
            name="ai_summary",
            field=models.TextField(blank=True),
        ),
    ]
