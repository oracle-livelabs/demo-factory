# Deploying PeakGear Lakehouse in Your OCI Tenancy

This guide installs the PeakGear Lakehouse stack on a fresh Oracle Linux 9
Compute VM in your own OCI tenancy. It uses the standalone `.env` fallback;
OCI instance metadata is not required.

## Prerequisites

- Oracle Linux 9 Compute VM with a public IP address.
- SSH access as `opc` and `sudo` access.
- An Autonomous Database wallet ZIP and its matching ADB administrator
  password.
- A read-only HTTPS URL for the GoldenGate OSA archive.
- Outbound access to the globally accessible ADW-enabled Gravitino Iceberg REST
  server archive supplied in `.env.example`.
- OCI Object Storage S3-compatible customer-secret keys for the Iceberg
  warehouse bucket.
- An Oracle Container Registry authentication token. The installer prompts for
  this during installation.
- Outbound internet access from the VM for packages, container images, OCI Object
  Storage, Autonomous Database, and OCI Generative AI.

The installer discovers the public IP automatically. Do not set a public-host
variable in `.env`.

## OCI VCN security rules

Create ingress rules in the VM subnet security list or network security group.
Use your corporate or VPN CIDR instead of `0.0.0.0/0` wherever possible.

### Required public ingress

| Protocol | Port | Source | Purpose |
| --- | ---: | --- | --- |
| TCP | 22 | Administrator IP/CIDR | SSH administration and file copy |
| TCP | 8505 | Workshop-user IP/CIDR | PeakGear web application |
| TCP | 8085 | Workshop-user IP/CIDR | Oracle Stream Analytics (OSA) UI |
| TCP | 8501 | Workshop-user IP/CIDR | GoldenGate Studio / CDC UI |

### Optional public ingress

Open these only for a specific external integration or administrator use. They
are not required for normal PeakGear web-app usage.

| Protocol | Port(s) | Purpose |
| --- | --- | --- |
| TCP | 8502 | GoldenGate runtime API |
| TCP | 1525 | Gravitino Iceberg REST API for Data Transforms |
| TCP | 9092 | Kafka clients outside the VM |
| TCP | 7077, 6066, 4040-4050, 28080-28083 | Spark submission and Spark UIs |
| TCP | 19080 | Non-TLS OSA endpoint; prefer 8085 instead |
| TCP | 1521, 1522, 8181, 11434, 3306 | Local databases, ORDS, Ollama, and OSA MySQL; keep private |
| TCP | 8503, 8504 | Loyalty MySQL and PostgreSQL sources; keep private until the federation phase |
| TCP | 27017 | Optional MongoDB catalog source in images built with `AIHUB=true`; keep private until the federation phase |



## 1. Create the VM

Create a new Oracle Linux 9 VM (min 4 OCPUs and 44 GB RAM) in the VCN/NSG configured above. Allocate
enough boot-volume capacity (min. 250GB) for container images and runtime data; the
installer expands the available boot filesystem.

## 2. Prepare `.env`

For a permanent deployment in your own tenancy, use the host-local `.env` below.
Terraform, OCI Marketplace, and LiveLabs deployments may instead provide these
values through OCI metadata.

On your workstation, copy `.env.example` to `.env` and complete its values.

The OCI API-key values are required for the complete OCI Generative AI
deployment. The current automatic profile setup supports `oci_auth_typelocal=api_key`.
The wallet ZIP referenced by `adbwallet` must have been generated with
`DBPASSWORD`; there is no separate wallet-password setting.
The installer verifies the generated `SERVICE_NAME` alias when one can be
derived and always verifies the wallet password. A failed required check leaves
the runtime wallet directory empty.
When `dbnamelocal` is set, Gravitino uses the same generated ADB service alias as
the rest of the compose stack. `GRAVITINO_JDBC_SERVICE_NAME` is only used when no
provisioned database name is available, which prevents a custom-image build
value from leaking into newly provisioned VMs. Its JDBC password is always
generated from the current VM's `DBPASSWORD` for the same reason. The Iceberg
warehouse is likewise generated from the provisioned Object Storage bucket and
`GRAVITINO_OBJECT_STORAGE_PREFIX`.

For unattended installation, `adbwallet` may instead be a read-only HTTPS PAR
URL. A local path is useful when the wallet ZIP has already been staged on the
VM.

The generic installer does not execute LiveLabs bootstrap code. Leave
`ENABLE_LIVELABS_FIRSTBOOT=false` for own-tenancy deployments. A LiveLabs build
must explicitly set it to `true` and supply a trusted `LIVELABS_FIRSTBOOT_URL`.

### Network and operations

At the OCI VCN/NSG layer, restrict the sources in the ingress tables above and
open optional ports only for their stated integration. The current host firewall
opens additional stack ports, so the VCN/NSG must keep database, ORDS, MongoDB,
Kafka, Spark, and internal GoldenGate ports private. Plan backup and recovery
for ADB, Object Storage, and the VM boot volume before using the deployment for
persistent workloads.

## 3. Copy the installation files

Copy the installer, your private `.env`, and the wallet to the `opc` home
directory. The wallet filename must match the absolute path in `adbwallet` environment variable. If you reference your wallet in the .env via PAR URL, you do not need to load the wallet to the server.

Example: 
```bash
scp inst.sh .env Wallet_lakehousepg.zip opc@<VM_PUBLIC_IP>:/home/opc/
```


## 4. Run the installer

```bash
ssh opc@<VM_PUBLIC_IP>
cd /home/opc
./inst.sh
```

The installer shows a percentage progress bar and writes detailed output to
`/home/opc/inst.log`. If both `CON_USER` and `CON_TOK` are configured, it logs
in to `container-registry.oracle.com` non-interactively using
`--password-stdin`. Otherwise it stops and waits for your Oracle email address
and auth token at the normal Podman login prompt.

It enables user-level systemd services with login lingering, so the stack
persists after a reboot.

## 5. Monitor the deployment

The installer completes before every container is ready. Monitor until the
main application is healthy:

Some commands you can use
```bash
systemctl --user status user-podman.service
systemctl --user status pg-iceberg-connection.service
podman ps
curl -fsS http://127.0.0.1:8505/api/health
```

For detail:

```bash
tail -f /home/opc/inst.log
podman logs -f ingestion_app_1
```

## 6. Smoke test

1. Open `http://<VM_PUBLIC_IP>:8505` and verify that the PeakGear web app
   loads.
2. Verify the application API:

   ```bash
   curl -fsS http://127.0.0.1:8505/api/health
   ```

3. Verify ADB connectivity and Lakehouse bootstrap:

   ```bash
   curl -fsS http://127.0.0.1:8505/api/lakehouse/auto
   ```

   The response must contain `"ok":true` and `"connected":true`.

4. Open `https://<VM_PUBLIC_IP>:8085/osa/index.html`. Accept the self-signed
   certificate warning if prompted and verify that OSA loads.
5. Open `https://<VM_PUBLIC_IP>:8501` and verify that GoldenGate Studio loads.
6. Verify the Gravitino Iceberg REST endpoint:

   ```bash
   curl -fsS http://127.0.0.1:1525/iceberg/v1/config
   ```

7. Verify the Data Transforms connection bootstrap:

   ```bash
   systemctl --user status pg-iceberg-connection.service
   ```

   The service should report that the platform-created Oracle connection uses
   username and default schema `PG`, and that `pg-iceberg` was created or
   updated and verified through the Data Transforms agent. The Oracle
   connection password comes from `DBPASSWORD`; the Iceberg connection URL is
   `http://<VM_PUBLIC_IP>:1525/iceberg`.

8. In the web app, open the Lakehouse/DB Actions and webshop-agent experiences
   to confirm the ADB and GenAI-backed features are available.

## Troubleshooting

| Symptom                                | Check                                                                                                       |
| ----------------------------------------| -------------------------------------------------------------------------------------------------------------|
| Installer stops before download        | Confirm `BUILD_ARCHIVE_URL` and `GGSA_OSA_ARCHIVE_URL` are present in `/home/opc/.env` or their OCI metadata keys. |
| Wallet or ADB connection fails         | Confirm the ZIP is readable, `adbwallet` matches its exact path, and the ZIP was created with `DBPASSWORD`. |
| Browser cannot reach the app           | Confirm TCP 8505 is allowed in both the OCI VCN and VM firewall.                                            |
| OSA or GoldenGate UI cannot be reached | Confirm TCP 8085 or 8501 is allowed in both the OCI VCN and VM firewall.                                    |
| Gravitino is unhealthy                 | Confirm the ADW-enabled ZIP was downloaded into `/home/opc/ingestion/gravitino/dist`, the wallet has the configured service alias, and the S3 customer-secret key can access the warehouse bucket. |
| Data Transforms Oracle connection rejects `PG` | Check `journalctl --user -u pg-iceberg-connection.service`; confirm `adb-load.service` created `PG` with the current `DBPASSWORD`. |
| `pg-iceberg` is missing in Data Transforms | Check `systemctl --user status pg-iceberg-connection.service`; confirm Data Transforms login works with the ADB admin password and TCP 1525 is allowed in OCI ingress. |
| Containers are still starting          | Check `podman ps`, `/home/opc/inst.log`, and `podman logs ingestion_app_1`.                                 |

Restart the stack after a configuration correction:

```bash
systemctl --user restart user-podman.service
```
