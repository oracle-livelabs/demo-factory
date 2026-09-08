# LAKEHOUSE IMAGE BUILD

> **Experimental — use at your own risk.** This deployment is provided for
> experimentation and demonstration only. It is not a supported product or
> production reference architecture. You are responsible for validating the
> configuration, security, costs, data handling, and operational impact in your
> own environment. No support is provided.

COPY THIS THE WHOLE FOLDER and start building a new image
This is as example of a base image that can be used to build a new image.
DO NOT CHANGE

## Project Overview

**Purpose:** Automate setup and deployment of a fully functional LiveLabs workshop base image used for Demo Factory

For the complete base-image build and cleanup procedure, see
[`CREATE_BASE_IMAGE.MD`](CREATE_BASE_IMAGE.MD).

**Technology Stack:**
- Container Runtime: Podman/Podman Compose
- Base OS: Oracle Linux 9
- Ingestion directory
---

## Directory Structure

```
df-base-image/
├── .env.example                # Secret-free standalone configuration template
├── inst.sh                    # Entry point: VM setup script. Copy to compute instance
├── build_dev.zip              # Packaged build artifacts. Rebuild after configuration changes; inst.sh downloads it from Object Storage
├── README.md                  # User documentation
│
├── ingestion/             # Container orchestration. user can place their whole compose stack in this directory. This includes at a minumum a comppose.yml plus additional files required to create the container environment.
│   ├── compose.yml            # Main Podman Compose definition
│   ├── Dockerfile1             # Dockerfile for the container environment
│   ├── Dockerfile2             # Dockerfile for the container environment
│   ├── add-on_scripts/
│   │   └── entrypoint.sh      # Demo container startup script
│   ├── seeder.sql             # SQL seeder script
│   ├── dbsetup.sql            # SQL script to setup database
├── init/                      # Bootstrap scripts. Review setenv.sh and enable env variables required.
│   ├── setenv.sh              # Generate .env files
│   ├── variable.sh            # Resolve vars from OCI metadata
│   └── user-podman.service    # Systemd service for auto-start

```
---

## Bootstrap Workflow

Execution order when provisioning a new VM:

```
1. Copy .env.example          → /home/opc/.env and provide its values (standalone mode only)
2. inst.sh (manual)           → Install packages, configure firewall, setup Podman, download and unzip build_dev.zip
3. systemd starts bootstrap   → Triggers init scripts automatically
   ├── setenv.sh             → Generate environment configs (sources variable.sh)
   ├── user-podman.service   → Systemd service for auto-start

```

---

## Key Files Reference

### Entry Points
| File | Description |
|------|-------------|
| `inst.sh` | Run first on fresh OCI VM - installs all dependencies |

## RC Packaging Helpers

Use these helpers from this directory before building a release-candidate image:

1. `scripts/build-rc-zip.sh`
2. `scripts/verify-rc-zip.sh`

The build script recreates `build_dev.zip` with runtime state, local build output, dependency folders, bootstrap marker files, all `.env*` files, and all ADB wallet material excluded. It runs the structural archive verifier before uploading to the configured Object Storage pre-authenticated URL. Running the verify script directly also extracts the ZIP to a temporary directory, executes the wallet-hardening regressions, runs `npm ci --include=dev`, and builds the frontend.

Archive upload is enabled by default. Provide the write-capable PAR prefix as
`BUILD_ARCHIVE_UPLOAD_URL_PREFIX` in the ignored `.env.kev` file or the process
environment. An explicitly exported value takes precedence over `.env.kev`.
Set `UPLOAD_ARCHIVE=false` for a local-only build. Never commit the PAR URL to
this repository or store it in the custom image.



## Environment Variables

## Deployment configuration

### Terraform, OCI Marketplace, and LiveLabs

No host-local object storage values are required for metadata-driven deployment. `init/variable.sh` uses OCI instance metadata first and only falls back to `/home/opc/.env` when metadata is unavailable. Terraform should provide the Gravitino bucket, warehouse prefix, S3-compatible endpoint, region, OCI customer-secret key values, and the Gravitino server archive URL as `gravitino_*` metadata keys.

### Standalone `.env` fallback

Copy `.env.example` to `/home/opc/.env`, replace every required placeholder, and run `bash inst.sh`. The installer protects the file with owner-only permissions, downloads the application archive, and enables the user services with lingering so the deployment resumes after a reboot.

The standalone permanent-deployment configuration must provide `adbwallet`,
`BUILD_ARCHIVE_URL`, `GGSA_OSA_ARCHIVE_URL`, and
`GRAVITINO_ICEBERG_REST_SERVER_ARCHIVE_URL`. The example supplies the global
Gravitino distribution; provide your own read-only build and GoldenGate URLs.
A base-image build uses the same artifact inputs, but LiveLabs initialization is
now explicit rather than implicit.
The custom image fixes the AIHUB choice made in `/home/opc/.env` during
`inst.sh`; Terraform metadata does not override it. PostgreSQL, Loyalty MySQL,
Data Sources, and the AWS Glue catalog integration are always included.
Set `AIHUB=true` only to include the optional MongoDB catalog source. With the
default `false`, MongoDB is neither started nor returned by Data Sources.
When OCI metadata is unavailable, `adbwallet` may be either a read-only HTTPS
PAR URL (recommended for unattended installs) or an absolute path to a wallet ZIP
already copied to the server, such as `/home/opc/Wallet_lakehousepg.zip`. The
fallback wallet's `ewallet.p12` must use `DBPASSWORD`; when `SERVICE_NAME` or
`dbnamelocal` is available, the wallet must also contain that service alias.
Setup fails and removes extracted state when a required check fails.
Metadata-driven custom images never use this fallback, including during a
temporary metadata outage.
The Gravitino archive must be the ADW-enabled Iceberg REST server distribution that
includes `org.apache.iceberg.adw.ADWCatalog`; it is staged during base-image
creation and baked into the `localhost/gravitino-iceberg-rest:adw` container
image. Public service URLs continue to use the existing `ifconfig.me` discovery;
no public-host value is required.

Before capturing a custom image, stop the user services and run
`/home/opc/prepare-custom-image.sh`. The script removes the build and generated
environment files, OCI and generated TLS private keys, ADB wallet state, and
compose containers and sensitive runtime volumes. It retains the built images,
staged installers, cached Ollama model, and Node dependency volumes required for
an offline first boot. Cleanup aborts before deleting anything if those offline
artifacts are incomplete. See `terraform-readme.md` for the exact cleanup and
verification checklist.

### Standalone fallback variables

### OCI Credentials
- `pem_keylocal` - Private key content
- `user_ocidlocal` - OCI user OCID
- `tenancy_ocidlocal` - Tenancy OCID
- `compartment_ocidlocal` - Compartment OCID
- `adb_ocidlocal` - Autonomous Database OCID

### Database
- `dbconnectionlocal` - Full connection string
- `DBPASSWORD` - Database password
- `dbnamelocal` - Database name
- `SERVICE_NAME` - Oracle service name
- `ordsurllocal` - ORDS endpoint URL

### External Services
- `mongodbapilocal` - MongoDB API endpoint
- `graphurllocal` - Oracle Graph endpoint
- `ai_endpoint_regionlocal` - OCI AI service region
- `GGSA_OSA_ARCHIVE_URL` - GoldenGate OSA installer archive URL (required by `inst.sh`)
- `BUILD_ARCHIVE_URL` - Read-only `build_dev.zip` URL (required by `inst.sh` or OCI metadata)
- `CON_USER` / `CON_TOK` - Optional Oracle Container Registry email and auth token; set both for unattended login, otherwise `inst.sh` prompts interactively
- `GRAVITINO_ICEBERG_REST_SERVER_ARCHIVE_URL` - ADW-enabled Gravitino Iceberg REST server archive URL (required by `inst.sh`)
- `GRAVITINO_JDBC_USER` / `GRAVITINO_JDBC_PASSWORD` - ADB catalog user for Gravitino, defaults to `PG` with `DBPASSWORD`
- `GRAVITINO_OBJECT_STORAGE_BUCKET`, `GRAVITINO_S3_ENDPOINT`, `GRAVITINO_S3_REGION`, `GRAVITINO_S3_ACCESS_KEY_ID`, `GRAVITINO_S3_SECRET_ACCESS_KEY` - OCI Object Storage S3-compatible warehouse settings for Iceberg
- `DATA_TRANSFORMS_ADB_AUTO_CONFIGURE` / `DATA_TRANSFORMS_ADB_USERNAME` - Update the platform-created Data Transforms Oracle connection to use `PG`; the password defaults to `DBPASSWORD` and can be overridden with `DATA_TRANSFORMS_PASSWORD`
- `DATA_TRANSFORMS_ADB_CONNECTION_NAME` - Optional override for the platform-created Oracle connection name; defaults to `DBNAME` and is also validated against the provisioned wallet JDBC alias
- `DATA_TRANSFORMS_ICEBERG_CONNECTION_NAME` - Data Transforms Apache Iceberg connection name, defaults to `pg-iceberg`
- `DATA_TRANSFORMS_BASE_URL` / `DATA_TRANSFORMS_ICEBERG_REST_URL` - Optional overrides when the Data Transforms base URL or public Gravitino REST URL cannot be derived
- `baseurllocal` - Oracle Database Actions base URL fallback used when Data Transforms URL derivation needs help
- `ENABLE_LIVELABS_FIRSTBOOT` / `LIVELABS_FIRSTBOOT_URL` - Disabled-by-default LiveLabs-only bootstrap; generic own-tenancy installs must leave it disabled
- `adbwallet` - Read-only HTTPS ADB wallet ZIP PAR URL, or an absolute path to a readable ZIP staged on the server (required when metadata is unavailable)

---


## Managing Services
```bash
# Check status
systemctl --user status user-podman
systemctl --user status pg-iceberg-connection.service

# Restart containers
systemctl --user restart user-podman

# Stop service
systemctl --user restart user-podman

# View logs
podman-compose -f /home/opc/ingestion/compose.yml logs -f
```

---
