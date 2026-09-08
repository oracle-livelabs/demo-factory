variable "region" {
  description = "OCI region where Resource Manager creates the LiveStack."
  type        = string
}

variable "tenancy_ocid" {
  description = "OCI tenancy OCID. Resource Manager populates this value automatically."
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.tenancy\\.", var.tenancy_ocid))
    error_message = "Resource Manager must supply a valid tenancy OCID."
  }
}

variable "current_user_ocid" {
  description = "OCI user OCID for the Resource Manager operator. Resource Manager populates this value automatically and the selected identity domain must contain this user."
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.user\\.", var.current_user_ocid))
    error_message = "Resource Manager must supply an API-key-capable OCI user OCID."
  }
}

variable "identity_domain_ocid" {
  description = "Identity domain containing the Resource Manager operator. The stack uses this domain's self-service MyApiKey endpoint."
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.domain\\.", var.identity_domain_ocid))
    error_message = "Select the OCI identity domain that contains the Resource Manager operator."
  }
}

variable "compartment_ocid" {
  description = "Compartment where every stack resource is created."
  type        = string

  validation {
    condition     = can(regex("^ocid1\\.(compartment|tenancy)\\.", var.compartment_ocid))
    error_message = "Select a valid OCI compartment."
  }
}

variable "availability_domain" {
  description = "Availability domain where the application VM is created."
  type        = string

  validation {
    condition     = length(trimspace(var.availability_domain)) > 0
    error_message = "Select an availability domain."
  }
}

variable "stack_name" {
  description = "Short name used as the display-name prefix for stack resources."
  type        = string
  default     = "finance-livestack"

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9-]{2,29}$", var.stack_name))
    error_message = "Stack name must start with a letter and contain 3-30 letters, numbers, or hyphens."
  }
}

variable "ssh_public_key" {
  description = "OpenSSH public key used for opc access to the LiveStack VM."
  type        = string

  validation {
    condition = (
      can(regex("^(ssh-(rsa|ed25519)|ecdsa-sha2-)", trimspace(var.ssh_public_key))) &&
      length(trimspace(var.ssh_public_key)) <= 4096
    )
    error_message = "Provide one valid OpenSSH public key no longer than 4,096 characters."
  }
}

variable "ssh_ingress_cidr" {
  description = "Public IPv4 CIDR (/24 to /32) allowed to SSH to the VM. From the computer, VPN, or bastion you will use for SSH, run curl -4 https://api.ipify.org and append /32."
  type        = string

  validation {
    condition = (
      can(cidrnetmask(var.ssh_ingress_cidr)) &&
      !strcontains(var.ssh_ingress_cidr, ":") &&
      try(tonumber(split("/", var.ssh_ingress_cidr)[1]), 0) >= 24
    )
    error_message = "SSH source CIDR must be a valid IPv4 /24 to /32. Prefer the public IPv4 address of the computer, VPN, or bastion you will SSH from followed by /32."
  }
}

variable "app_ingress_cidr" {
  description = "Trusted IPv4 CIDR (/24 to /32) allowed to open the unauthenticated Finance demo. For Internet clients, use the public egress IPv4 plus /32; an RFC1918 address works only through connected private networking."
  type        = string

  validation {
    condition = (
      can(cidrnetmask(var.app_ingress_cidr)) &&
      !strcontains(var.app_ingress_cidr, ":") &&
      try(tonumber(split("/", var.app_ingress_cidr)[1]), 0) >= 24
    )
    error_message = "Application ingress must be a trusted IPv4 /24 to /32."
  }
}

variable "bootstrap_generation" {
  description = "Bootstrap repair generation. Leave at 1 for normal deployment; increment to rotate expired callback URLs and rebuild the VM after drift or a failed repair."
  type        = number
  default     = 1

  validation {
    condition     = var.bootstrap_generation >= 1 && var.bootstrap_generation <= 9999 && floor(var.bootstrap_generation) == var.bootstrap_generation
    error_message = "Bootstrap generation must be a whole number from 1 to 9999."
  }
}

variable "vm_shape" {
  description = "Compute shape for the single VM that runs all non-database Podman containers."
  type        = string
  default     = "VM.Standard.E4.Flex"
}

variable "vm_ocpus" {
  description = "OCPUs assigned when a flexible VM shape is selected."
  type        = number
  default     = 2

  validation {
    condition     = var.vm_ocpus >= 1 && var.vm_ocpus <= 64
    error_message = "VM OCPUs must be between 1 and 64."
  }
}

variable "vm_memory_gbs" {
  description = "Memory in GB assigned when a flexible VM shape is selected."
  type        = number
  default     = 16

  validation {
    condition     = var.vm_memory_gbs >= 8 && var.vm_memory_gbs <= 1024
    error_message = "VM memory must be between 8 and 1024 GB."
  }
}

variable "adb_license_model" {
  description = "Autonomous Database license model available in the target tenancy."
  type        = string
  default     = "LICENSE_INCLUDED"

  validation {
    condition     = contains(["LICENSE_INCLUDED", "BRING_YOUR_OWN_LICENSE"], var.adb_license_model)
    error_message = "Choose LICENSE_INCLUDED or BRING_YOUR_OWN_LICENSE."
  }
}

variable "adb_compute_count" {
  description = "ECPUs assigned to Autonomous Database."
  type        = number
  default     = 2

  validation {
    condition     = var.adb_compute_count >= 2 && var.adb_compute_count <= 512
    error_message = "ADB compute count must be between 2 and 512 ECPUs."
  }
}

variable "adb_storage_tbs" {
  description = "Autonomous Database storage in TB."
  type        = number
  default     = 1

  validation {
    condition     = var.adb_storage_tbs >= 1
    error_message = "ADB storage must be at least 1 TB."
  }
}

variable "adb_admin_password" {
  description = "Optional Autonomous Database ADMIN password. Leave blank to generate a password during deployment."
  type        = string
  default     = null
  nullable    = true
  sensitive   = true

  validation {
    condition = (
      trimspace(var.adb_admin_password == null ? "" : var.adb_admin_password) == "" ||
      (
        can(regex("^[^\\s'\"]{12,30}$", var.adb_admin_password)) &&
        can(regex("[A-Z]", var.adb_admin_password)) &&
        can(regex("[a-z]", var.adb_admin_password)) &&
        can(regex("[0-9]", var.adb_admin_password)) &&
        !can(regex("(?i)admin", var.adb_admin_password))
      )
    )
    error_message = "ADB ADMIN password must be 12-30 characters with an uppercase letter, lowercase letter, and number. Quotes, whitespace, and the word admin are not allowed. Leave it blank to generate a password."
  }
}

variable "model_object_uri" {
  description = "Bundled HTTPS URI for the all-MiniLM-L12-v2 ONNX model loaded into Autonomous Database."
  type        = string
  sensitive   = true
  default     = "https://adwc4pm.objectstorage.us-ashburn-1.oci.customer-oci.com/p/eLddQappgBJ7jNi6Guz9m9LOtYe2u8LWY19GfgU8flFK4N9YgP4kTlrE9Px3pE12/n/adwc4pm/b/OML-Resources/o/all_MiniLM_L12_v2.onnx"

  validation {
    condition = (
      can(regex("^https://[^\\s'\"]+$", var.model_object_uri)) &&
      length(var.model_object_uri) <= 2048
    )
    error_message = "Model object URI must be an approved HTTPS URL without whitespace or quotes."
  }
}

variable "oci_genai_region" {
  description = "OCI Generative AI region that offers Cohere Command A in on-demand mode."
  type        = string
  default     = "us-chicago-1"

  validation {
    condition = contains([
      "ap-hyderabad-1",
      "ap-osaka-1",
      "eu-frankfurt-1",
      "me-riyadh-1",
      "sa-saopaulo-1",
      "uk-london-1",
      "us-chicago-1",
    ], var.oci_genai_region)
    error_message = "Choose a region where Cohere Command A is available in OCI Generative AI on-demand mode."
  }
}

variable "oci_genai_model" {
  description = "OCI Generative AI on-demand model used by the ADB Select AI profile."
  type        = string
  default     = "cohere.command-a-03-2025"

  validation {
    condition     = var.oci_genai_model == "cohere.command-a-03-2025"
    error_message = "This release supports the on-demand cohere.command-a-03-2025 model."
  }
}
