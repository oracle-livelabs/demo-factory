# Take It Home (OCI): Deploy the LiveStack with OCI Resource Manager

## Introduction

The LiveStack can run locally with Podman, but the same demo can also run in your own OCI tenancy. In this lab, you use a **Deploy to Oracle Cloud** link to open an approved Terraform package directly in **OCI Resource Manager**, review the proposed infrastructure, deploy the application, and open it from the Resource Manager outputs.

The Terraform package creates the network, an Oracle Linux application VM, a private Object Storage delivery bucket, and an Oracle Autonomous AI Database 26ai instance. During first boot, the VM loads the application schema and synthetic demo data, configures native Select AI with OCI Generative AI, and starts the application on port **8505**.

This is an unauthenticated demonstration deployment. Restrict access to trusted IPv4 CIDRs and do not use sensitive production data.

Estimated time: **45-90 minutes**, including database provisioning and application bootstrap.

### Objectives

In this lab, you will:

- Open a Resource Manager stack from the approved Deploy to Oracle Cloud link.
- Configure the stack variables for your tenancy, network access, VM, database, and AI region.
- Review the configured variables before running Apply.
- Run Apply and wait for the application health check to pass.
- Open the application and verify the generated Resource Manager outputs.
- Destroy the stack when the demo is complete.

## Before you begin

Confirm that you have:

- An OCI tenancy and a compartment where you can create Resource Manager, Networking, Compute, Autonomous Database, Object Storage, and related resources.
- Permission to call OCI Generative AI in the compartment selected for the stack.
- Use the same OCI user for Resource Manager **Plan**, **Apply**, and **Destroy**. The stack uses that user’s identity domain for its temporary API-key registration.
- An SSH public key for the `opc` user on the application VM.
- A trusted public IPv4 address or CIDR for SSH and application access. To find it, open a command-line window on the computer that will access the application: use **Terminal** on macOS or Linux, or **Command Prompt** or **PowerShell** on Windows. For a normal Internet connection, run the following command and use the returned address with `/32`.

    ```bash
    <copy>
    curl -4 https://api.ipify.org
    </copy>
    ```

- Sufficient tenancy quota and budget for an Autonomous AI Database 26ai instance, an application VM, networking, and Object Storage.

> **Important:** Resource Manager **Apply** creates OCI resources that may incur charges. Keep `app_ingress_cidr` limited to trusted users. Run **Destroy** when the demonstration is complete.

## Architecture

The diagram below shows the main deployment and runtime paths.

![Powtoon-style generic LiveStack architecture showing OCI Resource Manager, networking, an application VM, Autonomous AI Database, Object Storage, and OCI Generative AI](images/livestack-architecture.png)

## Task 1: Open the Resource Manager deployment link

> **Release note:** The Deploy to Oracle Cloud link below references the approved Resource Manager package for this lab. Each lab variant must use its own release-owner-approved package URL. Keep the package URL stable and accessible to OCI Resource Manager.

1. Sign in to the OCI Console, if prompted.

2. Select the following link to open the stack-creation page with the Media Terraform package already selected:

    [Deploy the Media LiveStack with OCI Resource Manager](https://cloud.oracle.com/resourcemanager/stacks/create?zipUrl=https://objectstorage.us-ashburn-1.oraclecloud.com/p/hwWT9dWzinxObIDAvT4qS39oFWvupUxaiVMRqdAez9208TkMnWZEkKX58taDzEMg/n/c4u04/b/Deploy-OCI-Resource-Manager/o/media-livestack-terraform.zip)

3. On the **Create stack** page, confirm that the **Package URL** identifies `media-livestack-terraform.zip`. No local download or ZIP upload is required.

4. Review and accept the Oracle Terms of Use.

5. Select the compartment that will contain the stack resources. The OCI region is selected later in the **Configure variables** step.

6. In the **Name** field, enter a recognizable stack name.

7. Select **Next** to open the **Configure variables** step.

Expected result:

- The **Create stack** page shows the package URL and does not require you to download or upload a ZIP file.
- Resource Manager accepts the Terraform configuration and opens the variable form generated from `schema.yaml`.

## Task 2: Configure the stack variables

1. Configure the variables in the stack creation form.

    ![OCI Resource Manager stack variables grouped into location and access, compute sizing, and database and AI](images/resource-manager-variables.png)

Use the following guidance. Keep the shipped defaults unless your tenancy requires a different value.

| Variable | Guidance |
| --- | --- |
| **Region** | Region where Resource Manager creates the VCN, VM, database, and Object Storage resources. |
| **Compartment** | Compartment approved for this demonstration and OCI Generative AI access. |
| **Operator identity domain** | Select the identity domain containing the OCI user who runs Plan, Apply, and Destroy. Do not select a domain that does not contain that user. |
| **Availability domain** | Select an availability domain in the chosen stack region with VM capacity. |
| **Resource name prefix** | Use a unique value beginning with a letter and containing 3-30 letters, numbers, or hyphens, such as `demo-livestack`. |
| **SSH public key** | Paste the OpenSSH public key for the `opc` user. Do not paste the private key. |
| **SSH source CIDR** | Use the trusted public IPv4 address that will be used for SSH, followed by `/32`. The package accepts only IPv4 `/24` through `/32`. |
| **Application source CIDR** | Use the trusted public IPv4 address that will open the demo, followed by `/32`. It can match the SSH CIDR when the same computer is used. |
| **Bootstrap repair generation** | Leave this at `1` for the first deployment. Increment it only when intentionally rebuilding a one-shot VM after a failed repair or expired bootstrap callbacks. |
| **Application VM shape** | Keep `VM.Standard.E4.Flex` unless the tenancy requires another supported flexible shape. |
| **VM OCPUs / memory** | The shipped defaults are `2` OCPUs and `16` GB of memory. Increase them only when the selected shape or workload requires it. |
| **Autonomous Database license model** | Select the license model available in the tenancy. The default is `LICENSE_INCLUDED`. |
| **Autonomous Database ECPUs / storage** | The shipped defaults are `2` ECPUs and `1` TB. Confirm that the tenancy has capacity for the selected values. |
| **ADMIN password** | Leave blank to let Terraform generate a compliant password, or enter a 12-30 character value with uppercase, lowercase, and a number. Do not use spaces, quotes, or the word `admin`. |
| **ADB embedding model URI** | Leave the prefilled approved HTTPS value unchanged unless the release owner provides an approved replacement. Treat it as sensitive. |
| **OCI Generative AI region** | Select a supported region for the fixed on-demand `cohere.command-a-03-2025` model. The default is `us-chicago-1`; the database region can be different. |
| **OCI Generative AI model** | Leave `cohere.command-a-03-2025` selected. |

The hidden `tenancy_ocid` and `current_user_ocid` values are populated by Resource Manager. Do not try to replace them with another tenancy or user.

2. Select **Next** to open the **Review** page.

    ![OCI Resource Manager Review page with the Run apply checkbox highlighted in red](images/resource-manager-review.png)

3. Review the stack information and variable values.

4. Confirm that **Run apply** is selected. This tells Resource Manager to begin provisioning immediately after the stack is created.

5. Select **Create**.

Expected result:

- The form shows the groups **Location and access**, **Compute sizing**, and **Database and AI**.
- Required fields are populated, the two source CIDRs are restricted, and the model URI remains prefilled.
- Resource Manager creates the stack and starts the Apply job.
- The new stack opens with a job that provisions the LiveStack resources.

## Task 3: Monitor the Apply job

1. Open the Apply job created when you selected **Create**.

    ![OCI Resource Manager Apply job with the state shown as In Progress](images/resource-manager-apply.png)

2. Confirm that the job state is **In Progress**. Keep this page open while Resource Manager provisions the stack. The Apply job usually takes **20-45 minutes**. Initial VM setup can take up to **90 minutes**.

3. Select the **Logs** tab to monitor the build.

    ![OCI Resource Manager Apply job Logs tab showing Terraform provider and build activity](images/resource-manager-apply-logs.png)

4. Review the log entries as they appear. They show Terraform provider initialization and each resource operation that Apply performs.

5. Wait for the application VM to finish its bootstrap sequence. The VM installs Podman and SQLcl, downloads the application and wallet, loads the application schema and synthetic data, configures native Select AI, runs native acceptance checks, and starts the application.

6. Treat Apply as complete only when the job status is **Succeeded**. A running VM or a partially completed resource graph does not prove that the application is ready.

Expected result:

- While provisioning is underway, the Apply job shows **In Progress** and the **Logs** tab shows build activity.
- The Apply job eventually succeeds.
- The stack outputs include the application URL, health URL, database details, and bootstrap troubleshooting commands.

## Task 4: Open the outputs and verify the application

1. On the stack details page, open the **Outputs** section.

    ![OCI Resource Manager stack outputs with the application_url output highlighted in red](images/resource-manager-outputs.png)

2. Open the `application_health_url` output. Confirm that it returns HTTP 200 and reports database connectivity and native-AI readiness.

3. Open the `application_url` output highlighted in the screenshot to access the deployed application. If the browser cannot connect, confirm that the client’s public IPv4 address is allowed by `app_ingress_cidr`.

4. Open the deployed application and complete the validation steps defined for the application. Confirm that it can read the seeded data.

5. If the application includes an AI assistant or agent, run its read-only validation. Confirm that it uses the deployed database and configured AI service.

Expected result:

- The health endpoint returns HTTP 200.
- The application opens on port `8505` and shows the deployed workflow.
- The application’s validation uses the deployed database and native OCI Generative AI configuration.

## Task 5: Investigate a failed bootstrap when needed

If Apply fails after the VM has been created, use the Resource Manager outputs before deciding whether to repair or destroy the stack.

1. Open a command-line window with SSH available: use **Terminal** on macOS or Linux, or **PowerShell** or **Command Prompt** on Windows. Copy the `first_boot_status_command` output and run it to check the VM bootstrap status.

2. If more detail is needed, copy and run the `bootstrap_log_command` output.

3. Review the recorded bootstrap phase and the last error. Common causes include database capacity, OCI Generative AI authorization, an unavailable VM shape, a blocked egress path, or an incorrect source CIDR.

4. For an incomplete initial deployment, inspect a fresh Plan before applying again. If the stack has unexpected retained resources or an uncertain state, run Destroy and create a clean deployment after the Destroy job succeeds.

Expected result:

- You identify the failure using the Resource Manager output and VM bootstrap log rather than host reachability alone.

## Task 6: Destroy the stack

1. After you finish the demonstration, return to the stack details page and select **Destroy**.

    ![OCI Resource Manager stack details with the Destroy action highlighted in red](images/resource-manager-destroy.png)

2. Confirm the Destroy operation and wait for the job to become **Succeeded**.

3. Review the job log and resource list. Confirm that the API key, application VM, Autonomous Database, VCN, callback objects, and private delivery bucket are removed.

4. If you need the demo again later, use the deployment link again and run Plan before Apply.

Expected result:

- Destroy completes successfully and the stack no longer retains the billable demo resources.

## Acknowledgements

- **Author** - Oracle LiveLabs Team.
- **Last Updated By/Date** - Oracle LiveLabs Team, September 2026.
