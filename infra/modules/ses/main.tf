resource "aws_ses_domain_identity" "cloudmart" {
  domain = var.ses_domain   # e.g. "cloudmart.internal" or verified domain
}

# For sandbox: verify a specific email address instead of domain
resource "aws_ses_email_identity" "test" {
  email = var.ses_test_email   # e.g. your group email
}
