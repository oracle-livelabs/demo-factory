# Resource Manager has no native awareness of cloud-init. The VM publishes a
# credential-free terminal status to a dedicated, stack-owned Object Storage
# object. This local provisioner polls that status so Apply succeeds only after
# the database-backed application health check has passed. No additional SSH
# access or customer input is required.
resource "terraform_data" "bootstrap_readiness" {
  triggers_replace = [
    oci_core_instance.application.id,
    oci_objectstorage_preauthrequest.bootstrap_status_read.id,
  ]

  provisioner "local-exec" {
    command = "bash ${path.module}/scripts/wait_for_bootstrap_callback.sh"

    environment = {
      BOOTSTRAP_STATUS_URL           = "https://objectstorage.${var.region}.oraclecloud.com${oci_objectstorage_preauthrequest.bootstrap_status_read.access_uri}"
      EXPECTED_DEPLOYMENT_ID         = random_id.deployment.hex
      EXPECTED_INSTANCE_OCID         = oci_core_instance.application.id
      WAIT_TIMEOUT_SECONDS           = "5400"
      POLL_INTERVAL_SECONDS          = "15"
      INITIAL_STATUS_TIMEOUT_SECONDS = "900"
    }
  }

  depends_on = [
    oci_core_instance.application,
    oci_objectstorage_preauthrequest.bootstrap_status_read,
    oci_objectstorage_preauthrequest.bootstrap_status_write,
    terraform_data.api_key_activation,
  ]
}
