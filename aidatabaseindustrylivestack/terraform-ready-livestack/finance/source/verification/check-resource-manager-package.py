#!/usr/bin/env python3
"""Verify the static application payload and clean Resource Manager archive."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--archive", type=Path)
    return parser.parse_args()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def assert_safe_infos(archive: zipfile.ZipFile, label: str) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    casefolded: set[str] = set()

    bad_member = archive.testzip()
    if bad_member is not None:
        raise ValueError(f"{label} CRC/integrity failure at {bad_member}")

    for info in archive.infolist():
        name = info.filename
        path = PurePosixPath(name)
        if (
            not name
            or name.startswith("/")
            or "\\" in name
            or any(part in {"", ".", ".."} for part in path.parts)
        ):
            raise ValueError(f"{label} contains unsafe path: {name!r}")
        if name in seen:
            raise ValueError(f"{label} contains duplicate member: {name}")
        folded = name.casefold()
        if folded in casefolded:
            raise ValueError(f"{label} contains a case-colliding member: {name}")
        if info.flag_bits & 0x1:
            raise ValueError(f"{label} contains encrypted member: {name}")

        unix_mode = (info.external_attr >> 16) & 0xFFFF
        if stat.S_ISLNK(unix_mode):
            raise ValueError(f"{label} contains symbolic link: {name}")
        file_type = stat.S_IFMT(unix_mode)
        if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
            raise ValueError(f"{label} contains special filesystem entry: {name}")

        seen.add(name)
        casefolded.add(folded)
        names.append(name)
    return names


def is_forbidden_member(name: str) -> bool:
    path = PurePosixPath(name.rstrip("/"))
    parts = [part.casefold() for part in path.parts]
    basename = parts[-1] if parts else ""

    forbidden_directories = {
        ".terraform",
        ".git",
        ".hg",
        ".svn",
        ".idea",
        ".vscode",
        "__macosx",
        "__pycache__",
        "node_modules",
        "coverage",
    }
    if any(part in forbidden_directories for part in parts):
        return True
    if (
        basename == ".ds_store"
        or (basename.startswith(".env") and basename != ".env.example")
        or basename.startswith("._")
    ):
        return True
    if basename.endswith(
        (
            ".pyc",
            ".pyo",
            ".swp",
            ".swo",
            ".log",
            ".pem",
            ".key",
            ".tfplan",
            ".tfvars",
            ".tfvars.json",
            ".tfstate",
            ".b64",
            ".p12",
            ".pfx",
            ".jks",
            "~",
        )
    ):
        return True
    if ".auto.tfvars" in basename or basename == "cwallet.sso":
        return True
    if ".tfstate." in basename or basename.endswith(".generated.zip"):
        return True
    if "wallet" in basename and basename.endswith(".zip"):
        return True
    return False


def scan_archive_text(
    archive: zipfile.ZipFile, names: list[str], label: str
) -> None:
    private_key = re.compile(
        rb"BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY"
    )
    local_model = re.compile(rb"ollama|llama3[.]2|11434", re.IGNORECASE)

    for name in names:
        if (
            name.endswith("/")
            or name.casefold().endswith(".zip")
            or name.endswith("verification/check-resource-manager-package.py")
            or name.endswith("verification/check-selectai-platform-contract.sh")
        ):
            continue
        data = archive.read(name)
        if private_key.search(data):
            raise ValueError(f"{label} contains private-key material in {name}")
        if local_model.search(data):
            raise ValueError(
                f"{label} contains a forbidden local-model runtime reference in {name}"
            )


def validate_payload(payload_path: Path) -> tuple[str, int]:
    if not payload_path.is_file():
        raise ValueError(f"Static application payload is missing: {payload_path}")

    with zipfile.ZipFile(payload_path) as archive:
        names = assert_safe_infos(archive, "application payload")
        forbidden = [name for name in names if is_forbidden_member(name)]
        if forbidden:
            raise ValueError(
                "Application payload contains forbidden artifact: " + forbidden[0]
            )
        nested = [
            name
            for name in names
            if not name.endswith("/") and name.casefold().endswith(".zip")
        ]
        if nested:
            raise ValueError(
                "Application payload contains an unexpected nested ZIP: " + nested[0]
            )
        required = {
            "Containerfile",
            "compose.yml",
            "package.json",
            "package-lock.json",
            "frontend/package.json",
            "deployment/bootstrap-finance-adb.sh",
        }
        missing = sorted(required.difference(names))
        if missing:
            raise ValueError(
                "Application payload is missing required root member(s): "
                + ", ".join(missing)
            )
        if any(name.startswith("application/") for name in names):
            raise ValueError(
                "Application payload must be rootless; found application/ prefix"
            )
        scan_archive_text(archive, names, "application payload")

        return sha256_file(payload_path), sum(
            not name.endswith("/") for name in names
        )


def load_build_contract(source_root: Path):
    scripts_dir = source_root / "scripts"
    sys.path.insert(0, str(scripts_dir))
    try:
        import build_resource_manager_package as build_contract
        import create_clean_zip as clean_zip
    finally:
        sys.path.pop(0)
    return build_contract, clean_zip


def expected_entries(
    source: Path,
    output: Path,
    excludes: tuple[str, ...],
    clean_zip,
) -> tuple[dict[str, Path], set[str]]:
    namespace = argparse.Namespace(
        contents_only=True,
        root_name=None,
        exclude=list(excludes),
        no_default_excludes=False,
        reproducible=True,
    )
    entries, skipped = clean_zip.collect_paths(source, output, namespace)
    if any(item.startswith("symlink ") for item in skipped):
        raise ValueError("Source parity encountered a skipped symlink")
    files = {name: path for path, name, is_dir in entries if not is_dir}
    all_names = {name for _, name, _ in entries}
    return files, all_names


def assert_source_parity(
    archive_path: Path,
    source: Path,
    output: Path,
    excludes: tuple[str, ...],
    clean_zip,
    label: str,
) -> None:
    expected_files, expected_names = expected_entries(
        source, output, excludes, clean_zip
    )
    with zipfile.ZipFile(archive_path) as archive:
        actual_names = set(archive.namelist())
        if actual_names != expected_names:
            missing = sorted(expected_names - actual_names)
            extra = sorted(actual_names - expected_names)
            raise ValueError(
                f"{label} source parity mismatch; missing={missing[:3]}, "
                f"extra={extra[:3]}"
            )
        for name, path in expected_files.items():
            actual_hash = sha256_bytes(archive.read(name))
            expected_hash = sha256_file(path)
            if actual_hash != expected_hash:
                raise ValueError(f"{label} content drift at {name}")


def validate_terraform_static_contract(source_root: Path) -> None:
    terraform_text = "\n".join(
        path.read_text(encoding="utf-8")
        for path in sorted(source_root.glob("*.tf"))
    )
    required_patterns = {
        "static payload path": r"payload/finance-application[.]zip",
        "plan-time payload hash": r"filesha256[(]local[.]application_payload_path[)]",
        "direct object source": r"source\s*=\s*local[.]application_payload_path",
        "hash-addressed object": r"local[.]application_payload_sha256",
        "digest-keyed payload resource": r"for_each\s*=\s*toset[(]\[local[.]application_payload_sha256\]\)",
        "immutable payload object path": r'object\s*=\s*"application/payloads/\$\{each[.]key\}[.]zip"',
        "digest-keyed payload reference": r"oci_objectstorage_object[.]application\[local[.]application_payload_sha256\][.]object",
        "gzip cloud-init": r"base64gzip[(]local[.]application_cloud_init[)]",
        "metadata budget": r"application_instance_metadata_budget_bytes\s*=\s*30000",
        "metadata precondition": r"application_metadata_size_bytes\s*<=\s*local[.]application_instance_metadata_budget_bytes",
        "Compute delivery trigger": r'filesha256[(]"\$\{path[.]module\}/compute-app[.]tf"[)]',
        "Object Storage delivery trigger": r'filesha256[(]"\$\{path[.]module\}/object-storage[.]tf"[)]',
        "identity-domain input": r'variable\s+"identity_domain_ocid"',
        "validated OCI provider": r'version\s*=\s*"=\s*8[.]25[.]0"',
        "validated Random provider": r'version\s*=\s*"=\s*3[.]9[.]0"',
        "identity-domain lookup": r'data\s+"oci_identity_domain"\s+"selected"',
        "self-service key inventory": r'data\s+"oci_identity_domains_my_api_keys"\s+"current"',
        "self-service API-key resource": r'resource\s+"oci_identity_domains_my_api_key"\s+"select_ai"',
        "Identity Domains API-key schema": r"urn:ietf:params:scim:schemas:oracle:idcs:apikey",
        "API-key capacity guard": r"total_results\s*<\s*3",
        "Plan-known key owner token": r"selectai_api_key_owner_token\s*=\s*substr[(]sha256[(]jsonencode",
        "current-user binding": r"self[.]user\[0\][.]ocid\s*==\s*var[.]current_user_ocid",
        "identity-domain binding": r"self[.]domain_ocid\s*==\s*var[.]identity_domain_ocid",
    }
    for label, pattern in required_patterns.items():
        if not re.search(pattern, terraform_text):
            raise ValueError(f"Terraform is missing {label}")
    if re.search(r"\b(?:data|resource)\s+\"archive_file\"", terraform_text):
        raise ValueError("Terraform still creates the application ZIP at job time")
    if "hashicorp/archive" in terraform_text:
        raise ValueError("Terraform still declares the archive provider")
    if re.search(r"base64encode\s*[(]\s*templatefile\s*[(]", terraform_text):
        raise ValueError("Terraform still ships plain-Base64 cloud-init")
    if re.search(r'resource\s+"oci_identity_api_key"', terraform_text):
        raise ValueError("Terraform still uses the legacy IAM API-key resource")
    if re.search(
        r"selectai_api_key_description\s*=.*random_id", terraform_text
    ):
        raise ValueError(
            "Terraform defers the API-key capacity decision past Plan"
        )


def validate_outer_archive(
    archive_path: Path, payload_path: Path
) -> tuple[str, int]:
    with zipfile.ZipFile(archive_path) as archive:
        names = assert_safe_infos(archive, "Resource Manager archive")
        forbidden = [name for name in names if is_forbidden_member(name)]
        if forbidden:
            raise ValueError(
                "Resource Manager archive contains forbidden artifact: "
                + forbidden[0]
            )
        required = {
            "main.tf",
            "schema.yaml",
            "payload/finance-application.zip",
            "verification/check-compute-metadata-budget.py",
        }
        missing = sorted(required.difference(names))
        if missing:
            raise ValueError(
                "Resource Manager archive is missing root contract member(s): "
                + ", ".join(missing)
            )
        if any(name.startswith("application/") for name in names):
            raise ValueError(
                "Resource Manager archive contains duplicate raw application source"
            )
        nested = [
            name
            for name in names
            if not name.endswith("/") and name.casefold().endswith(".zip")
        ]
        if nested != ["payload/finance-application.zip"]:
            raise ValueError(
                "Resource Manager archive must contain exactly one approved "
                f"nested ZIP; found {nested}"
            )
        embedded_hash = sha256_bytes(
            archive.read("payload/finance-application.zip")
        )
        if embedded_hash != sha256_file(payload_path):
            raise ValueError(
                "Embedded application payload differs from the verified source payload"
            )
        scan_archive_text(archive, names, "Resource Manager archive")
        return sha256_file(archive_path), sum(
            not name.endswith("/") for name in names
        )


def main() -> int:
    args = parse_args()
    source_root = args.source_root.expanduser().resolve()
    payload_path = source_root / "payload" / "finance-application.zip"

    validate_terraform_static_contract(source_root)
    payload_hash, payload_files = validate_payload(payload_path)

    application_root = source_root / "application"
    if application_root.is_dir():
        build_contract, clean_zip = load_build_contract(source_root)
        assert_source_parity(
            payload_path,
            application_root,
            payload_path,
            build_contract.PAYLOAD_EXCLUDES,
            clean_zip,
            "application payload",
        )
        print("PASS: application payload exactly matches clean source allowlist")
    else:
        print(
            "INFO: raw application source is intentionally absent; "
            "payload source-parity check skipped"
        )

    print(
        f"PASS: static application payload is clean "
        f"({payload_files} files, sha256={payload_hash})"
    )

    if args.archive:
        archive_path = args.archive.expanduser().resolve()
        archive_hash, archive_files = validate_outer_archive(
            archive_path, payload_path
        )
        if application_root.is_dir():
            build_contract, clean_zip = load_build_contract(source_root)
            assert_source_parity(
                archive_path,
                source_root,
                archive_path,
                build_contract.OUTER_EXCLUDES,
                clean_zip,
                "Resource Manager archive",
            )
            print(
                "PASS: Resource Manager archive exactly matches clean source allowlist"
            )
        print(
            f"PASS: Resource Manager archive is clean "
            f"({archive_files} files, sha256={archive_hash})"
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, zipfile.BadZipFile) as exc:
        print(f"package verification failed: {exc}", file=sys.stderr)
        raise SystemExit(2)
