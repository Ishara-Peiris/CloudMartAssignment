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
