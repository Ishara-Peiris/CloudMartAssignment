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
