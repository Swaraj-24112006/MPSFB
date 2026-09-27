import pytest
from rest_framework.test import APIClient
from django.contrib.auth.models import User


@pytest.fixture
def api_client(db):
    """
    Returns an independent APIClient instance authenticated with a test user.
    """
    client = APIClient()
    user = User.objects.create_user(username='testplanner', password='password123')
    client.force_authenticate(user=user)
    return client
