import os
import django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from accounts.models import User

# Set password for admin
user = User.objects.get(email='admin@admin.com')
user.set_password('admin')
user.save()
print('✓ Password set for admin@admin.com')
