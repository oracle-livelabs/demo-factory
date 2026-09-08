# Take It Home (OCI): Deploy PeakGear with OCI Resource Manager

## Introduction

Deploy the complete PeakGear AI Lakehouse in your own OCI tenancy with one **Deploy to Oracle Cloud** button. The approved Resource Manager package creates the network, an Oracle Linux application VM, Autonomous AI Database 26ai, private Object Storage, Gravitino, GoldenGate, GoldenGate Stream Analytics, and the PeakGear application.

PeakGear is larger than the other industry LiveStacks. Resource Manager waits for the database load and the declared application services before Apply succeeds. Allow up to **three hours** for a new deployment.

Ready to deploy? Select **Deploy to Oracle Cloud** below. For detailed deployment instructions, check the tasks below.

<a href="https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/oracle-livelabs/livestack/raw/refs/heads/main/aidatabaseindustrylivestack/terraform-ready-livestack/peakgear-ai-lakehouse/peakgear-ai-lakehouse-resource-manager.zip" target="_blank" rel="noopener" style="display: inline-flex; box-sizing: border-box; width: 207px; height: 34px; align-items: center; padding: 0 12px; background: #312d2a; border: 0; border-radius: 2px; color: #ffffff; font-family: Arial, sans-serif; font-size: 14px; font-weight: 400; line-height: 20px; text-decoration: none;"><span aria-hidden="true" style="box-sizing: border-box; display: inline-block; width: 20px; height: 13px; margin-right: 8px; border: 3px solid #e64a2e; border-radius: 999px;"></span><span>Deploy to Oracle Cloud</span></a>

> **Important:** This stack creates paid OCI resources. Restrict access to trusted IPv4 CIDRs and run Destroy when the demonstration is complete.

Estimated Time: **up to 3 hours**, including database provisioning, software downloads, data loading, container builds, and service validation.

### Objectives

In this lab, you will:

- Open the approved PeakGear package in OCI Resource Manager.
- Provide the network access and runtime credentials required by PeakGear.
- Run Apply and wait for the complete service validation.
- Open PeakGear and verify its database and lakehouse services.
- Destroy the stack when the demonstration is complete.

## Before you begin

Confirm that you have:

- An OCI compartment where you can create Networking, Compute, Autonomous Database, Object Storage, and related resources.
- Permission to use OCI Generative AI in the selected compartment.
- Capacity for the default PeakGear VM: **8 OCPUs**, **64 GB memory**, and a **300 GB** boot volume.
- Capacity and budget for a paid Autonomous AI Database with **2 ECPUs** and **1 TB** storage.
- An OpenSSH public key for the `opc` user.
- Your Oracle Container Registry username and Auth Token. Accept the terms for the required database and GoldenGate images at [Oracle Container Registry](https://container-registry.oracle.com/) before deployment.
- An existing OCI API key on the signed-in user. You need its fingerprint and the matching PEM private key encoded as one Base64 line.
- An existing OCI Customer Secret Key on the signed-in user. You need its access key and secret key for Gravitino's S3-compatible Object Storage connection.
- Your trusted public IPv4 address. Run the following command from the computer or VPN that will access the deployment, then append `/32`.

    ```bash
    <copy>
    curl -4 https://api.ipify.org
    </copy>
    ```

To encode the API private key as one line, use the command for your operating system.

Windows PowerShell:

```powershell
<copy>
[Convert]::ToBase64String([IO.File]::ReadAllBytes("$HOME\.oci\oci_api_key.pem"))
</copy>
```

macOS or Linux:

```bash
<copy>
base64 < ~/.oci/oci_api_key.pem | tr -d '\n'
</copy>
```

Treat the registry token, API private key, Customer Secret Key, generated database password, and Resource Manager state as sensitive.

## Task 1: Open the Resource Manager deployment

1. Sign in to the OCI Console, if prompted.

2. Select the button below.

    <a href="https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://github.com/oracle-livelabs/livestack/raw/refs/heads/main/aidatabaseindustrylivestack/terraform-ready-livestack/peakgear-ai-lakehouse/peakgear-ai-lakehouse-resource-manager.zip" target="_blank" rel="noopener" style="display: inline-flex; box-sizing: border-box; width: 207px; height: 34px; align-items: center; padding: 0 12px; background: #312d2a; border: 0; border-radius: 2px; color: #ffffff; font-family: Arial, sans-serif; font-size: 14px; font-weight: 400; line-height: 20px; text-decoration: none;"><span aria-hidden="true" style="box-sizing: border-box; display: inline-block; width: 20px; height: 13px; margin-right: 8px; border: 3px solid #e64a2e; border-radius: 999px;"></span><span>Deploy to Oracle Cloud</span></a>

3. On the **Create stack** page, confirm that the package URL identifies `peakgear-ai-lakehouse-resource-manager.zip`.

4. Review and accept the Oracle Terms of Use.

5. Select the compartment that will contain the stack, enter a recognizable stack name, and select **Next**.

Expected result:

- Resource Manager accepts the package and opens the variable form generated from `schema.yaml`.

## Task 2: Configure the PeakGear stack

1. Complete the **Location and access** fields.

    | Variable | Guidance |
    | --- | --- |
    | **Region** | Region where the PeakGear resources will be created. |
    | **Compartment** | Compartment approved for the deployment and OCI Generative AI access. |
    | **Availability domain** | Availability domain with capacity for the selected VM shape. |
    | **Resource name prefix** | Keep the default or use a unique 3-30 character value beginning with a letter. |
    | **SSH public key** | Paste the public key only. Never paste the private key. |
    | **SSH source CIDR** | Use a trusted IPv4 CIDR such as your public address followed by `/32`. `0.0.0.0/0` is rejected. |
    | **PeakGear application source CIDR** | Use the trusted CIDR that will open PeakGear on port `8505`. |
    | **Administration tools source CIDR** | Use a trusted CIDR to expose Gravitino, GoldenGate, and GGSA, or leave it blank to keep those ports private. |

2. Complete the **Required runtime credentials** fields.

    | Variable | Guidance |
    | --- | --- |
    | **Oracle Container Registry username** | Oracle account email used for Container Registry. |
    | **Oracle Container Registry Auth Token** | Auth Token generated for that account, not its SSO password. |
    | **OCI API private key, Base64 encoded** | Single-line Base64 value created from the PEM private key. |
    | **OCI API key fingerprint** | Fingerprint of the API key matching that private key. |
    | **Object Storage access key** | Access key from an OCI Customer Secret Key on the signed-in user. |
    | **Object Storage secret key** | Secret displayed when that Customer Secret Key was created. |

3. Keep **Show advanced options** off unless your tenancy requires different capacity or licensing. The reviewed defaults are:

    - `VM.Standard.E5.Flex`, 8 OCPUs, 64 GB memory, and a 300 GB boot volume.
    - Autonomous Database with 2 ECPUs, 1 TB storage, and `LICENSE_INCLUDED`.
    - OCI Generative AI in `us-chicago-1`.

4. Select **Next**, review the values, select **Run apply**, and select **Create**.

Expected result:

- Resource Manager creates the stack and starts an Apply job without requiring a local ZIP upload.

## Task 3: Monitor the Apply job

1. Open the Apply job and select **Logs**.

2. Wait while Terraform creates the VCN, Autonomous Database, private Object Storage bucket, and application VM.

3. Continue waiting while the VM downloads the approved PeakGear, Gravitino, and GGSA artifacts; loads ADB; builds the Podman services; and runs its health checks.

4. Treat deployment as complete only when Apply reports **Succeeded**. A running VM alone does not mean PeakGear is ready.

Expected result:

- Apply succeeds after the bootstrap reaches `RESOURCE_MANAGER_DEPLOYMENT_OK`.
- The stack exposes the application URL and diagnostic commands as outputs.

## Task 4: Verify PeakGear

1. Open the Resource Manager stack **Outputs**.

2. Open `application_health_url`. Confirm that it responds successfully.

3. Open `application_url`. Confirm that PeakGear loads and can read its seeded database data.

4. When administration tools were exposed to your trusted CIDR, verify the `gravitino_url`, `goldengate_studio_url`, and `ggsa_url` outputs.

5. Confirm that the output `first_boot_note` states that Apply waited for the ADB data load and required service checks.

Expected result:

- PeakGear opens on port `8505`.
- Its health endpoint, Autonomous Database connection, Gravitino, GoldenGate, and GGSA checks passed before Apply completed.

## Task 5: Investigate a failed bootstrap

If Apply fails after creating the VM, use the stack outputs to identify the failed phase.

1. Run `first_boot_status_command` to show cloud-init and the recorded deployment state.

2. Run `bootstrap_log_command` and `installer_log_command` for bootstrap and installer details.

3. Run `database_bootstrap_diagnostics_command` when the ADB wallet or schema load failed.

4. Correct the credential, capacity, network, or artifact issue shown in the logs. If the state is uncertain, destroy the stack and start a clean deployment.

Expected result:

- The output commands identify the failing bootstrap phase without exposing credentials in the command text.

## Task 6: Destroy the stack

1. Return to the Resource Manager stack and select **Destroy**.

2. Confirm the operation and wait for the Destroy job to report **Succeeded**.

3. Confirm that the VM, Autonomous Database, VCN, and private Object Storage bucket were removed.

The stack does not delete or modify the OCI API key, Container Registry Auth Token, or Customer Secret Key that you supplied.

## Acknowledgements

- **Author** - Oracle LiveLabs Team.
- **Last Updated By/Date** - Oracle LiveLabs Team, September 2026.
