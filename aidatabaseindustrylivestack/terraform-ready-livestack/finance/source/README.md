# Finance LiveStack: Native Select AI on OCI

This rootless Terraform bundle deploys the Finance LiveStack through OCI
Resource Manager. The application uses Oracle Autonomous AI Database 26ai
`DBMS_CLOUD_AI` and `DBMS_CLOUD_AI_AGENT` with OCI Generative AI. There is no
local LLM and no substitute AI response path.

A successful Resource Manager Apply means that all of the following completed:

- ADB 26ai was created and loaded with the Finance schema and data.
- An APP_USER Select AI profile was created over 12 curated, read-only views.
- Native advisory teams with tool-free tasks, plus a separate direct-validation
  SQL-only tool, were created.
- Real OCI Generative AI CHAT, SHOWSQL, and RUNSQL probes passed; the native
  SQL tool executed through `RUN_TOOL` and the registered team descriptor was
  verified.
- The running application reached its database and native-AI readiness check.

## Before You Start

Use the same OCI user to create the stack and run its Plan, Apply, and Destroy
jobs. That user must:

- already have the permissions required to create the network, Compute,
  Autonomous Database, Object Storage, and Resource Manager resources in the
  selected compartment;
- be allowed to call OCI Generative AI in that compartment;
- know which OCI identity domain contains their user;
- have that domain's self-service API-key capability enabled and at least one
  free API signing-key slot (OCI permits at most three keys per user); and
- be able to list, create, and delete their own API signing keys through the
  Identity Domains `MyApiKey` API.

The stack does not create IAM users, groups, dynamic groups, or policies. It
also does not make the applying user least-privileged. Confirm the user's
existing permissions before Apply. Plan resolves the selected identity-domain
endpoint and checks the applying user's current API-key count before creating
chargeable resources. A domain that does not contain the applying user fails
closed when the service response is bound to Resource Manager's
`current_user_ocid`.

The tenancy needs capacity for the selected VM shape and paid ADB
configuration. ADB 26ai and the chosen OCI Generative AI model must be
available.

The rendered cloud-init is gzip-compressed before it is placed in OCI instance
metadata. Terraform blocks VM launch if the complete metadata map exceeds the
bundle's 30,000-byte safety budget, below OCI's 32,000-byte service limit.

## Deploy With Resource Manager

1. Open **Developer Services > Resource Manager > Stacks** in OCI.
2. Create a stack and upload this ZIP.
3. Select the stack region, compartment, identity domain containing the
   operator (for example, `Oracle-SSO`), availability domain, access CIDRs,
   SSH public key, sizing, license model, and OCI Generative AI region.
4. Run **Plan** and review the resources, including the API key that will be
   registered for the applying user through the selected identity domain.
5. Run **Apply**. Keep the job open until it succeeds or reports a failed
   bootstrap phase.
6. Open the `application_url` output.
7. Run **Destroy** when the demo is finished.

Apply normally takes 20-45 minutes and has a 90-minute readiness timeout.
Software installation, ADB provisioning, schema loading, OCI Generative AI
latency, and container build time affect the duration.

## OCI Generative AI Choice

This release supports the on-demand model
`cohere.command-a-03-2025`. The default region is `us-chicago-1`.
Resource Manager presents only the regions where this model is supported by
the release contract:

- `us-chicago-1`
- `eu-frankfurt-1`
- `uk-london-1`
- `sa-saopaulo-1`
- `ap-osaka-1`
- `ap-hyderabad-1`
- `me-riyadh-1`

The OCI Generative AI compartment is the same `compartment_ocid` selected for
the stack. The database and VM can be in a different OCI region from the
selected Generative AI region.

## What The Stack Creates

- One VCN, internet gateway, public subnet, route table, and Network Security
  Groups.
- One Oracle Linux 9 Compute instance running the Finance application in
  Podman.
- One mTLS-required Oracle Autonomous AI Database 26ai instance.
- One private Object Storage bucket for application/wallet delivery and
  object-scoped bootstrap callbacks.
- One Terraform-managed public API signing key registered through the selected
  identity domain's self-service `MyApiKey` API.
- APP_USER, the Finance schema and data, `FINANCE_SELECTAI_V1`, four native
  advisory teams with tool-free tasks, and a separate direct-validation
  SQL-only tool.

Inbound access is limited to TCP `22` from `ssh_ingress_cidr` and TCP `8505`
from `app_ingress_cidr`. Both inputs accept only IPv4 `/24` through `/32`.
For a normal Internet client, use its public egress IPv4 plus `/32` (for
example, run `curl -4 https://api.ipify.org`). A private RFC1918 value such as
`192.168.x.x/32` works only when the request actually arrives through a
connected private network.

## Secure API-Key Exchange

The OCI signing-key private half never enters Terraform:

1. The VM generates an unencrypted 2048-bit RSA key under `/opt` with mode
   `0600`.
2. The VM uploads only a deployment- and instance-bound public-key envelope
   through an ObjectWrite pre-authenticated request scoped to one object.
3. Terraform validates freshness and identity, reads the public key with the
   Resource Manager principal, and creates
   `oci_identity_domains_my_api_key.select_ai` through the selected domain's
   self-service endpoint. Postconditions bind the returned user, domain, and
   tenancy to Resource Manager's automatically populated identity values.
4. Terraform returns only OCI's fingerprint through a second, object-scoped
   callback.
5. The VM compares that fingerprint with its locally calculated fingerprint.
6. SQLcl reads the private PEM by local path and creates the APP_USER
   `DBMS_CLOUD` credential.
7. The PEM and temporary public-key file are deleted after the live native-AI
   acceptance tests, and are also removed on handled bootstrap failure or
   interruption.

The private PEM is not a Terraform input or output and is not stored in
Terraform state, instance metadata, Object Storage, the application
environment, or bootstrap logs. Terraform state does contain normal sensitive
stack values such as database passwords, wallet content, and pre-authenticated
request details; restrict access to Resource Manager jobs and state.

The registered API key inherits all OCI permissions already granted to the
applying user. This design avoids a private key in Terraform, but it is not a
replacement for a dedicated least-privilege workload identity.

## Apply-Time Native AI Bootstrap

The VM performs these phases during the Terraform Apply:

1. Wait for OCI DNS, install the small API-key prerequisites, generate the
   stack-specific key, and register its public half.
2. Install Podman, Podman Compose, SQLcl, Java, and the remaining utilities.
3. Download the bundled application and generated ADB wallet.
4. Create APP_USER, load the Finance schema/data, and run database checks.
5. Create the APP_USER OCI credential and `FINANCE_SELECTAI_V1`.
6. Create 12 curated Select AI views, tool-free native advisory tasks, and the
   separate direct-validation SQL tool.
7. Run real CHAT, SHOWSQL, and RUNSQL probes, execute the registered native
   SQL tool once through `RUN_TOOL`, and verify the supervisor team descriptor.
8. Build/start the app with Podman Compose, require HTTP 200 from
   `/api/health`, and verify the built frontend assets.
9. Publish the terminal deployment status; Terraform accepts only the
   success marker for this deployment and VM.

Expected log markers include:

```text
FINANCE_BOOTSTRAP_COMPLETE
FINANCE_HANDOFF_LOADER_COMPLETE
FINANCE_NATIVE_AI_CHAT_OK
FINANCE_NATIVE_AI_SHOWSQL_OK
FINANCE_NATIVE_AI_RUNSQL_OK
FINANCE_NATIVE_AI_AGENT_TASKS_TOOL_FREE_OK
FINANCE_NATIVE_AI_AGENT_TOOL_OK
FINANCE_NATIVE_AI_AGENT_OK
FINANCE_NATIVE_AI_ACCEPTANCE_OK
FINANCE_ADB_ACCEPTANCE_OK
RESOURCE_MANAGER_DEPLOYMENT_OK
```

Transient package, ADB DNS, and new-key propagation failures are retried within
fixed limits. Any other package failure, unsafe generated query, missing native
object, failed native tool/team descriptor check, invalid schema object, failed
app build, or failed health check prevents Apply from succeeding. No local-model
or deterministic AI fallback is used.

## Runtime Governance

Ask Data first requests SHOWSQL from ADB, checks that the statement is one
read-only SELECT/WITH query over the exact curated-view allowlist, executes it
with the selected demo user's VPD context on the same database connection, and
sends only a bounded result back through native CHAT for its explanation.

Agent Console first requests SHOWSQL from ADB, applies the same read-only
allowlist checks, and executes exactly one query in the selected demo user's
VPD context. It passes only bounded evidence into native
`DBMS_CLOUD_AI_AGENT.RUN_TEAM`. Advisory tasks have no SQL or human tools and
carry explicit no-mutation/no-fabrication instructions. The separately
registered SQL tool remains governed by the 12-view profile and is used only
for direct bootstrap acceptance through `RUN_TOOL`. The application can record
the returned recommendation as a proposed audit entry; the agent cannot change
Finance business data or claim that an action ran.

ADB creates short-lived conversation records so follow-up requests can reuse a
native Oracle conversation ID. Prompts and responses are retained for one day
by this demo.

This is an HTTP-only, unauthenticated application. The user switcher and
`X-Demo-User` header demonstrate database VPD context; they do not establish a
trusted identity and can be selected or supplied by any caller who can reach
the app. Dataset import/restore routes can change demo data. Treat
`app_ingress_cidr` as the access-control boundary, keep it limited to trusted
operators, and never use this deployment for production or sensitive data.

## Data Boundary

Prompts and the schema metadata required for Select AI leave ADB for the chosen
OCI Generative AI region. Bounded, VPD-filtered query-result context can also
be sent when the app asks the model to explain a result or supplies governed
evidence to an advisory agent team. Do not use sensitive production data in
this demo unless that transfer and the selected region are approved.

The UI and API expose provider, model, region, action, generated SQL/row
evidence, native readiness, and the read-only/advisory boundary. They do not
expose the OCI user, tenancy, compartment, credential name, PARs, or key
material.

## Resource Manager Inputs

| Input | Purpose |
| --- | --- |
| `region` | Region in which Resource Manager creates the stack resources. |
| `compartment_ocid` | Compartment for the stack and OCI Generative AI authorization scope. |
| `identity_domain_ocid` | Identity domain containing the Resource Manager operator; selected from a tenancy-scoped dropdown. |
| `availability_domain` | Availability domain for the application VM. |
| `stack_name` | Three-to-30-character resource-name prefix. |
| `ssh_public_key` | OpenSSH public key for `opc`. |
| `ssh_ingress_cidr` | Trusted IPv4 `/24` through `/32` for SSH; prefer a workstation/VPN `/32`. |
| `app_ingress_cidr` | Trusted IPv4 `/24` through `/32` allowed to reach the unauthenticated demo on port 8505. |
| `bootstrap_generation` | Repair counter, normally `1`. Incrementing it rotates callbacks/API key and rebuilds the one-shot VM. |
| `vm_shape`, `vm_ocpus`, `vm_memory_gbs` | Application VM sizing. |
| `adb_license_model`, `adb_compute_count`, `adb_storage_tbs` | ADB licensing and sizing. |
| `adb_admin_password` | Optional ADMIN password; leave blank to generate it. |
| `model_object_uri` | Sensitive prefilled one-object HTTPS/PAR URI used by existing Finance vector features; replace it with an approved URI if required. |
| `oci_genai_region` | Dropdown of the seven supported Command A regions. |
| `oci_genai_model` | Fixed on-demand Command A model for this release. |

`tenancy_ocid` and `current_user_ocid` are automatically populated by Resource
Manager and are intentionally not manual form fields. `identity_domain_ocid`
is an explicit dropdown because the legacy IAM API cannot manage API keys for
users in non-Default identity domains.

## Verify After Apply

First open `application_health_url`. A healthy result contains database
connectivity and native-AI readiness and returns HTTP 200. Then use the UI:

1. In **Ask Data**, ask “How many financial products are there?” in Show SQL
   mode. Confirm that generated SQL references a curated `*_V` view.
2. Run the same question in Run SQL or narrative mode. Confirm rows, model,
   region, action, and read-only evidence are shown.
3. Switch demo users and run a transaction/exposure question. Confirm the
   visible data follows the user's VPD scope.
4. In **Agent Console**, run `FINANCE_OPERATIONS_TEAM`. Confirm the response
   identifies `DBMS_CLOUD_AI_AGENT`, `RUN_TEAM`, the selected region/model, and
   advisory/read-only status.
5. Temporarily invalidating the profile or revoking the key should make native
   routes and `/api/health` unavailable; the application must not substitute an
   answer. Restore or redeploy after such a negative test.

The archive also includes a workstation-run regression script. Node.js 20 or
later is recommended:

```bash
node verification/finance-livestack-regression.mjs \
  --base-url http://PUBLIC_IP:8505 \
  --include-agent-chat
```

The `--include-agent-chat` check exercises the real application
`RUN_TEAM` path and writes proposed audit records. Require it to finish before
claiming Agent Console acceptance; Apply deliberately uses bounded
`RUN_TOOL`/`DESCRIBE_TEAM` checks instead. The normal chat check creates
short-lived Select AI conversation records, but the suite does not alter
Finance business data. A successful run ends with
`FINANCE_API_REGRESSION_OK`.

## Failure Recovery

Use these outputs first:

- `first_boot_status_command`: terminal phase/state recorded on the VM.
- `bootstrap_log_command`: recent cloud-init, database, native-AI, and
  application bootstrap output.
- `select_ai_api_key_fingerprint`: fingerprint of the stack-created public
  API key.

If Apply fails after Terraform registered the API key, run a Resource Manager
**Destroy** job. The key is a tracked Terraform resource and Destroy removes
it before deleting the user-independent stack resources.

If Resource Manager state is unavailable and Destroy cannot run, use the
reported fingerprint to identify and manually remove only the key created by
this stack from the applying user's API keys in the selected identity domain.
Then delete the remaining stack resources through the organization's approved
recovery process. Never remove an API key based only on age or an assumed
slot.

If bootstrap was terminated by an uncatchable signal or VM power loss before
local cleanup, the PEM can remain only on that VM's protected filesystem.
Destroy that failed VM/stack rather than reusing the VM.

If a failed deployment was successfully destroyed, wait for Destroy to
complete, upload the corrected configuration, and run a new Plan. A clean
deployment should show the full resource graph as creates and no retained
resources from the destroyed run.

For a stack whose Terraform state is healthy but whose application VM or
object-scoped callback URLs have drifted or expired, increment
`bootstrap_generation`, run Plan, and then Apply. That repair rotates all
bootstrap PARs, replaces the VM, rotates the Terraform-managed API key using
destroy-before-create ordering, and reruns the complete schema/data loader and
native acceptance sequence. Compute delivery changes also rotate these
bootstrap resources automatically. A repair can reset imported demo data;
export anything you need before using it. For an incomplete initial Apply or
uncertain state, inspect a fresh Plan before deciding whether to repair or
Destroy; never Apply over unexpected ADB or network replacement.

## Destroy Behavior

Normal Destroy removes the Terraform-managed public API key, VM, ADB, network,
callback objects/PARs, and private delivery bucket. Removing the public key
immediately makes the APP_USER credential unusable; the corresponding private
key is already absent from the VM after successful bootstrap.

## Build The Upload ZIP

Python 3 and the included helper scripts create
`dist/finance-livestack-resource-manager.zip`:

```bash
bash ./package-resource-manager.sh
```

or on Windows:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\package-resource-manager.ps1
```

The build first creates the reproducible, contents-only
`payload/finance-application.zip`. Terraform references this already-present
file by absolute path and hashes it for both the Object Storage name and
one-shot VM bootstrap replacement. The upload ZIP places `*.tf` and
`schema.yaml` at its root, contains exactly this one approved nested ZIP, and
omits the duplicate raw `application/` tree.

From the expanded maintainer source, the helper regenerates and compares the
payload before packaging. From an extracted Resource Manager archive, where
the raw tree is intentionally absent, it verifies and reuses the packaged
payload.

The helpers reject symbolic links, unsafe paths, any other nested ZIP,
`.terraform`, state, plans, `.tfvars`, wallets, `.env`, PEM/key files,
dependencies, Python caches, frontend build/JET output, VCS/IDE residue, logs,
and other generated artifacts. They also compare every payload file to the
expanded `application/` source before release.

## Maintainer Validation

From the expanded maintainer source, run:

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
python3 verification/check-compute-metadata-budget.py
bash verification/check-selectai-platform-contract.sh
python3 verification/check-resource-manager-package.py \
  --source-root . \
  --archive dist/finance-livestack-resource-manager.zip
bash -n scripts/*.sh application/deployment/*.sh
node --check verification/finance-livestack-regression.mjs
npm --prefix application ci
npm --prefix application test
npm --prefix application run build
```

The Resource Manager ZIP intentionally omits the duplicate raw `application/`
tree. From an exact extraction of the outer ZIP, use the archive-safe subset:

```bash
terraform fmt -check -recursive
terraform init -backend=false
terraform validate
python3 verification/check-compute-metadata-budget.py
bash verification/check-selectai-platform-contract.sh
python3 verification/check-resource-manager-package.py \
  --source-root . \
  --archive /path/to/finance-livestack-resource-manager-native-selectai-v9.zip
bash -n scripts/*.sh
node --check verification/finance-livestack-regression.mjs
```

To rerun application tests from that extracted archive, unzip
`payload/finance-application.zip` into a temporary directory and run
`npm ci`, `npm test`, and `npm run build` there. Do not add the extracted
application tree back to the Resource Manager upload ZIP.

These checks do not create OCI resources. A Terraform Plan performs only
read-only OCI lookups, including the selected identity-domain endpoint and the
applying user's self-service API-key inventory.

Static checks cannot prove model authorization, OCI service reachability,
provider behavior in the target tenancy, or native package execution. A real
Resource Manager Plan, Apply, UI/API regression, and Destroy remain required
before promoting the bundle.

## Official References

- [Terraform configurations for OCI Resource Manager](https://docs.oracle.com/en-us/iaas/Content/ResourceManager/Concepts/terraformconfigresourcemanager.htm)
- [OCI instance metadata limit](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/updatinginstancemetada.htm)
- [Terraform `base64gzip`](https://developer.hashicorp.com/terraform/language/functions/base64gzip)
- [cloud-init gzip user-data](https://docs.cloud-init.io/en/latest/explanation/format/index.html)
- [OCI Terraform Identity Domains MyApiKey resource](https://docs.oracle.com/en-us/iaas/tools/terraform-provider-oci/latest/docs/r/identity_domains_my_api_key.html)
- [Managing OCI user credentials](https://docs.oracle.com/en-us/iaas/Content/Identity/Tasks/managingcredentials.htm)
- [DBMS_CLOUD_AI package](https://docs.oracle.com/en-us/iaas/autonomous-database-serverless/doc/dbms-cloud-ai-package.html)
- [DBMS_CLOUD_AI_AGENT package](https://docs.oracle.com/en-us/iaas/autonomous-database-serverless/doc/dbms-cloud-ai-agent-package.html)
- [OCI Generative AI model regions](https://docs.oracle.com/en-us/iaas/Content/generative-ai/model-endpoint-regions.htm)
- [SQLcl DBMS_CLOUD authentication](https://docs.oracle.com/en/database/oracle/sql-developer-command-line/26.1/sqcug/using-dbms_cloud-authentication.html)
