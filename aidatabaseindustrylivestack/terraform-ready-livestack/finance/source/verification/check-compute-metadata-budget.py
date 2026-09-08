#!/usr/bin/env python3
"""Prove the gzip cloud-init path stays below the OCI metadata budget."""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
from pathlib import Path
import re


SOURCE_ROOT = Path(__file__).resolve().parents[1]
OCI_METADATA_LIMIT_BYTES = 32000
PROJECT_METADATA_BUDGET_BYTES = 30000
MINIMUM_FIXTURE_HEADROOM_BYTES = 4096
SSH_PUBLIC_KEY_MAX_CHARACTERS = 4096
PAR_URL_FIXTURE_CHARACTERS = 1024
MODEL_URI_MAX_CHARACTERS = 2048
OCID_FIXTURE_CHARACTERS = 255


def fail(message: str) -> None:
    raise ValueError(message)


def deterministic_token(label: str, length: int) -> str:
    chunks: list[str] = []
    counter = 0
    while sum(map(len, chunks)) < length:
        digest = hashlib.sha512(f"{label}:{counter}".encode("utf-8")).digest()
        chunks.append(base64.b64encode(digest).decode("ascii").rstrip("="))
        counter += 1
    return "".join(chunks)[:length]


def fixed_length_value(prefix: str, label: str, length: int) -> str:
    if len(prefix) > length:
        fail(f"Fixture prefix for {label} exceeds requested length")
    return prefix + deterministic_token(label, length - len(prefix))


def encode(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


def terraform_indent(width: int, value: str) -> str:
    lines = value.split("\n")
    return lines[0] + "".join(f"\n{' ' * width}{line}" for line in lines[1:])


def render_cloud_init() -> str:
    template = (SOURCE_ROOT / "cloud-init" / "app.yaml").read_text(
        encoding="utf-8"
    )
    script = (SOURCE_ROOT / "scripts" / "bootstrap_app_vm.sh").read_text(
        encoding="utf-8"
    ).strip()

    par_values = {
        key: encode(
            fixed_length_value(
                "https://objectstorage.eu-frankfurt-1.oraclecloud.com/p/",
                key,
                PAR_URL_FIXTURE_CHARACTERS,
            )
        )
        for key in (
            "application_archive_url_b64",
            "wallet_archive_url_b64",
            "bootstrap_status_upload_url_b64",
            "api_key_public_upload_url_b64",
            "api_key_activation_url_b64",
        )
    }
    values = {
        **par_values,
        "adb_admin_password_b64": encode(deterministic_token("admin", 30)),
        "application_password_b64": encode(
            deterministic_token("application", 30)
        ),
        "wallet_password_b64": encode(deterministic_token("wallet", 30)),
        "adb_service_name_b64": encode("fin12345678_high"),
        "model_object_uri_b64": encode(
            fixed_length_value(
                "https://objectstorage.us-ashburn-1.oraclecloud.com/p/",
                "model-uri",
                MODEL_URI_MAX_CHARACTERS,
            )
        ),
        "tenancy_ocid_b64": encode(
            fixed_length_value(
                "ocid1.tenancy.oc1..",
                "tenancy-ocid",
                OCID_FIXTURE_CHARACTERS,
            )
        ),
        "current_user_ocid_b64": encode(
            fixed_length_value(
                "ocid1.user.oc1..",
                "user-ocid",
                OCID_FIXTURE_CHARACTERS,
            )
        ),
        "compartment_ocid_b64": encode(
            fixed_length_value(
                "ocid1.compartment.oc1..",
                "compartment-ocid",
                OCID_FIXTURE_CHARACTERS,
            )
        ),
        "oci_genai_region_b64": encode("eu-frankfurt-1"),
        "oci_genai_model_b64": encode("cohere.command-a-03-2025"),
        "select_ai_profile_b64": encode("FINANCE_SELECTAI_V1"),
        "select_ai_primary_team_b64": encode("FINANCE_OPERATIONS_TEAM"),
        "select_ai_agent_teams_b64": encode(
            "FINANCE_OPERATIONS_TEAM,SOCIAL_TREND_TEAM,"
            "FULFILLMENT_TEAM,COMMERCE_TEAM"
        ),
        "deployment_id": "1234abcd",
        "application_port": "8505",
        "bootstrap_app_vm_script": terraform_indent(6, script),
    }

    placeholder = re.compile(r"\$\{([a-z0-9_]+)\}")
    missing_values = sorted(set(placeholder.findall(template)) - values.keys())
    if missing_values:
        fail(
            "Cloud-init fixture has no value for template variable(s): "
            + ", ".join(missing_values)
        )

    def substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        return values[name]

    # Substitute only the cloud-init template. Shell ${...} expansions inside
    # the injected bootstrap script are runtime content, not Terraform
    # template variables, and must remain intact.
    return placeholder.sub(substitute, template)


def metadata_json_size(user_data: str, ssh_public_key: str) -> int:
    metadata = {
        "ssh_authorized_keys": ssh_public_key,
        "user_data": user_data,
    }
    serialized = json.dumps(
        metadata,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return len(serialized)


def assert_terraform_contract() -> None:
    compute_text = (SOURCE_ROOT / "compute-app.tf").read_text(encoding="utf-8")
    main_text = (SOURCE_ROOT / "main.tf").read_text(encoding="utf-8")
    variables_text = (SOURCE_ROOT / "variables.tf").read_text(encoding="utf-8")
    schema_text = (SOURCE_ROOT / "schema.yaml").read_text(encoding="utf-8")

    required_compute_fragments = (
        "application_cloud_init = templatefile(",
        "user_data           = base64gzip(local.application_cloud_init)",
        "application_instance_metadata_budget_bytes = 30000",
        "application_metadata_size_bytes <= local.application_instance_metadata_budget_bytes",
        "metadata = local.application_instance_metadata",
    )
    for fragment in required_compute_fragments:
        if fragment not in compute_text:
            fail(f"compute-app.tf is missing metadata contract: {fragment}")
    if re.search(r"base64encode\s*\(\s*templatefile\s*\(", compute_text):
        fail("compute-app.tf still uses the oversized plain-Base64 template path")
    if 'filesha256("${path.module}/compute-app.tf")' not in main_text:
        fail("bootstrap_configuration does not rotate when Compute delivery changes")
    if 'filesha256("${path.module}/object-storage.tf")' not in main_text:
        fail("bootstrap_configuration does not rotate when payload delivery changes")
    if "length(trimspace(var.ssh_public_key)) <= 4096" not in variables_text:
        fail("Terraform does not bound the single SSH public key to 4,096 characters")
    if not re.search(r"ssh_public_key:.*?maxLength:\s*4096", schema_text, re.S):
        fail("Resource Manager schema does not bound the SSH public key")


def main() -> int:
    assert_terraform_contract()
    rendered = render_cloud_init()
    compressed_bytes = gzip.compress(
        rendered.encode("utf-8"),
        compresslevel=6,
        mtime=0,
    )
    compressed_user_data = base64.b64encode(compressed_bytes).decode("ascii")
    legacy_user_data = encode(rendered)

    if not compressed_bytes.startswith(b"\x1f\x8b"):
        fail("Compressed user-data fixture has no gzip magic header")
    if gzip.decompress(base64.b64decode(compressed_user_data)).decode(
        "utf-8"
    ) != rendered:
        fail("Gzip/Base64 cloud-init round-trip changed the rendered payload")

    ssh_prefix = "ssh-rsa "
    ssh_suffix = " metadata-budget@example.invalid"
    ssh_public_key = fixed_length_value(
        ssh_prefix,
        "ssh-public-key",
        SSH_PUBLIC_KEY_MAX_CHARACTERS - len(ssh_suffix),
    ) + ssh_suffix
    legacy_size = metadata_json_size(legacy_user_data, ssh_public_key)
    compressed_size = metadata_json_size(compressed_user_data, ssh_public_key)
    fixture_headroom = PROJECT_METADATA_BUDGET_BYTES - compressed_size

    if legacy_size <= OCI_METADATA_LIMIT_BYTES:
        fail(
            "RED fixture no longer reproduces the legacy metadata overflow: "
            f"{legacy_size} bytes"
        )
    if compressed_size > PROJECT_METADATA_BUDGET_BYTES:
        fail(
            "Compressed fixture exceeds the project metadata budget: "
            f"{compressed_size} bytes"
        )
    if fixture_headroom < MINIMUM_FIXTURE_HEADROOM_BYTES:
        fail(
            "Compressed fixture has insufficient project-budget headroom: "
            f"{fixture_headroom} bytes"
        )

    print(
        "PASS: legacy plain-Base64 fixture exceeds OCI metadata limit "
        f"({legacy_size} > {OCI_METADATA_LIMIT_BYTES} bytes)"
    )
    print(
        "PASS: gzip/Base64 fixture round-trips and fits the project budget "
        f"({compressed_size} bytes; {fixture_headroom} bytes headroom)"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError) as exc:
        print(f"metadata budget verification failed: {exc}")
        raise SystemExit(2)
