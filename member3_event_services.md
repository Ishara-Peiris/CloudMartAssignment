# Team Member 3: Backend Developer (Event Services)

## Role Overview
You are responsible for extending the `order-service` and `notification-service` to integrate with AWS messaging and communication services (SQS and SES), shifting away from the local in-memory event polling.

## Execution Order
**Priority: 2 (Parallel with Member 1 & 2)**
*You can write the code locally now, but live testing requires Team Member 1's AWS infrastructure (SQS & SES).*

## Tasks to Implement

### 1. Order Service (`services/order-service/src/index.js`)
- Locate the `publishOrderEvent` function.
- Implement the SQS adapter inside the `if (backend === 'sqs')` block.
- Use `@aws-sdk/client-sqs` to push order events (JSON serialized) to the queue specified by the `SQS_QUEUE_URL` environment variable.
- Update `services/order-service/package.json` to include `@aws-sdk/client-sqs`.

### 2. Notification Service (`services/notification-service/src/index.js`)
- Locate the `sendEmail` and `pollCloudQueue` functions.
- In `pollCloudQueue`, implement the SQS polling logic using `@aws-sdk/client-sqs` (ReceiveMessageCommand and DeleteMessageCommand). Ensure you process the messages and then explicitly delete them from the queue.
- In `sendEmail`, implement the Amazon SES adapter using `@aws-sdk/client-ses` (SendEmailCommand). Send the formatted email to the recipient.
- Update `services/notification-service/package.json` to include `@aws-sdk/client-sqs` and `@aws-sdk/client-ses`.

### 3. Local Verification
- Ensure your changes handle network timeouts and missing environment variables gracefully without crashing the Node process.
- Build your Docker containers (`docker build -t cloudmart/order-service ./services/order-service`) and ensure they start successfully.

## Success Criteria
- Placing an order successfully puts a message onto the AWS SQS queue.
- The Notification service successfully picks up the message, formats an email, and sends it via AWS SES.
- Queue messages are properly deleted after being processed.
