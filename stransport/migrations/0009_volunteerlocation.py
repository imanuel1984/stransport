from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("stransport", "0008_alter_profile_role"),
    ]

    operations = [
        migrations.CreateModel(
            name="VolunteerLocation",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("lat", models.FloatField()),
                ("lng", models.FloatField()),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "assignment",
                    models.OneToOneField(
                        on_delete=models.deletion.CASCADE,
                        related_name="location",
                        to="stransport.transportassignment",
                    ),
                ),
            ],
        ),
    ]

