from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [migrations.CreateModel(name="ProductEvent", fields=[("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")), ("event", models.CharField(max_length=64)), ("created_at", models.DateTimeField(auto_now_add=True)), ("user", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="product_events", to=settings.AUTH_USER_MODEL))]), migrations.AddConstraint(model_name="productevent", constraint=models.UniqueConstraint(fields=("user", "event"), name="unique_product_event_per_user")), migrations.AddIndex(model_name="productevent", index=models.Index(fields=["event", "created_at"], name="core_produc_event_e43277_idx"))]
