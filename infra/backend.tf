terraform {
  backend "s3" {
    bucket         = "cloudmart-tfstate-<your-group-id>"
    key            = "cloudmart/${terraform.workspace}/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "cloudmart-tfstate-lock"
    encrypt        = true
  }
}
