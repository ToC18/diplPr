#!/bin/sh
set -e

python manage.py migrate
python manage.py shell -c "from django.contrib.auth import get_user_model; import os; U=get_user_model(); username=os.getenv('DJANGO_SUPERUSER_USERNAME','admin'); email=os.getenv('DJANGO_SUPERUSER_EMAIL','admin@example.com'); password=os.getenv('DJANGO_SUPERUSER_PASSWORD','admin'); U.objects.filter(username=username).exists() or U.objects.create_superuser(username,email,password)"
python manage.py runserver 0.0.0.0:8000
