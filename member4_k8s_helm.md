# Team Member 4: Kubernetes & Helm Engineer

## Role Overview
You are responsible for configuring the base EKS cluster and packaging all microservices into Helm charts. This replaces the flat YAML manifests and provides templated, scalable deployments.

## Execution Order
**Priority: 3 (Requires Member 1's EKS cluster, and Member 2 & 3's Docker builds)**

## Tasks to Implement

### 1. Push Images to ECR (Phase 8)
- Authenticate Docker to AWS ECR.
- Build and push the Docker images for all 5 services to their respective ECR repositories created by Member 1.

### 2. Base K8s Infrastructure (Phase 10)
- Install cluster prerequisites via Helm and `kubectl`:
  - AWS Load Balancer Controller (required for Ingress)
  - External Secrets Operator (ESO)
  - Cluster Autoscaler
  - KEDA (for event-driven autoscaling)
  - Kyverno (policy engine)
  - Argo Rollouts (for canary deployments)
  - ArgoCD (for GitOps)
- Apply the base namespaces (`k8s/base/namespaces.yaml`).

### 3. Helm Charts Setup (Phase 11)
- Delete the old, flat `.yaml` files in the `k8s/` folder (e.g., `k8s/product-service.yaml`).
- Create a `k8s/charts/` directory with 5 subdirectories (one for each service).
- For each service, structure a Helm chart matching the template in the instructions. This must include:
  - `Chart.yaml`, `values.yaml`, `values-staging.yaml`, `values-prod.yaml`.
  - Templates: `deployment.yaml`, `service.yaml`, `hpa.yaml`, `pdb.yaml`, `configmap.yaml`, `serviceaccount.yaml`.
- Ensure IRSA Role ARNs are dynamically templated via the `values.yaml` files.
- For `user-service`, include the `externalsecret.yaml` to securely pull RDS credentials from AWS Secrets Manager.
- For `notification-service`, include the KEDA `scaledobject.yaml` instead of a standard HPA, configured to scale based on SQS queue depth.

## Success Criteria
- All 5 Helm charts render correctly (`helm template ...`).
- All external dependencies (ESO, KEDA, ALB controller) are running successfully in the `kube-system` or dedicated namespaces.
- The base `cloudmart-prod` and `cloudmart-staging` namespaces are created.
