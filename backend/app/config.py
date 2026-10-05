import os


def normalize_web_origin(value: str, environment: str) -> str:
    if environment == "production" and "://" not in value:
        return f"https://{value}"
    return value


APP_ENV = os.getenv("APP_ENV", "development").lower()
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./focusverify.db")
AUTH_SECRET = os.getenv("AUTH_SECRET", "change-me-in-production")
MODEL_CONFIG = os.getenv("MODEL_CONFIG", "focusverify-v1")
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
WEB_ORIGIN = normalize_web_origin(
    os.getenv("WEB_ORIGIN", "http://localhost:3000"),
    APP_ENV,
)
REVIEWER_EMAIL = os.getenv("REVIEWER_EMAIL", "reviewer@focusverify.local")
REVIEWER_PASSWORD = os.getenv("REVIEWER_PASSWORD", "focusverify-demo")
AUTH_RATE_LIMIT = int(os.getenv("AUTH_RATE_LIMIT", "5"))
AUTH_RATE_WINDOW_SECONDS = int(os.getenv("AUTH_RATE_WINDOW_SECONDS", "900"))
SESSION_CREATE_LIMIT = int(os.getenv("SESSION_CREATE_LIMIT", "20"))
EVENT_INGESTION_LIMIT = int(os.getenv("EVENT_INGESTION_LIMIT", "120"))
