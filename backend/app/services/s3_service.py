import boto3
from botocore.exceptions import ClientError
from app.core.config import settings


def _client():
    return boto3.client(
        "s3",
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
    )


def upload_file(file_bytes: bytes, s3_key: str, content_type: str = "application/pdf") -> str:
    """Upload bytes to S3 and return the s3_key."""
    client = _client()
    client.put_object(
        Bucket=settings.S3_BUCKET_NAME,
        Key=s3_key,
        Body=file_bytes,
        ContentType=content_type,
    )
    return s3_key


def get_presigned_url(s3_key: str, expires_in: int = 3600) -> str:
    """Return a pre-signed GET URL for the given key."""
    client = _client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET_NAME, "Key": s3_key},
        ExpiresIn=expires_in,
    )


def get_file_bytes(s3_key: str) -> bytes:
    """Download and return raw bytes from S3."""
    client = _client()
    response = client.get_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)
    return response["Body"].read()
