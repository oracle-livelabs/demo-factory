locals {
  application_cloud_init = templatefile("${path.module}/cloud-init/app.yaml", {
    application_archive_url_b64     = base64encode("https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.application.access_uri}")
    wallet_archive_url_b64          = base64encode("https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.wallet.access_uri}")
    bootstrap_status_upload_url_b64 = base64encode("https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.bootstrap_status_write.access_uri}")
    api_key_public_upload_url_b64   = base64encode("https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.api_key_public_write.access_uri}")
    api_key_activation_url_b64      = base64encode("https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.api_key_activation_read.access_uri}")
    adb_admin_password_b64          = base64encode(local.adb_admin_password)
    application_password_b64        = base64encode(random_password.application_schema.result)
    wallet_password_b64             = base64encode(random_password.wallet.result)
    adb_service_name_b64            = base64encode(local.adb_service_name)
    model_object_uri_b64            = base64encode(var.model_object_uri)
    tenancy_ocid_b64                = base64encode(var.tenancy_ocid)
    current_user_ocid_b64           = base64encode(var.current_user_ocid)
    compartment_ocid_b64            = base64encode(var.compartment_ocid)
    oci_genai_region_b64            = base64encode(var.oci_genai_region)
    oci_genai_model_b64             = base64encode(var.oci_genai_model)
    select_ai_profile_b64           = base64encode(local.select_ai_profile)
    select_ai_primary_team_b64      = base64encode(local.select_ai_primary_agent_team)
    select_ai_agent_teams_b64       = base64encode(local.select_ai_agent_teams)
    deployment_id                   = random_id.deployment.hex
    application_port                = local.application_port
    bootstrap_app_vm_script         = indent(6, trimspace(file("${path.module}/scripts/bootstrap_app_vm.sh")))
  })

  # OCI limits metadata plus extendedMetadata to 32,000 bytes. Keep a
  # deliberate 2,000-byte safety margin and count the exact UTF-8 JSON byte
  # length without exposing the sensitive rendered metadata.
  application_instance_metadata_budget_bytes = 30000
  application_instance_metadata = {
    ssh_authorized_keys = trimspace(var.ssh_public_key)
    user_data           = base64gzip(local.application_cloud_init)
  }
  application_metadata_json_b64 = base64encode(jsonencode(local.application_instance_metadata))
  application_metadata_size_bytes = nonsensitive(
    floor(length(local.application_metadata_json_b64) * 3 / 4) -
    (
      endswith(local.application_metadata_json_b64, "==") ? 2 :
      endswith(local.application_metadata_json_b64, "=") ? 1 : 0
    )
  )
}

resource "oci_core_instance" "application" {
  availability_domain = local.availability_domain
  compartment_id      = var.compartment_ocid
  display_name        = "${local.name_prefix}-application"
  shape               = var.vm_shape
  freeform_tags       = local.common_tags

  dynamic "shape_config" {
    for_each = local.vm_is_flex_shape ? [1] : []
    content {
      ocpus         = var.vm_ocpus
      memory_in_gbs = var.vm_memory_gbs
    }
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.application.id
    assign_public_ip = true
    display_name     = "${local.name_prefix}-application-vnic"
    hostname_label   = "finance"
    nsg_ids          = [oci_core_network_security_group.application.id]
  }

  source_details {
    source_type             = "image"
    source_id               = local.vm_image_ocid
    boot_volume_size_in_gbs = 100
  }

  instance_options {
    are_legacy_imds_endpoints_disabled = true
  }

  lifecycle {
    replace_triggered_by = [terraform_data.bootstrap_configuration]

    precondition {
      condition     = local.application_metadata_size_bytes <= local.application_instance_metadata_budget_bytes
      error_message = "Rendered OCI instance metadata is ${local.application_metadata_size_bytes} bytes; it must remain at or below ${local.application_instance_metadata_budget_bytes} bytes before VM launch."
    }
  }

  metadata = local.application_instance_metadata

  depends_on = [
    oci_database_autonomous_database.application,
    oci_objectstorage_preauthrequest.api_key_activation_read,
    oci_objectstorage_preauthrequest.api_key_public_write,
    oci_objectstorage_preauthrequest.application,
    oci_objectstorage_preauthrequest.wallet,
  ]
}
