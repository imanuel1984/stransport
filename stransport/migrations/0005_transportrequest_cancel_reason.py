from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("stransport", "0004_remove_transportrequest_number_of_people_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="transportrequest",
            name="cancel_reason",
            field=models.CharField(blank=True, max_length=50),
        ),
    ]
