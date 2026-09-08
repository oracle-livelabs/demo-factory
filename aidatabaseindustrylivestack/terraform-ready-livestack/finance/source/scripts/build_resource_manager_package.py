#!/usr/bin/env python3
"""Build the static application payload and clean OCI Resource Manager ZIP."""

from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


SOURCE_ROOT = Path(__file__).resolve().parents[1]
APPLICATION_ROOT = SOURCE_ROOT / "application"
PAYLOAD_PATH = SOURCE_ROOT / "payload" / "finance-application.zip"
DEFAULT_OUTPUT = SOURCE_ROOT / "dist" / "finance-livestack-resource-manager.zip"
CLEAN_ZIP_HELPER = SOURCE_ROOT / "scripts" / "create_clean_zip.py"
PACKAGE_VERIFIER = SOURCE_ROOT / "verification" / "check-resource-manager-package.py"
METADATA_VERIFIER = (
    SOURCE_ROOT / "verification" / "check-compute-metadata-budget.py"
)

PAYLOAD_EXCLUDES = (
    "node_modules",
    "node_modules/**",
    "frontend/node_modules",
    "frontend/node_modules/**",
    "frontend/dist",
    "frontend/dist/**",
    "frontend/public/jet",
    "frontend/public/jet/**",
    "coverage",
    "coverage/**",
    ".env",
    "*/.env",
    "*.log",
    "*.pem",
    "*.key",
)

OUTER_EXCLUDES = (
    ".terraform",
    ".terraform/**",
    ".terraform.lock.hcl",
    "dist",
    "dist/**",
    # The deployment archive has one source of truth: the prebuilt payload.
    "application",
    "application/**",
    "node_modules",
    "node_modules/**",
    "__pycache__",
    "__pycache__/**",
    "coverage",
    "coverage/**",
    "*.tfstate",
    "*.tfstate.*",
    "*.tfplan",
    "*.tfvars",
    "*.tfvars.json",
    "*.auto.tfvars",
    "*.auto.tfvars.json",
    "*.generated.zip",
    "*wallet*.zip",
    "*wallet*.b64",
    "*.p12",
    "*.pfx",
    "*.jks",
    "cwallet.sso",
    "*.pem",
    "*.key",
    ".env",
    "*/.env",
    "*.log",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Build a reproducible application payload and a rootless, clean "
            "OCI Resource Manager configuration ZIP."
        )
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Outer Resource Manager ZIP (default: {DEFAULT_OUTPUT})",
    )
    return parser.parse_args()


def reject_symlinks() -> None:
    for path in sorted(SOURCE_ROOT.rglob("*")):
        relative = path.relative_to(SOURCE_ROOT)
        if (
            relative.parts
            and (
                relative.parts[0] in {".terraform", "dist"}
                or "node_modules" in relative.parts
            )
        ):
            continue
        if path.is_symlink():
            raise ValueError(
                f"Refusing to package a source tree containing a symbolic link: {relative}"
            )


def create_clean_zip(
    source: Path, output: Path, excludes: tuple[str, ...]
) -> None:
    command = [
        sys.executable,
        str(CLEAN_ZIP_HELPER),
        str(source),
        str(output),
        "--contents-only",
        "--reproducible",
    ]
    for pattern in excludes:
        command.extend(["--exclude", pattern])
    subprocess.run(command, check=True)


def verify_package(output: Path | None = None) -> None:
    command = [
        sys.executable,
        str(PACKAGE_VERIFIER),
        "--source-root",
        str(SOURCE_ROOT),
    ]
    if output is not None:
        command.extend(["--archive", str(output)])
    subprocess.run(command, check=True)


def verify_metadata_budget() -> None:
    subprocess.run([sys.executable, str(METADATA_VERIFIER)], check=True)


def main() -> int:
    args = parse_args()
    output = args.output.expanduser().resolve()

    reject_symlinks()

    if APPLICATION_ROOT.is_dir():
        PAYLOAD_PATH.parent.mkdir(parents=True, exist_ok=True)
        create_clean_zip(APPLICATION_ROOT, PAYLOAD_PATH, PAYLOAD_EXCLUDES)
    elif PAYLOAD_PATH.is_file():
        print(
            "INFO: raw application source is absent; reusing the verified "
            f"static payload at {PAYLOAD_PATH}"
        )
    else:
        raise ValueError(
            "Neither expanded application source nor a prebuilt static "
            f"payload is available: {APPLICATION_ROOT}"
        )
    verify_metadata_budget()
    verify_package()

    create_clean_zip(SOURCE_ROOT, output, OUTER_EXCLUDES)
    verify_package(output)

    print(f"Created and verified Resource Manager package: {output}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"package-resource-manager: error: {exc}", file=sys.stderr)
        raise SystemExit(2)
