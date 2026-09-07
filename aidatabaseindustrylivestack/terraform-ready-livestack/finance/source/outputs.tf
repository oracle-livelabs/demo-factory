output "application_url" {
  description = "Public Finance LiveStack URL, including port 8505. Apply succeeds only after the app is ready."
  value       = "http://${oci_core_instance.application.public_ip}:${local.application_port}/"
}

output "next_step" {
  description = "How to open the Finance application."
  value       = "Open the application: http://${oci_core_instance.application.public_ip}:${local.application_port}/"
}

output "application_health_url" {
  description = "Database-backed application health endpoint."
  value       = "http://${oci_core_instance.application.public_ip}:${local.application_port}/api/health"
}

output "vm_instance_ip" {
  description = "Raw public IP address of the application VM. Use application_url to open the Finance application."
  value       = oci_core_instance.application.public_ip
}

output "application_private_ip" {
  description = "Private IP address of the application VM."
  value       = oci_core_instance.application.private_ip
}

output "application_ssh_command" {
  description = "SSH command for the application VM."
  value       = "ssh opc@${oci_core_instance.application.public_ip}"
}

output "first_boot_status_command" {
  description = "Display the recorded bootstrap state; it remains useful after a failed Apply."
  value       = "ssh opc@${oci_core_instance.application.public_ip} 'sudo cloud-init status --wait; result=$?; sudo cat /opt/finance-livestack/deployment-status.txt 2>/dev/null || true; exit $result'"
}

output "bootstrap_log_command" {
  description = "Display the application, database, and native Select AI bootstrap log after an Apply failure."
  value       = "ssh opc@${oci_core_instance.application.public_ip} 'sudo tail -n 250 /var/log/finance-livestack-bootstrap.log'"
}

output "autonomous_database_name" {
  description = "Autonomous Database name."
  value       = oci_database_autonomous_database.application.db_name
}

output "autonomous_database_ocid" {
  description = "Autonomous Database OCID."
  value       = oci_database_autonomous_database.application.id
}

output "autonomous_database_service" {
  description = "Wallet service used by the application and SQL bootstrap."
  value       = local.adb_service_name
}

output "select_ai_api_key_fingerprint" {
  description = "Fingerprint of the stack-created public OCI Identity Domains API key. Use this non-secret identifier only to find and remove an orphan if Terraform state is unavailable."
  value       = oci_identity_domains_my_api_key.select_ai.fingerprint
}

output "application_database_user" {
  description = "Dedicated schema used by the Finance application."
  value       = local.application_user
}

output "application_database_password" {
  description = "Generated application schema password. Treat Resource Manager state as sensitive."
  value       = random_password.application_schema.result
  sensitive   = true
}

output "autonomous_database_admin_password" {
  description = "Configured ADMIN password (supplied or generated). Treat Resource Manager state as sensitive."
  value       = local.adb_admin_password
  sensitive   = true
}

output "delivery_bucket_name" {
  description = "Private, stack-owned bucket used to deliver the application and wallet during first boot."
  value       = oci_objectstorage_bucket.delivery.name
}

output "first_boot_note" {
  description = "What to expect after Resource Manager Apply."
  value       = "Apply stays in progress while the VM publishes only a generated public key, Terraform registers it through the selected identity domain for the current OCI user, ADB validates native Select AI and read-only agents, and the app passes /api/health. Destroy removes the registered public key. Use bootstrap_log_command if Apply fails."
}
