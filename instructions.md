# CloudMart — Full AWS Implementation Instructions

> **Target audience:** Agentic executor (human or AI agent).  
> All architectural decisions are pre-made. Follow every section in order.  
> Do **not** skip steps — later sections depend on earlier ones.

---

## Pre-flight Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Cloud provider | AWS (us-east-1, multi-AZ) | Widest Free Tier, richest managed services |
| Availability zones | us-east-1a, us-east-1b | Two AZs for HA; cost-balanced |
| Kubernetes | EKS 1.29 (managed node groups) | Managed control plane, native IRSA |
| Node instance type | t3.medium (2 vCPU, 4 GB RAM) | General-purpose; fits all 5 services |
| Node group size | min 2 / desired 2 / max 6 | Cost-controlled; cluster autoscaler handles scale-out |
| Relational DB | RDS PostgreSQL 15 db.t3.micro | Free-tier eligible; user-service |
| NoSQL DB | DynamoDB (on-demand) | Serverless pricing; product-service |
| Message queue | SQS Standard Queue | Free tier 1M requests/month |
| Email service | Amazon SES (sandbox) | Free 200 emails/day in sandbox |
| Container registry | ECR (one repo per service) | Native IAM auth; lifecycle policies |
| IaC tool | Terraform 1.7 | HCL; state in S3 + DynamoDB lock |
| K8s manifest mgmt | Helm 3 | values-staging.yaml / values-prod.yaml |
| CI/CD | GitHub Actions | Native; no extra cost |
| Secrets | AWS Secrets Manager + External Secrets Operator | K8s-native pull |
| Policy engine | Kyverno | Simpler than OPA/Gatekeeper for this scope |
| Autoscaler | Kubernetes Cluster Autoscaler | Native EKS support |
| KEDA | Enabled for notification-service | SQS scaler |
| Canary | Argo Rollouts for product-service | Metric gate via CloudWatch |
| Tracing | AWS X-Ray | Native integration |
| GitOps | ArgoCD | Watches main + develop branches |
| Terraform state | S3 bucket + DynamoDB table | Standard pattern |

---

## Repository Layout

Create this layout before writing any code:

```
cloudmart/
├── infra/
│   ├── modules/
│   │   ├── vpc/
│   │   ├── eks/
│   │   ├── rds/
│   │   ├── dynamodb/
│   │   ├── sqs/
│   │   ├── ecr/
│   │   ├── ses/
│   │   ├── kms/
│   │   ├── secrets/
│   │   └── monitoring/
│   ├── environments/
│   │   ├── staging/
│   │   │   ├── main.tf
│   │   │   ├── variables.tf
│   │   │   └── terraform.tfvars
│   │   └── prod/
│   │       ├── main.tf
│   │       ├── variables.tf
│   │       └── terraform.tfvars
│   └── backend.tf
├── k8s/
│   ├── charts/
│   │   ├── product-service/
│   │   ├── order-service/
│   │   ├── user-service/
│   │   ├── notification-service/
│   │   └── frontend/
│   ├── base/
│   │   ├── namespaces.yaml
│   │   ├── network-policies/
│   │   └── kyverno-policies/
│   └── argocd/
│       ├── install.yaml
│       └── applications/
├── services/
│   ├── product-service/
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   └── src/
│   ├── order-service/
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   └── src/
│   ├── user-service/
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   └── src/
│   ├── notification-service/
│   │   ├── Dockerfile
│   │   ├── .dockerignore
│   │   └── src/
│   └── frontend/
│       ├── Dockerfile
│       ├── .dockerignore
│       └── src/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── cd.yml
└── docs/
    └── adr/
        ├── ADR-001-node-instance-type.md
        ├── ADR-002-database-user-service.md
        └── ADR-003-deployment-strategy-product-service.md
```

---

## Phase 0 — Bootstrap (do this once, manually)

### 0.1 Install tooling

```bash
# Terraform
curl -fsSL https://apt.releases.hashicorp.com/gpg | gpg --dearmor > /usr/share/keyrings/hashicorp.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" > /etc/apt/sources.list.d/hashicorp.list
apt update && apt install terraform

# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip
unzip awscliv2.zip && ./aws/install

# kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Helm 3
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# eksctl
curl --silent --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" | tar xz -C /tmp
mv /tmp/eksctl /usr/local/bin

# Trivy
apt install wget apt-transport-https gnupg
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | apt-key add -
echo "deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main" > /etc/apt/sources.list.d/trivy.list
apt update && apt install trivy

# ArgoCD CLI
curl -sSL -o /usr/local/bin/argocd https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
chmod +x /usr/local/bin/argocd
```

### 0.2 AWS credentials

```bash
aws configure
# AWS Access Key ID:     <your key>
# AWS Secret Access Key: <your secret>
# Default region name:   us-east-1
# Default output format: json
```

### 0.3 Terraform state backend (create before `terraform init`)

```bash
# Create S3 bucket for state
aws s3api create-bucket \
  --bucket cloudmart-tfstate-<your-group-id> \
  --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket cloudmart-tfstate-<your-group-id> \
  --versioning-configuration Status=Enabled

# Enable server-side encryption
aws s3api put-bucket-encryption \
  --bucket cloudmart-tfstate-<your-group-id> \
  --server-side-encryption-configuration '{
    "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name cloudmart-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Create `infra/backend.tf`:

```hcl
terraform {
  backend "s3" {
    bucket         = "cloudmart-tfstate-<your-group-id>"
    key            = "cloudmart/${terraform.workspace}/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cloudmart-tfstate-lock"
    encrypt        = true
  }
}
```

---

## Phase 1 — Terraform: Networking (VPC Module)

### Decision: VPC CIDR and Subnet Layout

| Subnet | CIDR | AZ | Purpose |
|---|---|---|---|
| VPC | 10.0.0.0/16 | — | All resources |
| public-1a | 10.0.1.0/24 | us-east-1a | ALB, NAT GW, Bastion |
| public-1b | 10.0.2.0/24 | us-east-1b | ALB |
| private-app-1a | 10.0.11.0/24 | us-east-1a | EKS worker nodes |
| private-app-1b | 10.0.12.0/24 | us-east-1b | EKS worker nodes |
| private-data-1a | 10.0.21.0/24 | us-east-1a | RDS primary |
| private-data-1b | 10.0.22.0/24 | us-east-1b | RDS standby |

Create `infra/modules/vpc/main.tf`:

```hcl
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
```

### Security Groups

Create `infra/modules/vpc/security_groups.tf`:

```hcl
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
```

Enable VPC Flow Logs:

```hcl
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
```

---

## Phase 2 — Terraform: KMS, Secrets Manager, ECR

### KMS Key (for RDS encryption + Secrets Manager)

Create `infra/modules/kms/main.tf`:

```hcl
resource "aws_kms_key" "cloudmart" {
  description             = "CloudMart master encryption key"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                    = var.common_tags
}

resource "aws_kms_alias" "cloudmart" {
  name          = "alias/cloudmart"
  target_key_id = aws_kms_key.cloudmart.key_id
}
```

### ECR Repositories

Create `infra/modules/ecr/main.tf`:

```hcl
locals {
  services = ["product-service", "order-service", "user-service", "notification-service", "frontend"]
}

resource "aws_ecr_repository" "services" {
  for_each             = toset(local.services)
  name                 = "cloudmart/${each.key}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration { scan_on_push = true }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.kms_key_arn
  }

  tags = var.common_tags
}

# Lifecycle policy: keep last 10 images per repo
resource "aws_ecr_lifecycle_policy" "services" {
  for_each   = aws_ecr_repository.services
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}
```

### Secrets Manager

Create `infra/modules/secrets/main.tf`:

```hcl
resource "aws_secretsmanager_secret" "rds_credentials" {
  name       = "cloudmart/rds/user-service"
  kms_key_id = var.kms_key_arn
  tags       = var.common_tags
}

resource "aws_secretsmanager_secret_version" "rds_credentials" {
  secret_id = aws_secretsmanager_secret.rds_credentials.id
  secret_string = jsonencode({
    username = "cloudmart_user"
    password = var.db_password   # Pass as a sensitive variable
    host     = var.rds_endpoint
    port     = 5432
    dbname   = "cloudmart"
  })
}

resource "aws_secretsmanager_secret" "ses_credentials" {
  name       = "cloudmart/ses/smtp"
  kms_key_id = var.kms_key_arn
  tags       = var.common_tags
}
```

---

## Phase 3 — Terraform: RDS, DynamoDB, SQS, SES

### RDS PostgreSQL (user-service)

Create `infra/modules/rds/main.tf`:

```hcl
resource "aws_db_subnet_group" "main" {
  name       = "cloudmart-rds-subnet-group"
  subnet_ids = var.data_subnet_ids
  tags       = var.common_tags
}

resource "aws_db_instance" "postgres" {
  identifier             = "cloudmart-postgres"
  engine                 = "postgres"
  engine_version         = "15.4"
  instance_class         = "db.t3.micro"
  allocated_storage      = 20
  max_allocated_storage  = 100
  storage_type           = "gp2"
  storage_encrypted      = true
  kms_key_id             = var.kms_key_arn

  db_name  = "cloudmart"
  username = "cloudmart_user"
  password = var.db_password   # Sensitive variable

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.rds_sg_id]
  multi_az               = var.environment == "prod" ? true : false
  publicly_accessible    = false

  backup_retention_period    = 7
  backup_window              = "02:00-03:00"
  maintenance_window         = "sun:04:00-sun:05:00"
  deletion_protection        = var.environment == "prod" ? true : false
  skip_final_snapshot        = var.environment == "prod" ? false : true
  final_snapshot_identifier  = "cloudmart-postgres-final-${var.environment}"

  performance_insights_enabled = true
  monitoring_interval          = 60
  monitoring_role_arn          = aws_iam_role.rds_monitoring.arn

  tags = var.common_tags
}
```

### DynamoDB (product-service)

Create `infra/modules/dynamodb/main.tf`:

```hcl
resource "aws_dynamodb_table" "products" {
  name         = "cloudmart-products"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "productId"

  attribute { name = "productId" type = "S" }
  attribute { name = "category"  type = "S" }

  global_secondary_index {
    name            = "CategoryIndex"
    hash_key        = "category"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  point_in_time_recovery { enabled = true }
  tags = var.common_tags
}
```

### SQS (order events)

Create `infra/modules/sqs/main.tf`:

```hcl
resource "aws_sqs_queue" "orders_dlq" {
  name                      = "cloudmart-orders-dlq"
  message_retention_seconds = 1209600   # 14 days
  kms_master_key_id         = var.kms_key_arn
  tags                      = var.common_tags
}

resource "aws_sqs_queue" "orders" {
  name                       = "cloudmart-orders"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 86400
  kms_master_key_id          = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.orders_dlq.arn
    maxReceiveCount     = 3
  })

  tags = var.common_tags
}

output "queue_url" { value = aws_sqs_queue.orders.url }
output "queue_arn" { value = aws_sqs_queue.orders.arn }
```

### SES (email notifications)

Create `infra/modules/ses/main.tf`:

```hcl
resource "aws_ses_domain_identity" "cloudmart" {
  domain = var.ses_domain   # e.g. "cloudmart.internal" or verified domain
}

# For sandbox: verify a specific email address instead of domain
resource "aws_ses_email_identity" "test" {
  email = var.ses_test_email   # e.g. your group email
}
```

---

## Phase 4 — Terraform: EKS Cluster

Create `infra/modules/eks/main.tf`:

```hcl
# EKS Cluster IAM Role
resource "aws_iam_role" "eks_cluster" {
  name = "cloudmart-eks-cluster-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow" Principal = { Service = "eks.amazonaws.com" } Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

# EKS Cluster
resource "aws_eks_cluster" "main" {
  name     = "cloudmart-eks"
  version  = "1.29"
  role_arn = aws_iam_role.eks_cluster.arn

  vpc_config {
    subnet_ids              = concat(values(var.private_app_subnet_ids), values(var.public_subnet_ids))
    security_group_ids      = [var.eks_nodes_sg_id]
    endpoint_private_access = true
    endpoint_public_access  = true   # Set false after bastion is in use
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  encryption_config {
    resources = ["secrets"]
    provider  { key_arn = var.kms_key_arn }
  }

  tags = var.common_tags
}

# EKS Node Group IAM Role
resource "aws_iam_role" "eks_nodes" {
  name = "cloudmart-eks-nodes-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow" Principal = { Service = "ec2.amazonaws.com" } Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "eks_worker_node" {
  for_each = toset([
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
    "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
  ])
  role       = aws_iam_role.eks_nodes.name
  policy_arn = each.value
}

# Managed Node Group
resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "cloudmart-nodes"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = values(var.private_app_subnet_ids)

  instance_types = ["t3.medium"]

  scaling_config {
    desired_size = 2
    min_size     = 2
    max_size     = 6
  }

  update_config { max_unavailable = 1 }

  # Enable IMDSv2 — harden instance metadata
  launch_template {
    id      = aws_launch_template.eks_nodes.id
    version = aws_launch_template.eks_nodes.latest_version
  }

  tags = var.common_tags
}

resource "aws_launch_template" "eks_nodes" {
  name_prefix = "cloudmart-eks-nodes-"

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"   # IMDSv2 enforced
    http_put_response_hop_limit = 1
  }

  tag_specifications {
    resource_type = "instance"
    tags          = var.common_tags
  }
}

# OIDC Provider for IRSA (IAM Roles for Service Accounts)
data "tls_certificate" "eks" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer
  tags            = var.common_tags
}
```

### IRSA — Per-Service IAM Roles

Create `infra/modules/eks/irsa.tf`:

```hcl
locals {
  oidc_issuer = replace(aws_eks_cluster.main.identity[0].oidc[0].issuer, "https://", "")
}

# product-service: DynamoDB read/write on products table only
resource "aws_iam_role" "product_service" {
  name = "cloudmart-product-service-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.eks.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_issuer}:sub" = "system:serviceaccount:cloudmart-prod:product-service"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "product_service" {
  name = "cloudmart-product-service-policy"
  role = aws_iam_role.product_service.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Scan","dynamodb:Query"]
      Resource = [var.dynamodb_products_arn, "${var.dynamodb_products_arn}/index/*"]
    }]
  })
}

# order-service: SQS send/receive on orders queue only
resource "aws_iam_role" "order_service" {
  name = "cloudmart-order-service-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.eks.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_issuer}:sub" = "system:serviceaccount:cloudmart-prod:order-service"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "order_service" {
  name = "cloudmart-order-service-policy"
  role = aws_iam_role.order_service.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sqs:SendMessage","sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueAttributes"]
      Resource = var.sqs_orders_queue_arn
    }]
  })
}

# notification-service: SQS receive/delete + SES send
resource "aws_iam_role" "notification_service" {
  name = "cloudmart-notification-service-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.eks.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_issuer}:sub" = "system:serviceaccount:cloudmart-prod:notification-service"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "notification_service" {
  name = "cloudmart-notification-service-policy"
  role = aws_iam_role.notification_service.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage","sqs:DeleteMessage","sqs:GetQueueAttributes"]
        Resource = var.sqs_orders_queue_arn
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail","ses:SendRawEmail"]
        Resource = "*"
      }
    ]
  })
}

# user-service: Secrets Manager read-only on RDS credentials secret only
resource "aws_iam_role" "user_service" {
  name = "cloudmart-user-service-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.eks.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_issuer}:sub" = "system:serviceaccount:cloudmart-prod:user-service"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "user_service" {
  name = "cloudmart-user-service-policy"
  role = aws_iam_role.user_service.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue","secretsmanager:DescribeSecret"]
      Resource = var.rds_secret_arn
    }]
  })
}
```

---

## Phase 5 — Terraform: Monitoring (CloudWatch)

Create `infra/modules/monitoring/main.tf`:

```hcl
# CloudWatch Container Insights on EKS
resource "aws_cloudwatch_log_group" "eks_containers" {
  for_each          = toset(["product-service", "order-service", "user-service", "notification-service", "frontend"])
  name              = "/cloudmart/services/${each.key}"
  retention_in_days = 30
  tags              = var.common_tags
}

# Alarm: product-service error rate > 5% over 5 min
resource "aws_cloudwatch_metric_alarm" "product_error_rate" {
  alarm_name          = "cloudmart-product-service-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5xxErrorRate"
  namespace           = "CloudMart/Services"
  period              = 300
  statistic           = "Average"
  threshold           = 5
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  dimensions          = { Service = "product-service" }
  tags                = var.common_tags
}

# SNS Topic for alerts
resource "aws_sns_topic" "alerts" {
  name = "cloudmart-alerts"
  tags = var.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Budget alert
resource "aws_budgets_budget" "monthly" {
  name         = "cloudmart-monthly-budget"
  budget_type  = "COST"
  limit_amount = "50"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
```

---

## Phase 6 — Terraform Apply Order

```bash
cd infra/environments/prod

# Initialize
terraform init

# Plan and apply in dependency order:
terraform apply -target=module.kms
terraform apply -target=module.vpc
terraform apply -target=module.ecr
terraform apply -target=module.secrets
terraform apply -target=module.rds
terraform apply -target=module.dynamodb
terraform apply -target=module.sqs
terraform apply -target=module.ses
terraform apply -target=module.eks
terraform apply -target=module.monitoring
terraform apply   # Final apply for anything remaining
```

---

## Phase 7 — Dockerfiles

### 7.1 product-service (Python/Flask)

`services/product-service/Dockerfile`:

```dockerfile
# --- Build stage ---
FROM python:3.11-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# --- Runtime stage ---
FROM python:3.11-slim
WORKDIR /app

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

COPY --from=builder /root/.local /home/appuser/.local
COPY src/ .

ENV PATH="/home/appuser/.local/bin:$PATH"
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

USER appuser
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8001/health')"

CMD ["gunicorn", "--bind", "0.0.0.0:8001", "--workers", "2", "app:app"]
```

`services/product-service/.dockerignore`:
```
__pycache__
*.pyc
*.pyo
.git
.pytest_cache
tests/
*.egg-info
.env
```

### 7.2 order-service (Node.js/Express)

`services/order-service/Dockerfile`:

```dockerfile
# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci --only=production

# --- Runtime stage ---
FROM node:20-alpine
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /build/node_modules ./node_modules
COPY src/ .

USER appuser
EXPOSE 8002
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8002/health || exit 1

CMD ["node", "server.js"]
```

`services/order-service/.dockerignore`:
```
node_modules
.git
.env
tests/
*.test.js
coverage/
```

### 7.3 user-service (Python/Flask)

```dockerfile
# --- Build stage ---
FROM python:3.11-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# --- Runtime stage ---
FROM python:3.11-slim
WORKDIR /app

RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser

COPY --from=builder /root/.local /home/appuser/.local
COPY src/ .

ENV PATH="/home/appuser/.local/bin:$PATH"
USER appuser
EXPOSE 8003
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8003/health')"

CMD ["gunicorn", "--bind", "0.0.0.0:8003", "--workers", "2", "app:app"]
```

### 7.4 notification-service (Node.js)

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci --only=production

FROM node:20-alpine
WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /build/node_modules ./node_modules
COPY src/ .

USER appuser
# No EXPOSE — no inbound HTTP traffic
HEALTHCHECK --interval=60s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "process.exit(0)"

CMD ["node", "consumer.js"]
```

### 7.5 frontend (React/Nginx)

```dockerfile
# --- Build stage ---
FROM node:20-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime stage ---
FROM nginx:alpine
WORKDIR /usr/share/nginx/html

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /usr/share/nginx/html /var/cache/nginx /var/run /var/log/nginx

COPY --from=builder /build/dist .
COPY nginx.conf /etc/nginx/conf.d/default.conf

USER appuser
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

`services/frontend/nginx.conf`:
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /health { return 200 "ok"; add_header Content-Type text/plain; }
    location /api/products { proxy_pass http://product-service:8001; }
    location /api/orders   { proxy_pass http://order-service:8002; }
    location /api/users    { proxy_pass http://user-service:8003; }
    location / { try_files $uri $uri/ /index.html; }
}
```

---

## Phase 8 — Build & Push Images to ECR

```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export ECR_BASE="${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com"
export COMMIT_SHA=$(git rev-parse --short HEAD)

# Authenticate Docker to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin ${ECR_BASE}

# Build and push each service
for SERVICE in product-service order-service user-service notification-service frontend; do
  docker build -t cloudmart/${SERVICE}:${COMMIT_SHA} services/${SERVICE}/
  docker tag cloudmart/${SERVICE}:${COMMIT_SHA} ${ECR_BASE}/cloudmart/${SERVICE}:${COMMIT_SHA}
  docker tag cloudmart/${SERVICE}:${COMMIT_SHA} ${ECR_BASE}/cloudmart/${SERVICE}:latest
  docker push ${ECR_BASE}/cloudmart/${SERVICE}:${COMMIT_SHA}
  docker push ${ECR_BASE}/cloudmart/${SERVICE}:latest
done
```

---

## Phase 9 — Connect kubectl to EKS

```bash
aws eks update-kubeconfig \
  --region us-east-1 \
  --name cloudmart-eks

kubectl get nodes   # Verify 2 nodes are Ready
```

---

## Phase 10 — Kubernetes Base Manifests

### Namespaces

`k8s/base/namespaces.yaml`:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: cloudmart-prod
  labels:
    environment: prod
    project: cloudmart
---
apiVersion: v1
kind: Namespace
metadata:
  name: cloudmart-staging
  labels:
    environment: staging
    project: cloudmart
```

```bash
kubectl apply -f k8s/base/namespaces.yaml
```

### Install AWS Load Balancer Controller

```bash
# Add IAM policy for ALB controller
curl -o alb-iam-policy.json \
  https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/main/docs/install/iam_policy.json

aws iam create-policy \
  --policy-name AWSLoadBalancerControllerIAMPolicy \
  --policy-document file://alb-iam-policy.json

# Create service account with IRSA
eksctl create iamserviceaccount \
  --cluster=cloudmart-eks \
  --namespace=kube-system \
  --name=aws-load-balancer-controller \
  --attach-policy-arn=arn:aws:iam::${AWS_ACCOUNT_ID}:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# Install via Helm
helm repo add eks https://aws.github.io/eks-charts
helm repo update
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=cloudmart-eks \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set region=us-east-1 \
  --set vpcId=$(terraform -chdir=infra/environments/prod output -raw vpc_id)
```

### Install External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  -n external-secrets-system \
  --create-namespace
```

### Install Cluster Autoscaler

```bash
helm repo add autoscaler https://kubernetes.github.io/autoscaler
helm install cluster-autoscaler autoscaler/cluster-autoscaler \
  -n kube-system \
  --set autoDiscovery.clusterName=cloudmart-eks \
  --set awsRegion=us-east-1 \
  --set rbac.serviceAccount.annotations."eks\.amazonaws\.com/role-arn"="arn:aws:iam::${AWS_ACCOUNT_ID}:role/cloudmart-cluster-autoscaler-role"
```

### Install KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda --namespace keda --create-namespace
```

### Install Kyverno (policy engine)

```bash
helm repo add kyverno https://kyverno.github.io/kyverno/
helm install kyverno kyverno/kyverno --namespace kyverno --create-namespace
```

### Install Argo Rollouts

```bash
kubectl create namespace argo-rollouts
kubectl apply -n argo-rollouts \
  -f https://github.com/argoproj/argo-rollouts/releases/latest/download/install.yaml
```

### Install ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# Expose ArgoCD (port-forward for demo; use Ingress in prod)
kubectl port-forward svc/argocd-server -n argocd 8080:443

# Get initial password
kubectl get secret argocd-initial-admin-secret -n argocd \
  -o jsonpath="{.data.password}" | base64 -d
```

---

## Phase 11 — Helm Chart Structure (one chart per service)

Create each chart with this structure (shown for product-service; repeat for all five):

```
k8s/charts/product-service/
├── Chart.yaml
├── values.yaml             # base defaults
├── values-staging.yaml
├── values-prod.yaml
└── templates/
    ├── deployment.yaml
    ├── service.yaml
    ├── serviceaccount.yaml
    ├── hpa.yaml
    ├── pdb.yaml
    ├── configmap.yaml
    └── externalsecret.yaml
```

`k8s/charts/product-service/Chart.yaml`:

```yaml
apiVersion: v2
name: product-service
description: CloudMart Product Service
version: 0.1.0
appVersion: "1.0.0"
```

`k8s/charts/product-service/values.yaml`:

```yaml
image:
  repository: <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/cloudmart/product-service
  tag: latest
  pullPolicy: IfNotPresent

replicaCount: 2

service:
  type: ClusterIP
  port: 8001

resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "512Mi"

hpa:
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 60

config:
  dynamodbTableName: cloudmart-products
  awsRegion: us-east-1

serviceAccount:
  irsaRoleArn: ""   # Override in values-prod.yaml

namespace: cloudmart-prod
```

`k8s/charts/product-service/templates/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: product-service
  namespace: {{ .Values.namespace }}
  labels:
    app: product-service
    project: cloudmart
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: product-service
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: product-service
    spec:
      serviceAccountName: product-service
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
      containers:
        - name: product-service
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - containerPort: 8001
          env:
            - name: DYNAMODB_TABLE
              valueFrom:
                configMapKeyRef:
                  name: product-service-config
                  key: dynamodbTableName
            - name: AWS_REGION
              valueFrom:
                configMapKeyRef:
                  name: product-service-config
                  key: awsRegion
          resources:
            requests:
              cpu: {{ .Values.resources.requests.cpu }}
              memory: {{ .Values.resources.requests.memory }}
            limits:
              cpu: {{ .Values.resources.limits.cpu }}
              memory: {{ .Values.resources.limits.memory }}
          livenessProbe:
            httpGet:
              path: /health
              port: 8001
            initialDelaySeconds: 15
            periodSeconds: 20
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 8001
            initialDelaySeconds: 5
            periodSeconds: 10
            failureThreshold: 3
```

`k8s/charts/product-service/templates/hpa.yaml`:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: product-service-hpa
  namespace: {{ .Values.namespace }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: product-service
  minReplicas: {{ .Values.hpa.minReplicas }}
  maxReplicas: {{ .Values.hpa.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.hpa.targetCPUUtilizationPercentage }}
```

`k8s/charts/product-service/templates/pdb.yaml`:

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: product-service-pdb
  namespace: {{ .Values.namespace }}
spec:
  minAvailable: 1
  selector:
    matchLabels:
      app: product-service
```

`k8s/charts/product-service/templates/externalsecret.yaml` (for user-service only):

```yaml
# Only needed for user-service — other services use IRSA directly
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: user-service-db-secret
  namespace: {{ .Values.namespace }}
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: user-service-db-credentials
    creationPolicy: Owner
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: cloudmart/rds/user-service
        property: password
    - secretKey: DB_HOST
      remoteRef:
        key: cloudmart/rds/user-service
        property: host
```

### KEDA ScaledObject for notification-service

`k8s/charts/notification-service/templates/scaledobject.yaml`:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: notification-service-scaler
  namespace: {{ .Values.namespace }}
spec:
  scaleTargetRef:
    name: notification-service
  minReplicaCount: 1
  maxReplicaCount: 10
  triggers:
    - type: aws-sqs-queue
      metadata:
        queueURL: {{ .Values.config.sqsQueueUrl }}
        queueLength: "5"
        awsRegion: us-east-1
      authenticationRef:
        name: keda-sqs-auth
```

---

## Phase 12 — Ingress (Frontend → ALB)

`k8s/charts/frontend/templates/ingress.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: cloudmart-ingress
  namespace: cloudmart-prod
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTP": 80}, {"HTTPS": 443}]'
    alb.ingress.kubernetes.io/ssl-redirect: "443"
    alb.ingress.kubernetes.io/certificate-arn: "arn:aws:acm:us-east-1:<account>:<cert-arn>"
    alb.ingress.kubernetes.io/wafv2-acl-arn: "arn:aws:wafv2:us-east-1:<account>:regional/webacl/cloudmart-waf/<id>"
    alb.ingress.kubernetes.io/healthcheck-path: /health
    alb.ingress.kubernetes.io/load-balancer-attributes: "routing.http2.enabled=true"
spec:
  rules:
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
```

---

## Phase 13 — NetworkPolicies

`k8s/base/network-policies/default-deny.yaml`:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-all
  namespace: cloudmart-prod
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

`k8s/base/network-policies/allow-policies.yaml`:

```yaml
# frontend → product-service (port 8001)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-product
  namespace: cloudmart-prod
spec:
  podSelector:
    matchLabels:
      app: product-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8001
---
# frontend → order-service (port 8002)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-order
  namespace: cloudmart-prod
spec:
  podSelector:
    matchLabels:
      app: order-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8002
---
# frontend → user-service (port 8003)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-user
  namespace: cloudmart-prod
spec:
  podSelector:
    matchLabels:
      app: user-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8003
---
# order-service → product-service (ClusterIP, port 8001)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-order-to-product
  namespace: cloudmart-prod
spec:
  podSelector:
    matchLabels:
      app: product-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: order-service
      ports:
        - protocol: TCP
          port: 8001
---
# Allow all pods egress to AWS managed services (SQS, DynamoDB via VPC endpoints)
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-egress-aws-services
  namespace: cloudmart-prod
spec:
  podSelector: {}
  policyTypes:
    - Egress
  egress:
    - ports:
        - protocol: TCP
          port: 443    # HTTPS to VPC endpoints / AWS APIs
    - ports:
        - protocol: TCP
          port: 5432   # PostgreSQL to RDS (data subnet)
    - ports:
        - protocol: TCP
          port: 53    # DNS
      ports:
        - protocol: UDP
          port: 53
```

---

## Phase 14 — Kyverno Policies

`k8s/base/kyverno-policies/restrict-root.yaml`:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: require-non-root
spec:
  validationFailureAction: enforce
  rules:
    - name: check-runAsNonRoot
      match:
        resources:
          kinds: [Pod]
          namespaces: [cloudmart-prod, cloudmart-staging]
      validate:
        message: "Containers must not run as root."
        pattern:
          spec:
            securityContext:
              runAsNonRoot: true
---
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: disallow-privileged
spec:
  validationFailureAction: enforce
  rules:
    - name: check-privileged
      match:
        resources:
          kinds: [Pod]
          namespaces: [cloudmart-prod, cloudmart-staging]
      validate:
        message: "Privileged containers are not allowed."
        pattern:
          spec:
            containers:
              - =(securityContext):
                  =(privileged): "false"
---
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: restrict-image-registry
spec:
  validationFailureAction: enforce
  rules:
    - name: check-registry
      match:
        resources:
          kinds: [Pod]
          namespaces: [cloudmart-prod, cloudmart-staging]
      validate:
        message: "Images must be pulled from the CloudMart ECR registry only."
        pattern:
          spec:
            containers:
              - image: "<AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/cloudmart/*"
```

---

## Phase 15 — Argo Rollouts (product-service canary)

Replace product-service `Deployment` with a `Rollout`:

`k8s/charts/product-service/templates/rollout.yaml`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: product-service
  namespace: cloudmart-prod
spec:
  replicas: 2
  selector:
    matchLabels:
      app: product-service
  template:
    # (same pod spec as Deployment template above)
    metadata:
      labels:
        app: product-service
    spec:
      # ... identical to deployment.yaml spec
  strategy:
    canary:
      steps:
        - setWeight: 20
        - pause: { duration: 2m }
        - setWeight: 50
        - pause: { duration: 2m }
        - setWeight: 100
      analysis:
        templates:
          - templateName: product-error-rate
        startingStep: 1
        args:
          - name: service-name
            value: product-service
---
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: product-error-rate
  namespace: cloudmart-prod
spec:
  args:
    - name: service-name
  metrics:
    - name: error-rate
      interval: 1m
      failureLimit: 1
      provider:
        cloudWatch:
          interval: 1m
          metricDataQueries:
            - id: errors
              metricStat:
                metric:
                  namespace: CloudMart/Services
                  metricName: 5xxErrorRate
                  dimensions:
                    - name: Service
                      value: "{{args.service-name}}"
                period: 60
                stat: Average
      successCondition: result[0] <= 1   # Halt if error rate > 1%
```

---

## Phase 16 — ArgoCD Applications

`k8s/argocd/applications/cloudmart-prod.yaml`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cloudmart-prod
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/<your-org>/cloudmart.git
    targetRevision: main
    path: k8s/charts
    helm:
      valueFiles:
        - values-prod.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: cloudmart-prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
---
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: cloudmart-staging
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/<your-org>/cloudmart.git
    targetRevision: develop
    path: k8s/charts
    helm:
      valueFiles:
        - values-staging.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: cloudmart-staging
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

```bash
kubectl apply -f k8s/argocd/applications/
```

---

## Phase 17 — CI/CD Pipeline (GitHub Actions)

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, develop, "feature/**"]
  pull_request:
    branches: [main, develop]

env:
  AWS_REGION: us-east-1
  ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.us-east-1.amazonaws.com

jobs:
  test:
    name: Lint & Unit Tests
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [product-service, user-service, order-service, notification-service, frontend]
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python (Python services)
        if: matrix.service == 'product-service' || matrix.service == 'user-service'
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Set up Node (Node services)
        if: matrix.service == 'order-service' || matrix.service == 'notification-service' || matrix.service == 'frontend'
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies & lint (Python)
        if: matrix.service == 'product-service' || matrix.service == 'user-service'
        working-directory: services/${{ matrix.service }}
        run: |
          pip install -r requirements.txt
          pip install flake8 pytest
          flake8 src/
          pytest tests/ -v

      - name: Install dependencies & lint (Node)
        if: matrix.service == 'order-service' || matrix.service == 'notification-service' || matrix.service == 'frontend'
        working-directory: services/${{ matrix.service }}
        run: |
          npm ci
          npm run lint
          npm test

  build-scan-push:
    name: Build, Scan & Push
    runs-on: ubuntu-latest
    needs: test
    strategy:
      matrix:
        service: [product-service, user-service, order-service, notification-service, frontend]
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/cloudmart-github-actions-role
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build image
        working-directory: services/${{ matrix.service }}
        run: |
          docker build -t $ECR_REGISTRY/cloudmart/${{ matrix.service }}:${{ github.sha }} .

      - name: Trivy vulnerability scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.ECR_REGISTRY }}/cloudmart/${{ matrix.service }}:${{ github.sha }}
          format: table
          exit-code: 1          # Fail pipeline on CRITICAL
          severity: CRITICAL

      - name: Push to ECR
        run: |
          docker push $ECR_REGISTRY/cloudmart/${{ matrix.service }}:${{ github.sha }}
          docker tag $ECR_REGISTRY/cloudmart/${{ matrix.service }}:${{ github.sha }} \
                     $ECR_REGISTRY/cloudmart/${{ matrix.service }}:latest
          docker push $ECR_REGISTRY/cloudmart/${{ matrix.service }}:latest

  validate-manifests:
    name: Validate K8s Manifests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install kubeconform
        run: |
          curl -L https://github.com/yannh/kubeconform/releases/latest/download/kubeconform-linux-amd64.tar.gz | tar xz
          mv kubeconform /usr/local/bin/
      - name: Validate manifests
        run: |
          find k8s/ -name "*.yaml" | xargs kubeconform -strict -summary
```

`.github/workflows/cd.yml`:

```yaml
name: CD

on:
  push:
    branches: [main, develop]

env:
  AWS_REGION: us-east-1
  ECR_REGISTRY: ${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.us-east-1.amazonaws.com

jobs:
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop'
    environment: staging
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/cloudmart-github-actions-role
          aws-region: ${{ env.AWS_REGION }}

      - name: Update kubeconfig
        run: aws eks update-kubeconfig --name cloudmart-eks --region $AWS_REGION

      - name: Deploy to staging via Helm
        run: |
          for SERVICE in product-service order-service user-service notification-service frontend; do
            helm upgrade --install $SERVICE k8s/charts/$SERVICE \
              --namespace cloudmart-staging \
              --values k8s/charts/$SERVICE/values-staging.yaml \
              --set image.tag=${{ github.sha }} \
              --wait --timeout 5m
          done

      - name: Smoke tests
        run: |
          STAGING_URL=$(kubectl get ingress cloudmart-ingress -n cloudmart-staging -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
          curl -f http://${STAGING_URL}/health || exit 1
          curl -f http://${STAGING_URL}/api/products/health || exit 1
          curl -f http://${STAGING_URL}/api/orders/health || exit 1
          curl -f http://${STAGING_URL}/api/users/health || exit 1

  deploy-prod:
    name: Deploy to Production
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    environment: production      # Requires manual approval in GitHub environment settings
    needs: []
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/cloudmart-github-actions-role
          aws-region: ${{ env.AWS_REGION }}

      - name: Update kubeconfig
        run: aws eks update-kubeconfig --name cloudmart-eks --region $AWS_REGION

      - name: Deploy to production via Helm
        run: |
          for SERVICE in order-service user-service notification-service frontend; do
            helm upgrade --install $SERVICE k8s/charts/$SERVICE \
              --namespace cloudmart-prod \
              --values k8s/charts/$SERVICE/values-prod.yaml \
              --set image.tag=${{ github.sha }} \
              --wait --timeout 5m
          done
          # product-service uses Argo Rollouts — trigger via image update
          kubectl argo rollouts set image product-service \
            product-service=$ECR_REGISTRY/cloudmart/product-service:${{ github.sha }} \
            -n cloudmart-prod

      - name: Post-deployment smoke tests
        run: |
          PROD_URL=$(kubectl get ingress cloudmart-ingress -n cloudmart-prod -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
          for endpoint in /health /api/products/health /api/orders/health /api/users/health; do
            curl -f https://${PROD_URL}${endpoint} || exit 1
          done
```

### GitHub Actions IAM Role (OIDC — no long-lived keys)

Add to Terraform:

```hcl
resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "github_actions" {
  name = "cloudmart-github-actions-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:<your-org>/cloudmart:*"
        }
      }
    }]
  })
}

# Attach policies: ECR push, EKS describe, limited deploy
resource "aws_iam_role_policy_attachment" "github_ecr" {
  role       = aws_iam_role.github_actions.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser"
}
```

---

## Phase 18 — CloudWatch Container Insights & X-Ray

### Enable Container Insights

```bash
aws eks create-addon \
  --cluster-name cloudmart-eks \
  --addon-name amazon-cloudwatch-observability \
  --region us-east-1
```

### X-Ray Daemon (DaemonSet)

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: xray-daemon
  namespace: cloudmart-prod
spec:
  selector:
    matchLabels:
      app: xray-daemon
  template:
    metadata:
      labels:
        app: xray-daemon
    spec:
      containers:
        - name: xray-daemon
          image: amazon/aws-xray-daemon
          ports:
            - containerPort: 2000
              protocol: UDP
          resources:
            limits:
              cpu: 100m
              memory: 256Mi
```

Add to your Flask/Node services:
- Python: `aws-xray-sdk` with `xray_recorder` middleware
- Node: `aws-xray-sdk-node` with `AWSXRay.express.openSegment()`

---

## Phase 19 — AWS WAF

```hcl
resource "aws_wafv2_web_acl" "cloudmart" {
  name  = "cloudmart-waf"
  scope = "REGIONAL"

  default_action { allow {} }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSetMetric"
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "KnownBadInputsMetric"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = "CloudMartWAF"
  }

  tags = var.common_tags
}
```

---

## Phase 20 — GuardDuty (Threat Detection)

```hcl
resource "aws_guardduty_detector" "main" {
  enable = true
  tags   = var.common_tags

  datasources {
    s3_logs           { enable = true }
    kubernetes { audit_logs { enable = true } }
    malware_protection {
      scan_ec2_instance_with_findings { ebs_volumes { enable = true } }
    }
  }
}
```

To generate a sample finding for demo:

```bash
aws guardduty create-sample-findings \
  --detector-id $(aws guardduty list-detectors --query 'DetectorIds[0]' --output text) \
  --finding-types "UnauthorizedAccess:EC2/SSHBruteForce"
```

---

## Phase 21 — Velero (K8s Backup)

```bash
# Create S3 bucket for Velero
aws s3api create-bucket \
  --bucket cloudmart-velero-backups-<your-group-id> \
  --region us-east-1

# Install Velero with AWS plugin
velero install \
  --provider aws \
  --plugins velero/velero-plugin-for-aws:v1.9.0 \
  --bucket cloudmart-velero-backups-<your-group-id> \
  --backup-location-config region=us-east-1 \
  --snapshot-location-config region=us-east-1 \
  --secret-file ./credentials-velero

# Schedule automatic daily backup
velero schedule create cloudmart-daily \
  --schedule="0 2 * * *" \
  --include-namespaces cloudmart-prod \
  --ttl 168h   # 7-day retention

# Manual backup (for demo)
velero backup create cloudmart-manual-$(date +%Y%m%d) \
  --include-namespaces cloudmart-prod

# Restore from backup (demo in staging)
velero restore create --from-backup cloudmart-manual-YYYYMMDD \
  --namespace-mappings cloudmart-prod:cloudmart-staging
```

---

## Phase 22 — Resource Tagging

All Terraform resources must include this `common_tags` variable:

```hcl
variable "common_tags" {
  default = {
    Project     = "cloudmart"
    Environment = "prod"         # or "staging"
    Team        = "<your-group-id>"
    Owner       = "<group-email>"
    ManagedBy   = "terraform"
  }
}
```

---

## Phase 23 — Architecture Decision Records

### ADR-001: Kubernetes Node Instance Type

`docs/adr/ADR-001-node-instance-type.md`:

```markdown
# ADR-001: Kubernetes Node Instance Type Selection

## Status
Accepted

## Context
We need to select the EC2 instance type for EKS managed node groups running all five
CloudMart microservices. The cluster runs in us-east-1 with min 2 / max 6 nodes.
Constraints: academic budget (~$50/month), no GPU required, all services are
general-purpose web workloads.

## Decision
Use **t3.medium** (2 vCPU, 4 GB RAM, $0.0416/hr on-demand).

## Consequences
**Positive:** Free-tier adjacent; burstable CPU suits spiky web traffic; sufficient RAM for
5 services with 2 replicas each (~200–512 MB per container).
**Negative:** CPU credit exhaustion under sustained load — mitigated by HPA scaling
out before credits deplete. Not suitable for compute-intensive ML workloads.

## Alternatives Considered
| Type | vCPU | RAM | $/hr | Verdict |
|---|---|---|---|---|
| t3.small | 2 | 2 GB | $0.0208 | Rejected — insufficient RAM for 2+ pods per node |
| t3.medium | 2 | 4 GB | $0.0416 | **Selected** |
| t3.large | 2 | 8 GB | $0.0832 | Rejected — 2× cost, over-provisioned for dev/staging |
| m6g.medium (ARM) | 1 | 4 GB | $0.0385 | Rejected — requires ARM-compatible images; adds build complexity |
| c6i.large | 2 | 4 GB | $0.085 | Rejected — compute-optimised at 2× cost; no benefit for I/O-bound services |
```

### ADR-002: Database for user-service

`docs/adr/ADR-002-database-user-service.md`:

```markdown
# ADR-002: Database Technology for user-service

## Status
Accepted

## Context
user-service handles registration, JWT login, profile management. Data is highly
relational (users, sessions, profiles). Passwords are bcrypt-hashed. Queries use
email lookups, joins for profile data. ACID compliance required for auth correctness.

## Decision
Use **Amazon RDS PostgreSQL 15** (db.t3.micro, Multi-AZ in prod).

## Consequences
**Positive:** Full ACID compliance; rich query support (JSON columns, full-text search);
familiar to team; AWS managed patching, backups, failover.
**Negative:** Fixed cost ($0.017/hr for db.t3.micro) unlike serverless; must pre-provision
storage; requires VPC placement in private data subnet.

## Alternatives Considered
- **DynamoDB:** Rejected — no native support for complex relational queries (join
  user + profile + session). Eventual consistency incompatible with auth flows.
- **Aurora Serverless v2 (PostgreSQL):** Considered — auto-scales to 0 ACUs when
  idle, cost-effective for low traffic. Rejected for now due to cold-start latency
  (~5s) being unacceptable for login flows; can revisit post-launch.
- **Managed NoSQL (MongoDB Atlas):** Rejected — not a native AWS managed service;
  adds vendor dependency; schema flexibility not needed for structured user data.
```

### ADR-003: Deployment Strategy for product-service

`docs/adr/ADR-003-deployment-strategy-product-service.md`:

```markdown
# ADR-003: Deployment Strategy for product-service

## Status
Accepted

## Context
product-service is the highest-traffic service (catalogue browsing). Deployments must
not cause user-visible downtime. Team has moderate Kubernetes experience. RTO target
is 15 minutes.

## Decision
Use **Canary deployment via Argo Rollouts** with a metric gate (error rate ≤ 1%).

Steps: 20% canary → 2m pause → 50% → 2m pause → 100% (or auto-rollback).

## Consequences
**Positive:** Limits blast radius to 20% of traffic on bad deploy; automated rollback on
metric breach; satisfies Distinction-level requirement; aligns with industry practice.
**Negative:** Requires Argo Rollouts installation and CloudWatch metric configuration;
slightly more complex pipeline. Team must understand rollout pause/promote commands.

## Alternatives Considered
- **Rolling Update (maxSurge:1, maxUnavailable:0):** Used for all other services.
  Simpler but exposes 100% of traffic to new version immediately. Acceptable for
  lower-traffic services; insufficient for product-service.
- **Blue/Green:** Full duplicate environment at 2× node cost. Rejected due to budget
  constraint — would require 4 extra nodes during deployment window.
```

---

## Phase 24 — CloudWatch Dashboard

Create via AWS Console or Terraform:

```hcl
resource "aws_cloudwatch_dashboard" "cloudmart" {
  dashboard_name = "CloudMart-Overview"
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title  = "CPU per Service"
          metrics = [
            ["ContainerInsights", "pod_cpu_utilization", "Namespace", "cloudmart-prod", "PodName", "product-service"],
            ["ContainerInsights", "pod_cpu_utilization", "Namespace", "cloudmart-prod", "PodName", "order-service"],
            ["ContainerInsights", "pod_cpu_utilization", "Namespace", "cloudmart-prod", "PodName", "user-service"]
          ]
          period = 60
          stat   = "Average"
        }
      },
      {
        type = "metric"
        properties = {
          title  = "SQS Queue Depth (orders)"
          metrics = [["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "cloudmart-orders"]]
          period = 60
          stat   = "Sum"
        }
      },
      {
        type = "metric"
        properties = {
          title  = "RDS Connections"
          metrics = [["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", "cloudmart-postgres"]]
          period = 60
          stat   = "Sum"
        }
      }
    ]
  })
}
```

---

## Phase 25 — Demo Validation Checklist

Run through these commands in order during your demo:

```bash
# 1 — Infrastructure
kubectl get nodes
kubectl get pods -n cloudmart-prod

# 2 — Networking: prove DB is not publicly accessible
nc -zv <rds-endpoint> 5432   # from external host — must FAIL

# 3 — Security
kubectl get networkpolicy -n cloudmart-prod
kubectl get serviceaccount -n cloudmart-prod
aws iam get-role --role-name cloudmart-product-service-role

# 4 — GuardDuty
aws guardduty list-findings \
  --detector-id $(aws guardduty list-detectors --query 'DetectorIds[0]' --output text)

# 5 — Autoscaling (load test)
kubectl run load-test --image=williamyeh/hey --rm -it -- \
  -n 5000 -c 100 http://product-service.cloudmart-prod.svc.cluster.local:8001/products
kubectl get hpa -n cloudmart-prod -w

# 6 — Velero backup restore (in staging)
velero backup get
velero restore create --from-backup <backup-name> \
  --namespace-mappings cloudmart-prod:cloudmart-staging

# 7 — Cost
aws ce get-cost-and-usage \
  --time-period Start=$(date -d '7 days ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity DAILY \
  --metrics BlendedCost \
  --filter file://cost-filter.json   # filter by tag Project=cloudmart

# 8 — Canary rollout status
kubectl argo rollouts get rollout product-service -n cloudmart-prod --watch
```

---

## Phase 26 — Cost & FinOps

### Monthly Estimate (us-east-1)

| Service | Spec | $/month |
|---|---|---|
| EKS cluster | Control plane | $73 |
| EC2 nodes (2× t3.medium) | On-demand | ~$60 |
| RDS PostgreSQL | db.t3.micro, 20 GB | ~$15 |
| DynamoDB | On-demand, low traffic | ~$1 |
| SQS | < 1M requests | $0 (free tier) |
| ECR | 5 repos, ~1 GB | ~$0.50 |
| NAT Gateways (2) | ~$32/month each | ~$64 |
| CloudWatch | Logs + metrics | ~$5 |
| Secrets Manager | 2 secrets | ~$0.80 |
| GuardDuty | 30-day trial | $0 |
| **Total** | | **~$220/month** |

> **Cost optimisation applied:** VPC endpoints for DynamoDB and S3 eliminate NAT data-transfer charges (~$0.045/GB). Spot instances could cut EC2 cost by 70% — rejected for production stability but consider for staging.

### 1-Year Reserved Instance Saving

t3.medium 1-year No-Upfront Reserved = $0.0261/hr vs $0.0416/hr on-demand  
Saving per node per year: ($0.0416 - $0.0261) × 8760 = **$135.78**  
For 2 nodes: **$271.56/year saving (~37%)**

### Unit Economics

Assume 10,000 orders/month at $220/month infrastructure cost:  
**Cost per 1,000 orders = $22.00**

---

## Phase 27 — Disaster Recovery Plan

### RTO / RPO Targets

| Metric | Target | Justification |
|---|---|---|
| RTO | 15 minutes | EKS pod restart is < 2min; RDS Multi-AZ failover is < 60s; DNS TTL 300s |
| RPO | 5 minutes | RDS automated backup every 5 min (PITR); DynamoDB PITR continuous |

### Recovery Procedures

**Scenario 1 — Pod failure:** Kubernetes self-heals automatically. No manual action.

**Scenario 2 — Node failure:** Cluster Autoscaler provisions replacement node within ~3 minutes. Pods reschedule automatically.

**Scenario 3 — RDS failure (Multi-AZ):** Automatic failover to standby in < 60 seconds. CNAME flips automatically. No application change needed.

**Scenario 4 — Full cluster loss:**
```bash
# Restore infrastructure
cd infra/environments/prod && terraform apply

# Restore K8s state from Velero
velero restore create --from-backup cloudmart-daily-<latest>

# Update kubeconfig
aws eks update-kubeconfig --name cloudmart-eks --region us-east-1

# Verify
kubectl get pods -n cloudmart-prod
```

**Scenario 5 — Database PITR (point-in-time recovery):**
```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier cloudmart-postgres \
  --target-db-instance-identifier cloudmart-postgres-recovered \
  --restore-time 2025-01-15T10:00:00Z \
  --db-instance-class db.t3.micro \
  --no-multi-az
```

---

## GitHub Secrets Required

Set these in your repository `Settings → Secrets and variables → Actions`:

| Secret | Value |
|---|---|
| `AWS_ACCOUNT_ID` | Your 12-digit AWS account ID |
| `TF_VAR_db_password` | Strong password for RDS |
| `TF_VAR_alert_email` | Group email for SNS/budget alerts |
| `TF_VAR_admin_cidr` | Your office/home IP in CIDR (e.g. 1.2.3.4/32) |
| `TF_VAR_ses_domain` | Your verified SES domain |
| `TF_VAR_ses_test_email` | Verified test email for SES sandbox |

---

## Final Deployment Order Summary

```
Phase 0  → Bootstrap tools + Terraform state bucket
Phase 1  → terraform apply (VPC, subnets, security groups, VPC endpoints, flow logs)
Phase 2  → terraform apply (KMS, ECR, Secrets Manager)
Phase 3  → terraform apply (RDS, DynamoDB, SQS, SES)
Phase 4  → terraform apply (EKS cluster + node group + IRSA roles)
Phase 5  → terraform apply (CloudWatch, SNS, WAF, GuardDuty, Budgets)
Phase 6  → kubectl apply (namespaces, base manifests)
Phase 7  → Helm installs (ALB controller, ESO, Cluster Autoscaler, KEDA, Kyverno, Argo Rollouts, ArgoCD)
Phase 8  → Build + push Docker images to ECR
Phase 9  → ArgoCD syncs Helm charts to cloudmart-prod + cloudmart-staging
Phase 10 → Apply NetworkPolicies + Kyverno policies
Phase 11 → Install Velero + create backup schedule
Phase 12 → Enable GuardDuty + create sample finding
Phase 13 → Run demo checklist (Phase 25)
```
