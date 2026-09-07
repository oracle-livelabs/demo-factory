# Finance LiveStack Resource Manager bundle

- `source/` contains the reviewable Terraform and application source.
- `finance-livestack-resource-manager-v4.zip` is the upload-ready OCI Resource Manager stack.

## v4 Resource Manager bundle

This bundle uses `APP_USER` as the Finance database schema user and includes
the Finance Data Assistant follow-up fixes:

- Conversation context and validated read-only SQL are available to SQL generation.
- Conversation data is bounded and treated as untrusted reference data.
- Oracle row limits use `FETCH FIRST n ROWS ONLY`.
- `ORA-30483` enters the existing SQL repair loop.
- Existing read-only validation, governed table allowlist, and database user context remain enforced.
- The ADB embedding-model URI is pre-filled as a bundled value, so customers do not need to supply one.
- SSH `0.0.0.0/0` is rejected in the Resource Manager form, with guidance for finding the correct public source IP.
- Customers can optionally set the Autonomous Database ADMIN password; when left blank, the stack generates one.
- `application_url` is the ready-to-open Finance application link; `vm_instance_ip` is available for SSH and troubleshooting.
- Apply waits for a stack-owned bootstrap status callback after the database-backed application health check, so a successful job means the app is ready to open.

## Region support

The stack takes the OCI region and availability domain from Resource Manager and dynamically selects an Oracle Linux 9 image. It is intended for OCI commercial realm regions where paid Autonomous Database 26ai ECPU service, the selected Compute shape, Object Storage, and the required capacity are available.

It is not guaranteed in every OCI realm. The generated Object Storage download URLs use the commercial `oraclecloud.com` domain; government or sovereign realms with a different realm domain require an endpoint adjustment. A different VM shape may also be needed where `VM.Standard.E4.Flex` is unavailable.
