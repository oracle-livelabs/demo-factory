resource "oci_objectstorage_bucket" "delivery" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.stack.namespace
  name           = substr("${local.name_prefix}-${random_id.deployment.hex}", 0, 63)
  access_type    = "NoPublicAccess"
  auto_tiering   = "Disabled"
  storage_tier   = "Standard"
  freeform_tags  = local.common_tags
}

resource "oci_objectstorage_object" "application" {
  # Key the Terraform resource instance by the payload digest as well as the
  # Object Storage name. The OCI provider can otherwise rename this resource
  # in place when only `object` changes while retaining the previous source
  # bytes. A new digest must always create a new immutable object.
  for_each = toset([local.application_payload_sha256])

  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  object       = "application/payloads/${each.key}.zip"
  source       = local.application_payload_path
  content_type = "application/zip"
}

# The wallet is already base64-encoded by the ADB wallet API. Upload that
# textual representation so Resource Manager never depends on a local file
# that disappears between Plan, Apply, and Destroy workers.
resource "oci_objectstorage_object" "wallet" {
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  object       = "runtime/adb-wallet.b64"
  content      = oci_database_autonomous_database_wallet.application.content
  content_type = "text/plain"
}

# Cloud-init overwrites this one safe, managed object as it progresses. Keeping
# it under Terraform management also ensures Destroy removes it before the
# delivery bucket is deleted.
resource "oci_objectstorage_object" "bootstrap_status" {
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  object       = "runtime/bootstrap-status.txt"
  content_type = "text/plain"
  content      = <<-EOT
    format=finance-rm-bootstrap/v1
    state=PENDING
    phase=waiting_for_cloud_init
    deployment_id=${random_id.deployment.hex}
    marker=RESOURCE_MANAGER_DEPLOYMENT_PENDING
  EOT

  lifecycle {
    ignore_changes = [content]
  }
}

# The VM receives a write-only PAR for this exact object. It generates the RSA
# key pair locally and publishes only a short JSON envelope containing the
# public key. Terraform reads the object with its normal Resource Manager
# identity after a bound/fresh callback has been observed.
resource "oci_objectstorage_object" "api_key_public_callback" {
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  object       = "runtime/selectai-api-key-public.json"
  content_type = "application/json"
  content = jsonencode({
    format        = "finance-selectai-api-key-public/v1"
    state         = "PENDING"
    deployment_id = random_id.deployment.hex
    marker        = "SELECTAI_API_KEY_PUBLIC_PENDING"
  })

  lifecycle {
    ignore_changes = [content]
  }
}

# Terraform writes only the registered public-key fingerprint to this object.
# The VM receives a read-only PAR and refuses activation unless the deployment,
# instance, expiration, and locally calculated fingerprint all match.
resource "oci_objectstorage_object" "api_key_activation" {
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  object       = "runtime/selectai-api-key-activation.json"
  content_type = "application/json"
  content = jsonencode({
    format        = "finance-selectai-api-key-activation/v1"
    state         = "PENDING"
    deployment_id = random_id.deployment.hex
    marker        = "SELECTAI_API_KEY_ACTIVATION_PENDING"
  })

  lifecycle {
    ignore_changes = [content]
  }
}

resource "oci_objectstorage_preauthrequest" "application" {
  access_type  = "ObjectRead"
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  name         = "${local.name_prefix}-application-download"
  object_name  = oci_objectstorage_object.application[local.application_payload_sha256].object
  time_expires = timeadd(timestamp(), "24h")

  lifecycle {
    ignore_changes       = [time_expires]
    replace_triggered_by = [terraform_data.bootstrap_configuration]
  }
}

resource "oci_objectstorage_preauthrequest" "wallet" {
  access_type  = "ObjectRead"
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  name         = "${local.name_prefix}-wallet-download"
  object_name  = oci_objectstorage_object.wallet.object
  time_expires = timeadd(timestamp(), "24h")

  lifecycle {
    ignore_changes       = [time_expires]
    replace_triggered_by = [terraform_data.bootstrap_configuration]
  }
}

# The VM can only write this exact status object. The Resource Manager job can
# only read it, so bootstrap readiness adds no public or SSH access path.
resource "oci_objectstorage_preauthrequest" "bootstrap_status_write" {
  access_type  = "ObjectWrite"
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  name         = "${local.name_prefix}-bootstrap-status-write"
  object_name  = oci_objectstorage_object.bootstrap_status.object
  time_expires = timeadd(timestamp(), "24h")

  lifecycle {
    ignore_changes       = [time_expires]
    replace_triggered_by = [terraform_data.bootstrap_configuration]
  }
}

resource "oci_objectstorage_preauthrequest" "bootstrap_status_read" {
  access_type  = "ObjectRead"
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  name         = "${local.name_prefix}-bootstrap-status-read"
  object_name  = oci_objectstorage_object.bootstrap_status.object
  time_expires = timeadd(timestamp(), "24h")

  lifecycle {
    ignore_changes       = [time_expires]
    replace_triggered_by = [terraform_data.bootstrap_configuration]
  }
}

resource "oci_objectstorage_preauthrequest" "api_key_public_write" {
  access_type  = "ObjectWrite"
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  name         = "${local.name_prefix}-selectai-public-key-write"
  object_name  = oci_objectstorage_object.api_key_public_callback.object
  time_expires = timeadd(timestamp(), "6h")

  lifecycle {
    ignore_changes       = [time_expires]
    replace_triggered_by = [terraform_data.bootstrap_configuration]
  }
}

resource "oci_objectstorage_preauthrequest" "api_key_public_read" {
  access_type  = "ObjectRead"
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  name         = "${local.name_prefix}-selectai-public-key-read"
  object_name  = oci_objectstorage_object.api_key_public_callback.object
  time_expires = timeadd(timestamp(), "6h")

  lifecycle {
    ignore_changes       = [time_expires]
    replace_triggered_by = [terraform_data.bootstrap_configuration]
  }
}

resource "oci_objectstorage_preauthrequest" "api_key_activation_write" {
  access_type  = "ObjectWrite"
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  name         = "${local.name_prefix}-selectai-activation-write"
  object_name  = oci_objectstorage_object.api_key_activation.object
  time_expires = timeadd(timestamp(), "6h")

  lifecycle {
    ignore_changes       = [time_expires]
    replace_triggered_by = [terraform_data.bootstrap_configuration]
  }
}

resource "oci_objectstorage_preauthrequest" "api_key_activation_read" {
  access_type  = "ObjectRead"
  bucket       = oci_objectstorage_bucket.delivery.name
  namespace    = data.oci_objectstorage_namespace.stack.namespace
  name         = "${local.name_prefix}-selectai-activation-read"
  object_name  = oci_objectstorage_object.api_key_activation.object
  time_expires = timeadd(timestamp(), "6h")

  lifecycle {
    ignore_changes       = [time_expires]
    replace_triggered_by = [terraform_data.bootstrap_configuration]
  }
}
