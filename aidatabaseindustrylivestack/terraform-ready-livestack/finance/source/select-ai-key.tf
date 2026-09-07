# Wait for the VM to publish a fresh, instance-bound public key. This resource
# deliberately has no output carrying key material; it only creates an ordering
# edge before the OCI Object Storage data source performs an authenticated read.
resource "terraform_data" "api_key_public_callback_ready" {
  triggers_replace = [
    random_id.deployment.hex,
    oci_core_instance.application.id,
    oci_objectstorage_preauthrequest.api_key_public_read.id,
  ]

  provisioner "local-exec" {
    command = "bash ${path.module}/scripts/wait_for_selectai_api_key_callback.sh"

    environment = {
      API_KEY_PUBLIC_CALLBACK_URL = "https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.api_key_public_read.access_uri}"
      BOOTSTRAP_STATUS_URL         = "https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.bootstrap_status_read.access_uri}"
      EXPECTED_DEPLOYMENT_ID      = random_id.deployment.hex
      EXPECTED_INSTANCE_OCID      = oci_core_instance.application.id
      WAIT_TIMEOUT_SECONDS        = "3600"
      POLL_INTERVAL_SECONDS       = "5"
      MAX_CALLBACK_AGE_SECONDS    = "1800"
    }
  }

  depends_on = [
    oci_core_instance.application,
    oci_objectstorage_preauthrequest.api_key_public_read,
    oci_objectstorage_preauthrequest.api_key_public_write,
  ]
}

# The object remains in the stack-owned bucket until Destroy, so refresh and
# Destroy do not depend on an expired PAR or an ephemeral Resource Manager file.
data "oci_objectstorage_object" "api_key_public_callback" {
  bucket                = oci_objectstorage_bucket.delivery.name
  namespace             = data.oci_objectstorage_namespace.stack.namespace
  object                = oci_objectstorage_object.api_key_public_callback.object
  content_length_limit  = 8192
  base64_encode_content = false

  depends_on = [terraform_data.api_key_public_callback_ready]
}

locals {
  selectai_key_callback   = try(jsondecode(data.oci_objectstorage_object.api_key_public_callback.content), {})
  selectai_public_key_pem = try(base64decode(local.selectai_key_callback.public_key_b64), "")

  # This logical-stack token uses only Plan-known inputs. A fresh stack with
  # three unrelated keys therefore fails during Plan, while a later Plan can
  # recognize this stack's own third key and still perform no-op or replacement
  # operations. Changing the compartment or stack name represents a new logical
  # stack and intentionally requires a free slot or a prior Destroy.
  selectai_api_key_owner_token = substr(sha256(jsonencode([
    var.tenancy_ocid,
    var.current_user_ocid,
    var.identity_domain_ocid,
    var.compartment_ocid,
    var.stack_name,
  ])), 0, 16)
  selectai_api_key_description = "Finance LiveStack ${var.stack_name} ${local.selectai_api_key_owner_token}"
}

# Resolve the selected Identity Domains endpoint and verify that the applying
# identity can inspect its own API-key collection before waiting for the VM.
# This uses the self-service MyApiKeys API, not the legacy IAM /20160918 API,
# which cannot manage users in non-Default identity domains.
data "oci_identity_domain" "selected" {
  domain_id = var.identity_domain_ocid
}

data "oci_identity_domains_my_api_keys" "current" {
  idcs_endpoint    = data.oci_identity_domain.selected.url
  my_api_key_count = 10
}

# OCI tracks this uploaded public key as a first-class Identity Domains
# MyApiKey resource. Terraform therefore deletes it during Destroy; the
# private half never enters Terraform or callback storage and is transferred
# only over the protected database connection into ADB's credential store.
# MyApiKey always targets the authenticated Resource Manager operator, while
# postconditions bind the service response to Resource Manager's automatically
# populated current_user_ocid and the explicitly selected identity domain.
# Intentionally retain Terraform's destroy-before-create replacement behavior:
# it frees the old slot before uploading a replacement for users with one free
# API-key slot. Do not add create_before_destroy here.
resource "oci_identity_domains_my_api_key" "select_ai" {
  idcs_endpoint = data.oci_identity_domain.selected.url
  key           = local.selectai_public_key_pem
  schemas       = ["urn:ietf:params:scim:schemas:oracle:idcs:apikey"]
  description   = local.selectai_api_key_description

  lifecycle {
    # The object-scoped upload URL must remain valid long enough for ADB and the
    # VM to be provisioned, so the callback object can technically be
    # overwritten while that PAR is alive. Pin the registered key after its
    # initial creation. A replacement VM is the only event that is allowed to
    # rotate it, and replacement remains destroy-before-create for users with
    # exactly one free API-key slot.
    ignore_changes       = [key]
    replace_triggered_by = [oci_core_instance.application.id]

    precondition {
      condition     = try(startswith(data.oci_identity_domain.selected.url, "https://"), false)
      error_message = "Select an OCI identity domain with an Identity Domains HTTPS endpoint."
    }

    precondition {
      condition = (
        data.oci_identity_domains_my_api_keys.current.total_results < 3 ||
        anytrue([
          for api_key in data.oci_identity_domains_my_api_keys.current.my_api_keys :
          api_key.description == local.selectai_api_key_description
        ])
      )
      error_message = "The Resource Manager operator already has three API signing keys in the selected identity domain. Remove one unused key, then run Plan again."
    }

    precondition {
      condition = try(
        local.selectai_key_callback.format == "finance-selectai-api-key-public/v1" &&
        local.selectai_key_callback.state == "READY" &&
        local.selectai_key_callback.marker == "SELECTAI_API_KEY_PUBLIC_READY" &&
        local.selectai_key_callback.deployment_id == random_id.deployment.hex &&
        local.selectai_key_callback.instance_ocid == oci_core_instance.application.id,
        false,
      )
      error_message = "The Select AI public-key callback is not bound to this deployment and VM."
    }

    precondition {
      condition = (
        length(local.selectai_public_key_pem) >= 300 &&
        length(local.selectai_public_key_pem) <= 2048 &&
        startswith(local.selectai_public_key_pem, "-----BEGIN PUBLIC KEY-----\n") &&
        endswith(trimspace(local.selectai_public_key_pem), "-----END PUBLIC KEY-----")
      )
      error_message = "The Select AI callback did not contain a bounded RSA public key in PEM format."
    }

    postcondition {
      condition = try(
        self.domain_ocid == var.identity_domain_ocid &&
        self.tenancy_ocid == var.tenancy_ocid &&
        length(self.user) == 1 &&
        self.user[0].ocid == var.current_user_ocid,
        false,
      )
      error_message = "Identity Domains did not bind the stack-created API key to the expected Resource Manager operator, tenancy, and identity domain."
    }

    postcondition {
      condition     = can(regex("^([0-9A-Fa-f]{2}:){15}[0-9A-Fa-f]{2}$", self.fingerprint))
      error_message = "Identity Domains did not return a valid fingerprint for the stack-created API key."
    }
  }
}

# Return the OCI-computed fingerprint through a second object-scoped callback.
# The VM independently calculates the fingerprint of its local public key and
# refuses to bootstrap ADB unless the values match.
resource "terraform_data" "api_key_activation" {
  triggers_replace = [
    random_id.deployment.hex,
    oci_core_instance.application.id,
    oci_identity_domains_my_api_key.select_ai.id,
  ]

  provisioner "local-exec" {
    command = "bash ${path.module}/scripts/publish_selectai_api_key_activation.sh"

    environment = {
      API_KEY_ACTIVATION_UPLOAD_URL = "https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.api_key_activation_write.access_uri}"
      DEPLOYMENT_ID                 = random_id.deployment.hex
      INSTANCE_OCID                 = oci_core_instance.application.id
      API_KEY_FINGERPRINT           = oci_identity_domains_my_api_key.select_ai.fingerprint
      ACTIVATION_TTL_SECONDS        = "3600"
    }
  }

  depends_on = [
    oci_identity_domains_my_api_key.select_ai,
    oci_objectstorage_preauthrequest.api_key_activation_write,
  ]
}
