# Team Member 1: Cloud Infrastructure Engineer

## Role Overview
You are responsible for provisioning the foundational AWS infrastructure using Terraform. Your work is the prerequisite for all other team members, as their application code and Kubernetes deployments rely on the cloud resources you create.

## Execution Order
**Priority: 1 (First to start)**
*Must be completed before Team Member 4 can deploy to Kubernetes.*

## Tasks to Implement

### 1. Terraform State Setup (Phase 0)
- Manually create an S3 bucket and DynamoDB table for Terraform remote state locking.
- Configure `infra/backend.tf` to point to these resources.

### 2. Networking (Phase 1)
- Create the VPC module (`infra/modules/vpc`) with public, private app, and private data subnets across 2 Availability Zones.
- Setup NAT Gateways, Internet Gateway, and Route Tables.
- Configure VPC Endpoints for S3, DynamoDB, Secrets Manager, and ECR to ensure private connectivity.
- Setup Security Groups (ALB, EKS Nodes, RDS, Bastion, VPCE).

### 3. Core Services & Registry (Phase 2)
- Create the KMS module for master encryption.
- Create ECR repositories for all 5 services (`product-service`, `order-service`, `user-service`, `notification-service`, `frontend`) with image lifecycle policies.
- Setup AWS Secrets Manager for RDS and SES credentials.

### 4. Data Stores & Messaging (Phase 3)
- Provision an RDS PostgreSQL database (Multi-AZ in prod) for the `user-service`.
- Provision an On-Demand DynamoDB table (`cloudmart-products`) for the `product-service`.
- Provision an SQS queue (`cloudmart-orders`) with a Dead Letter Queue (DLQ) for asynchronous events.
- Setup AWS SES domain/email identity for notifications.

### 5. EKS Cluster & IRSA (Phase 4)
- Deploy the EKS 1.29 cluster and managed node groups (t3.medium).
- Configure IAM Roles for Service Accounts (IRSA) for each backend service. This grants fine-grained IAM permissions (e.g., DynamoDB access for `product-service`, SQS/SES access for `notification-service`).

### 6. Monitoring & Deployment (Phase 5 & 6)
- Setup CloudWatch Container Insights, Alarms, and SNS alerts.
- Execute `terraform apply` in the correct dependency order as outlined in Phase 6 of the main instructions.
- Provide the generated outputs (VPC ID, ECR URIs, Cluster Name, SQS URLs, etc.) to the rest of the team.

## Success Criteria
- `terraform apply` succeeds with 0 errors.
- The EKS cluster is accessible via `kubectl`.
- All team members have the necessary resource ARNs and URLs to configure their services.
