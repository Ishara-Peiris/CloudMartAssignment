# Team Member 2: Backend Developer (Data Services)

## Role Overview
You are responsible for extending the `product-service` and `user-service` to connect with real AWS managed databases, replacing the mock in-memory stores currently present in the codebase.

## Execution Order
**Priority: 2 (Parallel with Member 1 & 3)**
*You can write the code locally now, but live testing requires Team Member 1's AWS infrastructure (DynamoDB & RDS).*

## Tasks to Implement

### 1. Product Service (`services/product-service/app.py`)
- Implement the `DynamoDBStore` class.
- Use `boto3` to connect to the AWS DynamoDB table defined by the `DYNAMODB_TABLE` environment variable.
- Implement methods: `get_all`, `get_by_id`, `create`, `update`, `delete`, `check_stock`, and `decrement_stock`.
- Ensure stock operations use atomic update expressions or conditional writes to prevent race conditions.
- Update `services/product-service/requirements.txt` to include `boto3`.

### 2. User Service (`services/user-service/app.py`)
- Implement the `PostgresUserStore` class.
- Use `psycopg2` or `SQLAlchemy` to connect to the RDS instance.
- The service should pull credentials securely (via environment variables injected by External Secrets Operator from AWS Secrets Manager).
- Implement methods: `find_by_email`, `find_by_id`, `create`, `update`, and `list_all`.
- Ensure passwords remain hashed and secure.
- Update `services/user-service/requirements.txt` to include the necessary PostgreSQL dependencies (e.g., `psycopg2-binary`).

### 3. Local Verification
- Test your adapters locally by injecting mock AWS credentials or running a local Postgres container.
- Build your Docker containers (`docker build -t cloudmart/product-service ./services/product-service`) and ensure they start successfully.

## Success Criteria
- Services default to cloud data stores when their respective environment variables are set.
- All CRUD operations function identically to the in-memory implementations.
- No hardcoded secrets exist in the source code.
