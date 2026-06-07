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
