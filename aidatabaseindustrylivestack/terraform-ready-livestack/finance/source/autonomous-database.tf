resource "oci_database_autonomous_database" "application" {
  admin_password              = local.adb_admin_password
  compartment_id              = var.compartment_ocid
  compute_model               = "ECPU"
  compute_count               = var.adb_compute_count
  data_storage_size_in_tbs    = var.adb_storage_tbs
  db_name                     = local.adb_database_name
  db_version                  = "26ai"
  db_workload                 = "OLTP"
  display_name                = "${local.name_prefix}-adb"
  is_auto_scaling_enabled     = false
  is_free_tier                = false
  is_mtls_connection_required = true
  license_model               = var.adb_license_model
  freeform_tags               = local.common_tags
}

resource "oci_database_autonomous_database_wallet" "application" {
  autonomous_database_id = oci_database_autonomous_database.application.id
  base64_encode_content  = true
  generate_type          = "SINGLE"
  password               = random_password.wallet.result
}
