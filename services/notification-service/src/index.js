/**
 * CloudMart Notification Service
 * Consumes order events from a message queue and sends email notifications.
 *
 * This service has NO inbound HTTP traffic from other services (except health checks).
 * It polls a message queue for ORDER_CREATED events and sends confirmation emails.
 *
 * Queue Backend:
 *   - Default: Polls the order-service /events endpoint (for local dev)
 *   - Cloud:   Set QUEUE_BACKEND=sqs|pubsub|servicebus to poll a real queue
 *
 * Email Backend:
 *   - Default: Console logging (for local dev)
 *   - Cloud:   Set EMAIL_BACKEND=ses|sendgrid to send real emails
 */

const express = require('express');
const morgan = require('morgan');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8004;

// Service URLs
const ORDER_SERVICE_URL =
  process.env.ORDER_SERVICE_URL || 'http://order-service:8002';

// Track processed events to avoid duplicates
const processedEvents = new Set();
const notificationLog = [];

// ---------------------------------------------------------------------------
// Email sending abstraction
// ---------------------------------------------------------------------------

async function sendEmail(to, subject, body) {
  const backend = (process.env.EMAIL_BACKEND || 'console').toLowerCase();

  const email = { to, subject, body, sentAt: new Date().toISOString() };

  if (backend === 'ses') {
    // TODO: AWS SES — use @aws-sdk/client-ses
    // const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
    // const client = new SESClient({ region: process.env.AWS_REGION });
    // await client.send(new SendEmailCommand({
    //   Source: process.env.FROM_EMAIL,
    //   Destination: { ToAddresses: [to] },
    //   Message: {
    //     Subject: { Data: subject },
    //     Body: { Text: { Data: body } },
    //   },
    // }));
    console.log(`[SES] Would send email to ${to}: ${subject}`);
  } else if (backend === 'sendgrid') {
    // TODO: SendGrid (GCP / Azure) — use @sendgrid/mail
    // const sgMail = require('@sendgrid/mail');
    // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    // await sgMail.send({ to, from: process.env.FROM_EMAIL, subject, text: body });
    console.log(`[SendGrid] Would send email to ${to}: ${subject}`);
  } else {
    // Console mode — just log the email
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📧 EMAIL NOTIFICATION`);
    console.log(`${'='.repeat(60)}`);
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body:\n${body}`);
    console.log(`${'='.repeat(60)}\n`);
  }

  notificationLog.push({ ...email, backend, status: 'sent' });
  return email;
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

function formatCurrency(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

async function processOrderEvent(event) {
  // Skip already-processed events
  const eventKey = `${event.type}-${event.orderId}-${event.timestamp}`;
  if (processedEvents.has(eventKey)) return;
  processedEvents.add(eventKey);

  if (event.type === 'ORDER_CREATED') {
    const itemList = event.items
      .map((i) => `  - ${i.name} x${i.quantity} @ ${formatCurrency(i.price)}`)
      .join('\n');

    const subject = `CloudMart Order Confirmation — ${event.orderId}`;
    const body = [
      `Hello!`,
      ``,
      `Your order ${event.orderId} has been received and is being processed.`,
      ``,
      `Order Summary:`,
      itemList,
      ``,
      `Total: ${formatCurrency(event.total)}`,
      ``,
      `We'll notify you when your order ships.`,
      ``,
      `Thank you for shopping with CloudMart!`,
    ].join('\n');

    // In a real system, we'd look up the user's email from user-service
    const recipientEmail = `${event.userId}@cloudmart.example`;
    await sendEmail(recipientEmail, subject, body);

    console.log(
      `[Notification] Processed ORDER_CREATED for ${event.orderId} — ${formatCurrency(event.total)}`
    );
  } else if (event.type === 'ORDER_STATUS_CHANGED') {
    const subject = `CloudMart Order ${event.orderId} — Status Update`;
    const body = [
      `Hello!`,
      ``,
      `Your order ${event.orderId} status has been updated to: ${event.newStatus}`,
      ``,
      `Thank you for shopping with CloudMart!`,
    ].join('\n');

    const recipientEmail = `${event.userId}@cloudmart.example`;
    await sendEmail(recipientEmail, subject, body);

    console.log(
      `[Notification] Processed ORDER_STATUS_CHANGED for ${event.orderId} → ${event.newStatus}`
    );
  }
}

// ---------------------------------------------------------------------------
// Queue polling (local dev mode — polls order-service /events endpoint)
// ---------------------------------------------------------------------------

let lastEventCount = 0;

async function pollOrderServiceEvents() {
  try {
    const res = await axios.get(`${ORDER_SERVICE_URL}/events`, { timeout: 3000 });
    const events = res.data.events || [];

    // Process only new events
    if (events.length > lastEventCount) {
      const newEvents = events.slice(lastEventCount);
      for (const event of newEvents) {
        await processOrderEvent(event);
      }
      lastEventCount = events.length;
    }
  } catch {
    // Silently ignore — order-service might not be ready yet
  }
}

async function pollCloudQueue() {
  const backend = (process.env.QUEUE_BACKEND || 'memory').toLowerCase();

  if (backend === 'sqs') {
    // TODO: AWS SQS — use @aws-sdk/client-sqs
    // const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } = require('@aws-sdk/client-sqs');
    // const client = new SQSClient({ region: process.env.AWS_REGION });
    // const response = await client.send(new ReceiveMessageCommand({
    //   QueueUrl: process.env.SQS_QUEUE_URL,
    //   MaxNumberOfMessages: 10,
    //   WaitTimeSeconds: 20,
    // }));
    // for (const msg of response.Messages || []) {
    //   await processOrderEvent(JSON.parse(msg.Body));
    //   await client.send(new DeleteMessageCommand({
    //     QueueUrl: process.env.SQS_QUEUE_URL,
    //     ReceiptHandle: msg.ReceiptHandle,
    //   }));
    // }
    console.log('[SQS] Would poll for messages...');
  } else if (backend === 'pubsub') {
    // TODO: GCP Pub/Sub — use @google-cloud/pubsub
    // Pub/Sub uses push or streaming pull — implement subscription handler
    console.log('[Pub/Sub] Would subscribe to topic...');
  } else if (backend === 'servicebus') {
    // TODO: Azure Service Bus — use @azure/service-bus
    // const { ServiceBusClient } = require('@azure/service-bus');
    // const client = new ServiceBusClient(process.env.SERVICEBUS_CONNECTION);
    // const receiver = client.createReceiver(process.env.SERVICEBUS_QUEUE);
    // const messages = await receiver.receiveMessages(10, { maxWaitTimeInMs: 20000 });
    // for (const msg of messages) {
    //   await processOrderEvent(msg.body);
    //   await receiver.completeMessage(msg);
    // }
    console.log('[Service Bus] Would poll for messages...');
  } else {
    // In-memory mode — poll order-service directly
    await pollOrderServiceEvents();
  }
}

// Start polling loop
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);

function startPolling() {
  console.log(`[Notification] Starting queue polling (every ${POLL_INTERVAL_MS}ms)`);
  setInterval(pollCloudQueue, POLL_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// HTTP routes (health check only — this service has no inbound API traffic)
// ---------------------------------------------------------------------------

app.use(morgan('combined'));

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'notification-service' });
});

app.get('/ready', (req, res) => {
  res.json({ status: 'ready', service: 'notification-service' });
});

// View notification log (for demo / debugging)
app.get('/notifications', (req, res) => {
  res.json({ notifications: notificationLog, count: notificationLog.length });
});

// ---------------------------------------------------------------------------
// Start server + polling
// ---------------------------------------------------------------------------

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[notification-service] Health endpoint on port ${PORT}`);
  console.log(`[notification-service] Queue backend: ${process.env.QUEUE_BACKEND || 'memory'}`);
  console.log(`[notification-service] Email backend: ${process.env.EMAIL_BACKEND || 'console'}`);
  startPolling();
});

module.exports = app;
