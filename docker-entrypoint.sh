#!/bin/sh
set -e
# Render: DATABASE_URL must be in Service → Environment. Use *External* DB URL if you get "Name or service not known".
if [ -n "$DATABASE_URL" ]; then
  echo "DATABASE_URL is set"
else
  echo "WARNING: DATABASE_URL is not set in container"
fi
for i in 1 2 3 4 5 6 7 8 9 10; do
  if python manage.py migrate --noinput; then
    echo "Migrate OK"
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "Migrate failed. On Render: use the *External* Database URL (PostgreSQL → Connect → External) in this service Environment, then redeploy."
    exit 1
  fi
  echo "Migrate attempt $i failed, retry in 5s..."
  sleep 5
done

# Create/update Django admin user in Render if configured.
# (safe to run every boot; command is idempotent)
if [ -n "$ADMIN_PASSWORD" ]; then
  python manage.py ensureadmin || true
else
  echo "ADMIN_PASSWORD not set; skipping ensureadmin"
fi

exec gunicorn --bind 0.0.0.0:${PORT:-8000} --workers 3 --timeout 60 stransport_pro.wsgi:application
