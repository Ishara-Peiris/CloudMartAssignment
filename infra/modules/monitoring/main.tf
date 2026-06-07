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
