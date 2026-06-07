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
