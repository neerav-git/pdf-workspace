"""
Health endpoint tests.

These are the first tests to run — if they fail, every other test will fail too.
Fix service connectivity before running the rest of the suite.
"""


def test_basic_health(client):
    """GET /health must return 200 {"status": "ok"}."""
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_detailed_health_shape(client):
    """GET /health/detailed must return the expected service keys."""
    resp = client.get("/health/detailed")
    assert resp.status_code == 200
    body = resp.json()
    assert "status" in body
    assert "services" in body
    services = body["services"]
    for key in ("postgres", "chromadb", "s3", "api_keys"):
        assert key in services, f"Missing service key: {key}"


def test_detailed_health_postgres(client):
    """Postgres must be reachable."""
    resp = client.get("/health/detailed")
    postgres = resp.json()["services"]["postgres"]
    assert postgres["ok"], f"Postgres not OK: {postgres.get('error')}"


def test_detailed_health_chromadb(client):
    """ChromaDB must be reachable."""
    resp = client.get("/health/detailed")
    chromadb = resp.json()["services"]["chromadb"]
    assert chromadb["ok"], f"ChromaDB not OK: {chromadb.get('error')}"


def test_detailed_health_s3(client):
    """S3 must be reachable."""
    resp = client.get("/health/detailed")
    s3 = resp.json()["services"]["s3"]
    assert s3["ok"], f"S3 not OK: {s3.get('error')}"


def test_detailed_health_api_keys(client):
    """Critical API keys must be present in the environment."""
    resp = client.get("/health/detailed")
    keys = resp.json()["services"]["api_keys"]
    assert keys.get("anthropic"), "ANTHROPIC_API_KEY is missing from .env"
    assert keys.get("openai"), "OPENAI_API_KEY is missing from .env"
