# Team Member 5: DevOps & Security Engineer

## Role Overview
You are responsible for securing the cluster, defining networking policies, setting up advanced deployment strategies (Canary), and tying everything together with a GitOps/CI/CD pipeline. Your work ensures that CloudMart is production-ready, secure, and automatically deployed.

## Execution Order
**Priority: 4 (Final Phase - Depends on Member 4's Helm charts)**

## Tasks to Implement

### 1. Ingress Setup (Phase 12)
- Add `ingress.yaml` to the `frontend` Helm chart (or as a separate base configuration).
- Configure the AWS Load Balancer Controller annotations to provision an internet-facing ALB.
- Route HTTP(S) traffic to the frontend service.

### 2. Network Security (Phase 13)
- Create `k8s/base/network-policies/default-deny.yaml` to block all pod-to-pod traffic by default.
- Create `k8s/base/network-policies/allow-policies.yaml` to explicitly whitelist necessary traffic:
  - Frontend to Product, Order, and User services.
  - Order service to Product service.
  - Egress rules to AWS Managed services (SQS, DynamoDB via VPC Endpoints, RDS).

### 3. Policy Enforcement (Phase 14)
- Create Kyverno cluster policies in `k8s/base/kyverno-policies/` to enforce:
  - Containers cannot run as root.
  - Privileged containers are denied.
  - Images can only be pulled from the trusted CloudMart ECR registry.

### 4. Advanced Deployments (Phase 15)
- Modify the `product-service` Helm chart to replace the standard `Deployment` with an Argo `Rollout` object.
- Configure a Canary release strategy that steps up traffic (20% -> 50% -> 100%).
- Add an `AnalysisTemplate` to measure the CloudWatch `5xxErrorRate` during the rollout to automatically halt if it exceeds 1%.

### 5. GitOps Configuration (Phase 16)
- Create ArgoCD `Application` definitions in `k8s/argocd/applications/` for `cloudmart-prod` (tracks the `main` branch) and `cloudmart-staging` (tracks the `develop` branch).
- Apply these applications to the cluster so ArgoCD manages all ongoing deployments.

### 6. CI/CD Pipeline (Phase 17)
- Create `.github/workflows/ci.yml` and `.github/workflows/cd.yml`.
- Set up a GitHub Actions workflow to run unit tests and linters for all 5 services on Pull Requests.
- Ensure successful merges build new Docker images, push them to ECR, and update the Helm chart image tags (triggering an ArgoCD sync).

## Success Criteria
- ArgoCD shows the cluster is fully synchronized and healthy.
- Pushing a new commit to `main` triggers the GitHub Actions pipeline, pushing a new image to ECR.
- Argo Rollouts correctly performs a canary deployment for the product service.
- The `default-deny` NetworkPolicy blocks unauthorized cross-service communication (verified by testing an unallowed connection).
- The project is 100% complete and deployable without manual intervention.
