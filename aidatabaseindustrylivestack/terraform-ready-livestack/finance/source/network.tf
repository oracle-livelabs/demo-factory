resource "oci_core_vcn" "stack" {
  compartment_id = var.compartment_ocid
  cidr_block     = local.vcn_cidr
  display_name   = "${local.name_prefix}-vcn"
  dns_label      = "finlive"
  freeform_tags  = local.common_tags
}

resource "oci_core_internet_gateway" "stack" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.stack.id
  display_name   = "${local.name_prefix}-internet-gateway"
  enabled        = true
  freeform_tags  = local.common_tags
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.stack.id
  display_name   = "${local.name_prefix}-public-routes"
  freeform_tags  = local.common_tags

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.stack.id
  }
}

resource "oci_core_security_list" "empty" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.stack.id
  display_name   = "${local.name_prefix}-empty-security-list"
  freeform_tags  = local.common_tags
}

resource "oci_core_subnet" "application" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.stack.id
  cidr_block                 = local.app_subnet_cidr
  display_name               = "${local.name_prefix}-public-subnet"
  dns_label                  = "app"
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.empty.id]
  prohibit_public_ip_on_vnic = false
  freeform_tags              = local.common_tags
}

resource "oci_core_network_security_group" "application" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.stack.id
  display_name   = "${local.name_prefix}-application-nsg"
  freeform_tags  = local.common_tags
}

resource "oci_core_network_security_group_security_rule" "application_http" {
  network_security_group_id = oci_core_network_security_group.application.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.app_ingress_cidr
  source_type               = "CIDR_BLOCK"
  description               = "Finance application access."

  tcp_options {
    destination_port_range {
      min = local.application_port
      max = local.application_port
    }
  }
}

resource "oci_core_network_security_group_security_rule" "application_ssh" {
  network_security_group_id = oci_core_network_security_group.application.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.ssh_ingress_cidr
  source_type               = "CIDR_BLOCK"
  description               = "Restricted operator SSH access."

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

resource "oci_core_network_security_group_security_rule" "outbound_web" {
  for_each = toset(["80", "443"])

  network_security_group_id = oci_core_network_security_group.application.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "Package, image, stack artifact, and OCI service access."

  tcp_options {
    destination_port_range {
      min = tonumber(each.value)
      max = tonumber(each.value)
    }
  }
}

resource "oci_core_network_security_group_security_rule" "outbound_adb" {
  network_security_group_id = oci_core_network_security_group.application.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "mTLS traffic to Autonomous Database."

  tcp_options {
    destination_port_range {
      min = 1522
      max = 1522
    }
  }
}

resource "oci_core_network_security_group_security_rule" "outbound_dns_tcp" {
  network_security_group_id = oci_core_network_security_group.application.id
  direction                 = "EGRESS"
  protocol                  = "6"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "TCP DNS fallback for OCI and software services."

  tcp_options {
    destination_port_range {
      min = 53
      max = 53
    }
  }
}

resource "oci_core_network_security_group_security_rule" "outbound_dns" {
  network_security_group_id = oci_core_network_security_group.application.id
  direction                 = "EGRESS"
  protocol                  = "17"
  destination               = "0.0.0.0/0"
  destination_type          = "CIDR_BLOCK"
  description               = "DNS resolution for OCI and software services."

  udp_options {
    destination_port_range {
      min = 53
      max = 53
    }
  }
}
