# CloudMart — AWS Deployment Guide

This guide provides the step-by-step instructions to deploy the CloudMart application to AWS, based on the `instructions.md`.

## Prerequisites

Ensure you have the following tools installed locally:
- **Terraform 1.7+**
- **AWS CLI v2** (configured with admin credentials)
- **kubectl**
- **Helm 3**
- **eksctl**
- **Docker**

---

## Step 1: Bootstrap AWS Infrastructure (Manual)

### 1.1 Configure AWS Credentials
```bash
aws configure
```

### 1.2 Create Terraform State Backend
Replace `<your-group-id>` with a unique identifier.
```bash
# Create S3 bucket
aws s3api create-bucket --bucket cloudmart-tfstate-<your-group-id> --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning --bucket cloudmart-tfstate-<your-group-id> --versioning-configuration Status=Enabled

# Create DynamoDB table for locking
aws dynamodb create-table \
  --table-name cloudmart-tfstate-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 1.3 Update `infra/backend.tf`
Ensure the `bucket` name matches what you created above.

---

## Step 2: Provision Infrastructure with Terraform

```bash
cd infra/environments/prod
terraform init
terraform apply
```
*Note: You can apply modules individually as described in Phase 6 of `instructions.md` if you prefer controlled rollouts.*

---

## Step 3: Build and Push Docker Images

### 3.1 Authenticate Docker to ECR
```bash
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com
```

### 3.2 Build and Push
```bash
export ECR_BASE="${AWS_ACCOUNT_ID}.dkr.ecr.us-east-1.amazonaws.com"
for SERVICE in product-service order-service user-service notification-service frontend; do
  docker build -t ${ECR_BASE}/cloudmart/${SERVICE}:latest services/${SERVICE}/
  docker push ${ECR_BASE}/cloudmart/${SERVICE}:latest
done
```

---

## Step 4: Configure Kubernetes Cluster

### 4.1 Update Kubeconfig
```bash
aws eks update-kubeconfig --region us-east-1 --name cloudmart-eks
```

### 4.2 Install Base Add-ons
```bash
# Apply Namespaces
kubectl apply -f k8s/base/namespaces.yaml

# Install AWS Load Balancer Controller
# (Refer to Phase 10.2 for detailed steps including IAM policy creation)

# Install External Secrets Operator, Cluster Autoscaler, KEDA, Kyverno, Argo Rollouts, and ArgoCD
# (Refer to Phase 10 for Helm commands)
```

---

## Step 5: Deploy Application via GitOps (ArgoCD)

### 5.1 Access ArgoCD
```bash
kubectl port-forward svc/argocd-server -n argocd 8080:443
# Login with 'admin' and the initial password (Phase 10.8)
```

### 5.2 Deploy Applications
Ensure you have updated the `repoURL` in `k8s/argocd/applications/cloudmart-prod.yaml` to point to your repository.
```bash
kubectl apply -f k8s/argocd/applications/cloudmart-prod.yaml
```

---

## Step 6: Verify Deployment
- Check ArgoCD UI to ensure all applications are "Healthy" and "Synced".
- Get the Frontend ALB DNS name:
  ```bash
  kubectl get ingress -n cloudmart-prod
  ```
- Access the application in your browser.

---

## Step 7: CI/CD Setup
- Push your code to GitHub.
- Add `AWS_ACCOUNT_ID` and other necessary secrets to your GitHub repository secrets.
- The CI pipeline (`.github/workflows/ci.yml`) will automatically run on every push to `main` or `develop`.
