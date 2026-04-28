"""Runtime config for the sample API service."""

import os

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./sample.db")
DEBUG = os.environ.get("DEBUG", "0") == "1"
API_PREFIX = "/api"
