import os
import io
import logging
from pathlib import Path
from typing import Union, BinaryIO
from django.conf import settings
import boto3
from botocore.client import Config
from botocore.exceptions import ClientError, EndpointConnectionError

logger = logging.getLogger(__name__)


class StorageService:
    """
    Centralized Storage Service for MinIO (S3-compatible) file uploads and retrievals.
    Supports streaming file uploads and provides transparent local fallback
    when running in offline/local environments without MinIO active.
    """

    _s3_client = None

    @classmethod
    def get_client(cls):
        """Lazy initialization of boto3 S3 client configured for MinIO."""
        if cls._s3_client is None:
            endpoint_url = f"{'https' if settings.MINIO_USE_HTTPS else 'http'}://{settings.MINIO_ENDPOINT}"
            cls._s3_client = boto3.client(
                's3',
                endpoint_url=endpoint_url,
                aws_access_key_id=settings.MINIO_ACCESS_KEY,
                aws_secret_access_key=settings.MINIO_SECRET_KEY,
                config=Config(
                    signature_version='s3v4',
                    connect_timeout=2,
                    read_timeout=3,
                    retries={'max_attempts': 1}
                ),
                region_name='us-east-1'
            )
        return cls._s3_client

    @classmethod
    def ensure_bucket_exists(cls, bucket_name: str = None) -> bool:
        """Checks if bucket exists; if not, attempts creation."""
        bucket = bucket_name or settings.MINIO_BUCKET_NAME
        client = cls.get_client()
        try:
            client.head_bucket(Bucket=bucket)
            return True
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code')
            if error_code in ('404', 'NoSuchBucket'):
                try:
                    client.create_bucket(Bucket=bucket)
                    logger.info(f"[StorageService] Created bucket: {bucket}")
                    return True
                except Exception as create_err:
                    logger.warning(f"[StorageService] Failed to create bucket {bucket}: {create_err}")
                    return False
            logger.warning(f"[StorageService] Bucket check error: {e}")
            return False
        except (EndpointConnectionError, Exception) as e:
            logger.warning(f"[StorageService] MinIO connection error: {e}")
            return False

    @classmethod
    def upload_file(
        cls,
        file_obj: Union[BinaryIO, bytes, io.BytesIO],
        path: str,
        bucket_name: str = None,
        content_type: str = 'application/octet-stream'
    ) -> str:
        """
        Uploads a file object or raw bytes to MinIO storage.
        Returns the stored minio_path (e.g. 'mps-uploads/uploads/file.xlsx' or 'uploads/file.xlsx').
        Falls back to local MEDIA_ROOT if MinIO is unreachable.
        """
        bucket = bucket_name or settings.MINIO_BUCKET_NAME
        # Normalize relative path forward slashes
        clean_path = path.lstrip('/\\').replace('\\', '/')

        # Detect content type from file object if available
        if hasattr(file_obj, 'content_type') and file_obj.content_type:
            content_type = file_obj.content_type

        # Extract content bytes safely so underlying file is never closed by boto3 or left exhausted
        if isinstance(file_obj, bytes):
            data_bytes = file_obj
        elif hasattr(file_obj, 'read'):
            if hasattr(file_obj, 'seek'):
                try:
                    file_obj.seek(0)
                except Exception:
                    pass
            data_bytes = file_obj.read()
            if hasattr(file_obj, 'seek'):
                try:
                    file_obj.seek(0)
                except Exception:
                    pass
        else:
            data_bytes = b''

        try:
            if not cls.ensure_bucket_exists(bucket):
                logger.warning(
                    f"[StorageService] Bucket '{bucket}' unavailable. Falling back to local MEDIA storage."
                )
                return cls._fallback_local_upload(data_bytes, clean_path)

            client = cls.get_client()
            client.put_object(
                Bucket=bucket,
                Key=clean_path,
                Body=data_bytes,
                ContentType=content_type
            )

            # Ensure caller's file pointer remains at beginning if applicable
            if hasattr(file_obj, 'seek'):
                try:
                    file_obj.seek(0)
                except Exception:
                    pass

            logger.info(f"[StorageService] File uploaded successfully to s3://{bucket}/{clean_path}")
            return f"{bucket}/{clean_path}"

        except (EndpointConnectionError, ClientError, Exception) as err:
            logger.warning(
                f"[StorageService] MinIO unreachable or error ({err}). Falling back to local MEDIA storage."
            )
            # Ensure caller's file pointer remains at beginning if applicable
            if hasattr(file_obj, 'seek'):
                try:
                    file_obj.seek(0)
                except Exception:
                    pass
            return cls._fallback_local_upload(data_bytes, clean_path)

    @classmethod
    def _fallback_local_upload(cls, data: Union[BinaryIO, bytes], clean_path: str) -> str:
        """Saves file to local MEDIA_ROOT when MinIO is not running."""
        dest_full_path = Path(settings.MEDIA_ROOT) / clean_path
        dest_full_path.parent.mkdir(parents=True, exist_ok=True)

        with open(dest_full_path, 'wb') as f:
            if isinstance(data, bytes):
                f.write(data)
            elif hasattr(data, 'chunks'):
                for chunk in data.chunks():
                    f.write(chunk)
            elif hasattr(data, 'read'):
                if hasattr(data, 'seek'):
                    try:
                        data.seek(0)
                    except Exception:
                        pass
                f.write(data.read())

        logger.info(f"[StorageService] Saved to local fallback: {dest_full_path}")
        return f"local/{clean_path}"

    @classmethod
    def get_file(cls, path: str, bucket_name: str = None) -> bytes:
        """Downloads and returns file content as bytes."""
        bucket = bucket_name or settings.MINIO_BUCKET_NAME
        clean_path = path.lstrip('/\\').replace('\\', '/')

        if clean_path.startswith(f"{bucket}/"):
            clean_path = clean_path[len(f"{bucket}/"):]

        if clean_path.startswith("local/"):
            local_rel = clean_path[len("local/"):]
            local_full_path = Path(settings.MEDIA_ROOT) / local_rel
            with open(local_full_path, 'rb') as f:
                return f.read()

        try:
            client = cls.get_client()
            res = client.get_object(Bucket=bucket, Key=clean_path)
            return res['Body'].read()
        except Exception as e:
            # Try local fallback
            local_full_path = Path(settings.MEDIA_ROOT) / clean_path
            if local_full_path.exists():
                with open(local_full_path, 'rb') as f:
                    return f.read()
            raise FileNotFoundError(f"File not found in MinIO or local storage: {path}") from e

    @classmethod
    def get_presigned_url(cls, path: str, bucket_name: str = None, expiry: int = 3600) -> str:
        """Generates a presigned URL for downloading the file from MinIO."""
        bucket = bucket_name or settings.MINIO_BUCKET_NAME
        clean_path = path.lstrip('/\\').replace('\\', '/')

        if clean_path.startswith(f"{bucket}/"):
            clean_path = clean_path[len(f"{bucket}/"):]

        try:
            client = cls.get_client()
            return client.generate_presigned_url(
                'get_object',
                Params={'Bucket': bucket, 'Key': clean_path},
                ExpiresIn=expiry
            )
        except Exception as e:
            logger.warning(f"[StorageService] Could not generate presigned URL: {e}")
            return f"/media/{clean_path}"

    @classmethod
    def delete_file(cls, path: str, bucket_name: str = None) -> bool:
        """Deletes a file from storage."""
        bucket = bucket_name or settings.MINIO_BUCKET_NAME
        clean_path = path.lstrip('/\\').replace('\\', '/')

        if clean_path.startswith("local/"):
            local_rel = clean_path[len("local/"):]
            local_path = Path(settings.MEDIA_ROOT) / local_rel
            if local_path.exists():
                local_path.unlink()
                return True
            return False

        if clean_path.startswith(f"{bucket}/"):
            clean_path = clean_path[len(f"{bucket}/"):]

        deleted = False
        try:
            client = cls.get_client()
            client.delete_object(Bucket=bucket, Key=clean_path)
            deleted = True
        except Exception:
            pass

        local_path = Path(settings.MEDIA_ROOT) / clean_path
        if local_path.exists():
            local_path.unlink()
            deleted = True

        return deleted
