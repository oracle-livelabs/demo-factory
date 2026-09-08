data "oci_core_images" "oracle_linux" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Oracle Linux"
  operating_system_version = "9"
  shape                    = var.vm_shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

data "oci_objectstorage_namespace" "stack" {
  compartment_id = var.compartment_ocid
}

locals {
  # Resource Manager makes uploaded configuration files available before
  # planning. Keep the application as an intentional prebuilt payload so the
  # OCI provider can inspect this absolute source path during both Plan and
  # Apply; an archive_file resource would create it too late.
  application_payload_path   = abspath("${path.module}/payload/finance-application.zip")
  application_payload_sha256 = filesha256(local.application_payload_path)
}

# Cloud-init is a one-shot bootstrap. Force a fresh VM when any input that must
# be consumed during first boot changes; metadata updates alone would not rerun
# the Select AI credential/profile/agent setup.
resource "terraform_data" "bootstrap_configuration" {
  triggers_replace = [
    local.application_payload_sha256,
    filesha256("${path.module}/cloud-init/app.yaml"),
    filesha256("${path.module}/compute-app.tf"),
    filesha256("${path.module}/object-storage.tf"),
    filesha256("${path.module}/scripts/bootstrap_app_vm.sh"),
    var.bootstrap_generation,
    var.tenancy_ocid,
    var.current_user_ocid,
    var.identity_domain_ocid,
    var.compartment_ocid,
    var.oci_genai_region,
    var.oci_genai_model,
    sha256(var.model_object_uri),
    var.availability_domain,
    var.vm_shape,
    var.vm_ocpus,
    var.vm_memory_gbs,
    sha256(trimspace(var.ssh_public_key)),
    local.vm_image_ocid,
    local.application_port,
    oci_core_subnet.application.id,
    oci_database_autonomous_database.application.id,
    oci_database_autonomous_database_wallet.application.id,
    sha256(local.adb_admin_password),
    sha256(random_password.application_schema.result),
    sha256(random_password.wallet.result),
    local.select_ai_profile,
    local.select_ai_primary_agent_team,
    local.select_ai_agent_teams,
  ]
}

resource "random_id" "deployment" {
  byte_length = 4
}

resource "random_password" "adb_admin" {
  length      = 20
  special     = false
  upper       = true
  lower       = true
  numeric     = true
  min_upper   = 1
  min_lower   = 1
  min_numeric = 1
}

resource "random_password" "application_schema" {
  length      = 20
  special     = false
  upper       = true
  lower       = true
  numeric     = true
  min_upper   = 1
  min_lower   = 1
  min_numeric = 1
}

resource "random_password" "wallet" {
  length      = 20
  special     = false
  upper       = true
  lower       = true
  numeric     = true
  min_upper   = 1
  min_lower   = 1
  min_numeric = 1
}

locals {
  sanitized_stack_name = trim(replace(lower(var.stack_name), "/[^a-z0-9-]/", "-"), "-")
  name_prefix          = substr(local.sanitized_stack_name, 0, 24)
  availability_domain  = var.availability_domain

  application_name = "finance"
  application_user = "APP_USER"
  application_port = 8505

  select_ai_profile            = "FINANCE_SELECTAI_V1"
  select_ai_primary_agent_team = "FINANCE_OPERATIONS_TEAM"
  select_ai_agent_teams        = "FINANCE_OPERATIONS_TEAM,SOCIAL_TREND_TEAM,FULFILLMENT_TEAM,COMMERCE_TEAM"

  vcn_cidr        = "10.42.0.0/16"
  app_subnet_cidr = "10.42.10.0/24"

  vm_is_flex_shape = endswith(var.vm_shape, ".Flex")
  vm_image_ocid    = data.oci_core_images.oracle_linux.images[0].id

  # ADB database names are regional and must be unique enough for concurrent
  # workshop stacks. Keep the value alphanumeric and comfortably below the
  # Autonomous Database name limit.
  adb_database_name           = upper("FIN${random_id.deployment.hex}")
  adb_service_name            = "${lower(local.adb_database_name)}_high"
  supplied_adb_admin_password = trimspace(var.adb_admin_password == null ? "" : var.adb_admin_password)
  adb_admin_password          = local.supplied_adb_admin_password == "" ? random_password.adb_admin.result : var.adb_admin_password

  common_tags = {
    "created-by" = "oci-resource-manager"
    "livestack"  = local.application_name
    "template"   = "terraform-ready-livestack"
  }
}
