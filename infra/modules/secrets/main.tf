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
