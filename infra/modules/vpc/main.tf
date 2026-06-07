resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = merge(var.common_tags, { Name = "cloudmart-vpc" })
}

# Internet Gateway
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.common_tags, { Name = "cloudmart-igw" })
}

# Public Subnets
resource "aws_subnet" "public" {
  for_each                = { "1a" = "10.0.1.0/24", "1b" = "10.0.2.0/24" }
  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.value
  availability_zone       = "us-east-1${each.key}"
  map_public_ip_on_launch = true
  tags = merge(var.common_tags, {
    Name                     = "cloudmart-public-${each.key}"
    "kubernetes.io/role/elb" = "1"   # Required for ALB controller
  })
}

# Private App Subnets (EKS nodes)
resource "aws_subnet" "private_app" {
  for_each          = { "1a" = "10.0.11.0/24", "1b" = "10.0.12.0/24" }
  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value
  availability_zone = "us-east-1${each.key}"
  tags = merge(var.common_tags, {
    Name                              = "cloudmart-private-app-${each.key}"
    "kubernetes.io/role/internal-elb" = "1"
    "karpenter.sh/discovery"          = "cloudmart-eks"  # For future Karpenter
  })
}

# Private Data Subnets (RDS)
resource "aws_subnet" "private_data" {
  for_each          = { "1a" = "10.0.21.0/24", "1b" = "10.0.22.0/24" }
  vpc_id            = aws_vpc.main.id
  cidr_block        = each.value
  availability_zone = "us-east-1${each.key}"
  tags = merge(var.common_tags, { Name = "cloudmart-private-data-${each.key}" })
}

# Elastic IPs for NAT Gateways (one per AZ)
resource "aws_eip" "nat" {
  for_each = { "1a" = aws_subnet.public["1a"].id, "1b" = aws_subnet.public["1b"].id }
  domain   = "vpc"
  tags     = merge(var.common_tags, { Name = "cloudmart-nat-eip-${each.key}" })
}

# NAT Gateways (one per AZ for HA)
resource "aws_nat_gateway" "nat" {
  for_each      = aws_eip.nat
  allocation_id = each.value.id
  subnet_id     = aws_subnet.public[each.key].id
  tags          = merge(var.common_tags, { Name = "cloudmart-nat-${each.key}" })
}

# Public Route Table
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
  tags = merge(var.common_tags, { Name = "cloudmart-rt-public" })
}

resource "aws_route_table_association" "public" {
  for_each       = aws_subnet.public
  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

# Private App Route Tables (one per AZ → AZ-local NAT GW)
resource "aws_route_table" "private_app" {
  for_each = aws_nat_gateway.nat
  vpc_id   = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = each.value.id
  }
  tags = merge(var.common_tags, { Name = "cloudmart-rt-private-app-${each.key}" })
}

resource "aws_route_table_association" "private_app" {
  for_each       = aws_subnet.private_app
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private_app[each.key].id
}

# Private Data Route Tables (no internet route — data tier is isolated)
resource "aws_route_table" "private_data" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.common_tags, { Name = "cloudmart-rt-private-data" })
}

resource "aws_route_table_association" "private_data" {
  for_each       = aws_subnet.private_data
  subnet_id      = each.value.id
  route_table_id = aws_route_table.private_data.id
}

# VPC Endpoints (private connectivity — eliminates NAT data-transfer cost)
resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.us-east-1.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(
    values(aws_route_table.private_app)[*].id,
    [aws_route_table.private_data.id]
  )
  tags = merge(var.common_tags, { Name = "cloudmart-vpce-dynamodb" })
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.us-east-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = values(aws_route_table.private_app)[*].id
  tags              = merge(var.common_tags, { Name = "cloudmart-vpce-s3" })
}

resource "aws_vpc_endpoint" "secrets_manager" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.us-east-1.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = values(aws_subnet.private_app)[*].id
  security_group_ids  = [aws_security_group.vpce.id]
  private_dns_enabled = true
  tags                = merge(var.common_tags, { Name = "cloudmart-vpce-secretsmanager" })
}

resource "aws_vpc_endpoint" "ecr_api" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.us-east-1.ecr.api"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = values(aws_subnet.private_app)[*].id
  security_group_ids  = [aws_security_group.vpce.id]
  private_dns_enabled = true
  tags                = merge(var.common_tags, { Name = "cloudmart-vpce-ecr-api" })
}

resource "aws_vpc_endpoint" "ecr_dkr" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.us-east-1.ecr.dkr"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = values(aws_subnet.private_app)[*].id
  security_group_ids  = [aws_security_group.vpce.id]
  private_dns_enabled = true
  tags                = merge(var.common_tags, { Name = "cloudmart-vpce-ecr-dkr" })
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  name              = "/aws/vpc/cloudmart-flow-logs"
  retention_in_days = 30
  tags              = var.common_tags
}

resource "aws_flow_log" "main" {
  vpc_id          = aws_vpc.main.id
  traffic_type    = "ALL"
  iam_role_arn    = aws_iam_role.flow_logs.arn
  log_destination = aws_cloudwatch_log_group.flow_logs.arn
  tags            = merge(var.common_tags, { Name = "cloudmart-flow-log" })
}
