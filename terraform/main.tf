# One VM per OpenTofu workspace (workspace name = intent name).
# Points at LocalStack by default so the demo costs nothing.

terraform {
  required_version = ">= 1.8"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

variable "name" { type = string }
variable "environment" { type = string }
variable "instance_type" { type = string }
variable "owner" { type = string }
variable "ssh_cidr" {
  type    = string
  default = null
}
variable "aws_endpoint" {
  description = "Set to the LocalStack URL; null targets real AWS."
  type        = string
  default     = "http://localhost:4566"
}

provider "aws" {
  region                      = "us-east-1"
  access_key                  = var.aws_endpoint == null ? null : "test"
  secret_key                  = var.aws_endpoint == null ? null : "test"
  skip_credentials_validation = var.aws_endpoint != null
  skip_requesting_account_id  = var.aws_endpoint != null
  skip_metadata_api_check     = var.aws_endpoint != null

  endpoints {
    ec2 = var.aws_endpoint
    sts = var.aws_endpoint
  }
}

locals {
  tags = {
    Name        = var.name
    Owner       = var.owner
    Environment = var.environment
    ManagedBy   = "infra-agent-gateway"
  }
}

resource "aws_security_group" "vm" {
  name = "${var.name}-sg"
  tags = local.tags

  dynamic "ingress" {
    for_each = var.ssh_cidr == null ? [] : [var.ssh_cidr]
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }
}

resource "aws_instance" "vm" {
  ami                    = "ami-df5de72bdb3b" # any id works on LocalStack
  instance_type          = var.instance_type
  vpc_security_group_ids = [aws_security_group.vm.id]
  tags                   = local.tags
}

output "instance_id" { value = aws_instance.vm.id }
