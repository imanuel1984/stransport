from django.apps import AppConfig


class AgentsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    # Full module path is required because the app is nested under backend/
    name = 'backend.agents'
    verbose_name = 'AI Matching Agents'

