# Load Balancer SG — public internet → 80, 443
resource "aws_security_group" "alb" {
  name        = "cloudmart-alb-sg"
  vpc_id      = aws_vpc.main.id
  description = "ALB: allow HTTP/HTTPS from internet"

  ingress { from_port = 80  to_port = 80  protocol = "tcp" cidr_blocks = ["0.0.0.0/0"] description = "HTTP from internet" }
  ingress { from_port = 443 to_port = 443 protocol = "tcp" cidr_blocks = ["0.0.0.0/0"] description = "HTTPS from internet" }
  egress  { from_port = 0   to_port = 0   protocol = "-1"  cidr_blocks = ["0.0.0.0/0"] description = "All outbound" }
  tags = merge(var.common_tags, { Name = "cloudmart-alb-sg" })
}

# EKS Worker Nodes SG
resource "aws_security_group" "eks_nodes" {
  name        = "cloudmart-eks-nodes-sg"
  vpc_id      = aws_vpc.main.id
  description = "EKS worker nodes: allow ALB → node port range, internal node comms"

  ingress { from_port = 1025  to_port = 65535 protocol = "tcp" security_groups = [aws_security_group.alb.id]       description = "ALB to NodePort range" }
  ingress { from_port = 0     to_port = 0      protocol = "-1"  self = true                                         description = "Node-to-node all traffic" }
  ingress { from_port = 22    to_port = 22     protocol = "tcp" security_groups = [aws_security_group.bastion.id]  description = "SSH from bastion only" }
  ingress { from_port = 443   to_port = 443    protocol = "tcp" cidr_blocks = ["10.0.0.0/16"]                      description = "EKS control plane webhooks" }
  egress  { from_port = 0     to_port = 0      protocol = "-1"  cidr_blocks = ["0.0.0.0/0"]                        description = "All outbound (for NAT/VPC endpoints)" }
  tags = merge(var.common_tags, { Name = "cloudmart-eks-nodes-sg" })
}

# RDS (PostgreSQL) SG — only EKS nodes on port 5432
resource "aws_security_group" "rds" {
  name        = "cloudmart-rds-sg"
  vpc_id      = aws_vpc.main.id
  description = "RDS PostgreSQL: only EKS nodes allowed"

  ingress { from_port = 5432 to_port = 5432 protocol = "tcp" security_groups = [aws_security_group.eks_nodes.id] description = "PostgreSQL from EKS nodes only" }
  egress  { from_port = 0    to_port = 0    protocol = "-1"  cidr_blocks = ["0.0.0.0/0"]                        description = "All outbound" }
  tags = merge(var.common_tags, { Name = "cloudmart-rds-sg" })
}

# Bastion Host SG — SSH from your office IP only
resource "aws_security_group" "bastion" {
  name        = "cloudmart-bastion-sg"
  vpc_id      = aws_vpc.main.id
  description = "Bastion: SSH from admin CIDR only"

  ingress { from_port = 22 to_port = 22 protocol = "tcp" cidr_blocks = [var.admin_cidr] description = "SSH from admin IP" }
  egress  { from_port = 0  to_port = 0  protocol = "-1"  cidr_blocks = ["0.0.0.0/0"]   description = "All outbound" }
  tags = merge(var.common_tags, { Name = "cloudmart-bastion-sg" })
}

# VPC Endpoints SG — HTTPS from private subnets
resource "aws_security_group" "vpce" {
  name        = "cloudmart-vpce-sg"
  vpc_id      = aws_vpc.main.id
  description = "VPC Interface Endpoints: HTTPS from private subnets"

  ingress { from_port = 443 to_port = 443 protocol = "tcp" cidr_blocks = ["10.0.11.0/24", "10.0.12.0/24"] description = "HTTPS from private app subnets" }
  egress  { from_port = 0   to_port = 0   protocol = "-1"  cidr_blocks = ["0.0.0.0/0"]                    description = "All outbound" }
  tags = merge(var.common_tags, { Name = "cloudmart-vpce-sg" })
}
