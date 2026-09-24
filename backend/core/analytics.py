from .models import ProductEvent


def record_activation_event(user, event):
    """Best-effort, once-per-account milestones without sensitive metadata."""
    ProductEvent.objects.get_or_create(user=user, event=event)
