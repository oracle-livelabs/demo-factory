#!/usr/bin/env python3
"""Wait for and validate the VM's public-only Select AI API-key callback."""

import base64
import binascii
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request


def required(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"{name} must be set")
    return value


callback_url = required("API_KEY_PUBLIC_CALLBACK_URL")
bootstrap_status_url = required("BOOTSTRAP_STATUS_URL")
deployment_id = required("EXPECTED_DEPLOYMENT_ID")
instance_ocid = required("EXPECTED_INSTANCE_OCID")
timeout_seconds = int(os.environ.get("WAIT_TIMEOUT_SECONDS", "1800"))
poll_seconds = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
max_age_seconds = int(os.environ.get("MAX_CALLBACK_AGE_SECONDS", "1800"))

if not callback_url.startswith("https://"):
    raise SystemExit("API_KEY_PUBLIC_CALLBACK_URL must use HTTPS")
if not bootstrap_status_url.startswith("https://"):
    raise SystemExit("BOOTSTRAP_STATUS_URL must use HTTPS")
if not re.fullmatch(r"[0-9a-f]{8}", deployment_id):
    raise SystemExit("EXPECTED_DEPLOYMENT_ID is invalid")
if not re.fullmatch(r"ocid1\.instance\.[A-Za-z0-9._-]+", instance_ocid):
    raise SystemExit("EXPECTED_INSTANCE_OCID is invalid")
if not 60 <= timeout_seconds <= 7200:
    raise SystemExit("WAIT_TIMEOUT_SECONDS is outside the supported range")
if not 1 <= poll_seconds <= 60:
    raise SystemExit("POLL_INTERVAL_SECONDS is outside the supported range")
if not 60 <= max_age_seconds <= timeout_seconds:
    raise SystemExit("MAX_CALLBACK_AGE_SECONDS is outside the supported range")


def fetch(url, max_bytes):
    request = urllib.request.Request(
        url,
        headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status != 200:
                return None
            body = response.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise ValueError("callback exceeds its size limit")
            return body
    except (urllib.error.URLError, TimeoutError):
        return None


def fetch_bootstrap_status():
    body = fetch(bootstrap_status_url, 4096)
    if body is None:
        return None

    try:
        fields = {}
        for line in body.decode("utf-8").splitlines():
            name, separator, value = line.partition("=")
            if separator:
                fields[name] = value
    except UnicodeDecodeError:
        return {}

    if (
        fields.get("deployment_id") == deployment_id
        and fields.get("instance_ocid") == instance_ocid
    ):
        return fields
    return {}


def parse_utc(value):
    if not isinstance(value, str):
        raise ValueError("issued_at is missing")
    try:
        parsed = dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise ValueError("issued_at is not a UTC timestamp") from exc
    return parsed.replace(tzinfo=dt.timezone.utc)


def validate_public_key(value):
    if not isinstance(value, str) or not 300 <= len(value) <= 4096:
        raise ValueError("public_key_b64 has an invalid size")
    try:
        pem = base64.b64decode(value, validate=True).decode("ascii")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise ValueError("public_key_b64 is not valid base64-encoded ASCII") from exc

    lines = pem.strip().splitlines()
    if (
        len(lines) < 3
        or lines[0] != "-----BEGIN PUBLIC KEY-----"
        or lines[-1] != "-----END PUBLIC KEY-----"
    ):
        raise ValueError("callback does not contain a PEM public key")

    try:
        der = base64.b64decode("".join(lines[1:-1]), validate=True)
    except binascii.Error as exc:
        raise ValueError("PEM body is not valid base64") from exc
    if len(der) < 250 or der[0] != 0x30:
        raise ValueError("PEM body is not a plausible RSA SubjectPublicKeyInfo value")


deadline = time.monotonic() + timeout_seconds
last_notice = ""

print(
    f"Waiting up to {timeout_seconds // 60} minutes for the VM's bound Select AI public-key callback.",
    flush=True,
)

while time.monotonic() < deadline:
    bootstrap_status = fetch_bootstrap_status()
    if bootstrap_status and bootstrap_status.get("state") == "FAILED":
        phase = bootstrap_status.get("phase", "unknown")
        raise SystemExit(
            f"The VM reported bootstrap failure during phase: {phase}. "
            "Use bootstrap_log_command from the stack outputs."
        )

    body = fetch(callback_url, 8192)
    if body is None:
        notice = "Waiting for the public-key callback object to become readable."
    else:
        try:
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise ValueError("callback root must be a JSON object")
            if payload.get("state") == "PENDING":
                notice = "Waiting for the VM to generate its stack-specific public key."
            elif (
                payload.get("format") != "finance-selectai-api-key-public/v1"
                or payload.get("state") != "READY"
                or payload.get("marker") != "SELECTAI_API_KEY_PUBLIC_READY"
            ):
                notice = "Ignoring a callback with an unsupported format or state."
            elif (
                payload.get("deployment_id") != deployment_id
                or payload.get("instance_ocid") != instance_ocid
            ):
                notice = "Ignoring a stale callback from another deployment or VM."
            else:
                issued_at = parse_utc(payload.get("issued_at"))
                age = (dt.datetime.now(dt.timezone.utc) - issued_at).total_seconds()
                if age < -300 or age > max_age_seconds:
                    notice = "Ignoring a callback outside the allowed freshness window."
                else:
                    validate_public_key(payload.get("public_key_b64"))
                    print(
                        "Validated a fresh public-only callback for this deployment and VM.",
                        flush=True,
                    )
                    raise SystemExit(0)
        except (json.JSONDecodeError, TypeError, ValueError):
            notice = "Waiting for a complete, valid public-key callback."

    if notice != last_notice:
        print(notice, flush=True)
        last_notice = notice
    time.sleep(poll_seconds)

raise SystemExit(
    "Timed out waiting for the VM's fresh Select AI public-key callback. "
    "Use bootstrap_log_command from the stack outputs."
)
