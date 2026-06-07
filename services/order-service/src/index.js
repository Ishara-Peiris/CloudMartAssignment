/**
 * CloudMart Order Service
 * Manages orders: create, read, update status.
 * Emits order events to a message queue and checks product stock.
 *
 * Data Store:
 *   - Default: In-memory array (for local dev / Docker Compose)
 *   - Cloud:   Students extend with a real database if desired
 *
 * Message Queue:
 *   - Default: In-memory event log (for local dev)
 *   - Cloud:   Set QUEUE_BACKEND=sqs|pubsub|servicebus via env var
 *              (requires workload identity / credentials)
 */

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8002;

// Service discovery — product-service URL
const PRODUCT_SERVICE_URL =
  process.env.PRODUCT_SERVICE_URL || 'http://product-service:8001';

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// ---------------------------------------------------------------------------
// In-memory data store
// ---------------------------------------------------------------------------
const orders = new Map();
const eventLog = []; // in-memory message queue substitute

// Seed data
const seedOrders = [
  {
    id: 'ord-001',
    userId: 'user-001',
    items: [
      { productId: 'prod-001', name: 'Wireless Bluetooth Headphones', quantity: 1, price: 79.99 },
      { productId: 'prod-003', name: 'USB-C Laptop Stand', quantity: 1, price: 49.99 },
    ],
    total: 129.98,
    status: 'delivered',
    shippingAddress: '42 Galle Road, Colombo 03, Sri Lanka',
    createdAt: '2025-02-10T14:30:00Z',
    updatedAt: '2025-02-15T09:00:00Z',
  },
];
seedOrders.forEach((o) => orders.set(o.id, o));

// ---------------------------------------------------------------------------
// Message Queue Abstraction
// ---------------------------------------------------------------------------

/**
 * Publishes an order event to the configured message queue.
 * Default: stores in-memory.
 * Students: implement the cloud adapter for your provider.
 */
async function publishOrderEvent(event) {
  const backend = (process.env.QUEUE_BACKEND || 'memory').toLowerCase();

  if (backend === 'sqs') {
    // TODO: AWS SQS — use @aws-sdk/client-sqs
    // const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
    // const client = new SQSClient({ region: process.env.AWS_REGION });
    // await client.send(new SendMessageCommand({
    //   QueueUrl: process.env.SQS_QUEUE_URL,
    //   MessageBody: JSON.stringify(event),
    // }));
    console.log('[SQS] Would publish event:', event.type);
    eventLog.push(event);
  } else if (backend === 'pubsub') {
    // TODO: GCP Pub/Sub — use @google-cloud/pubsub
    // const { PubSub } = require('@google-cloud/pubsub');
    // const pubsub = new PubSub();
    // await pubsub.topic(process.env.PUBSUB_TOPIC).publishMessage({ json: event });
    console.log('[Pub/Sub] Would publish event:', event.type);
    eventLog.push(event);
  } else if (backend === 'servicebus') {
    // TODO: Azure Service Bus — use @azure/service-bus
    // const { ServiceBusClient } = require('@azure/service-bus');
    // const client = new ServiceBusClient(process.env.SERVICEBUS_CONNECTION);
    // const sender = client.createSender(process.env.SERVICEBUS_QUEUE);
    // await sender.sendMessages({ body: event });
    console.log('[Service Bus] Would publish event:', event.type);
    eventLog.push(event);
  } else {
    // In-memory — just log it
    console.log(`[EventLog] ${event.type}: order ${event.orderId}`);
    eventLog.push(event);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'order-service' });
});

// Readiness check
app.get('/ready', async (req, res) => {
  try {
    // Check product-service connectivity
    await axios.get(`${PRODUCT_SERVICE_URL}/health`, { timeout: 2000 });
    res.json({ status: 'ready', service: 'order-service' });
  } catch {
    res.json({ status: 'ready', service: 'order-service', note: 'product-service unreachable but order-service is running' });
  }
});

// List all orders (optionally filter by userId)
app.get('/orders', (req, res) => {
  let result = Array.from(orders.values());
  if (req.query.userId) {
    result = result.filter((o) => o.userId === req.query.userId);
  }
  // Sort by createdAt descending
  result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ orders: result, count: result.length });
});

// Get single order
app.get('/orders/:orderId', (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: 'Not Found', message: `Order ${req.params.orderId} not found` });
  }
  res.json(order);
});

// Create a new order
app.post('/orders', async (req, res) => {
  try {
    const { userId, items, shippingAddress } = req.body;

    if (!userId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required fields: userId, items (array with at least 1 item)',
      });
    }

    // Validate stock for each item by calling product-service
    let total = 0;
    const enrichedItems = [];

    for (const item of items) {
      try {
        const stockRes = await axios.get(
          `${PRODUCT_SERVICE_URL}/products/${item.productId}/stock`,
          { timeout: 3000 }
        );
        if (stockRes.data.stock < (item.quantity || 1)) {
          return res.status(409).json({
            error: 'Insufficient Stock',
            message: `Product ${item.productId} has only ${stockRes.data.stock} units available`,
          });
        }

        // Get product details
        const productRes = await axios.get(
          `${PRODUCT_SERVICE_URL}/products/${item.productId}`,
          { timeout: 3000 }
        );
        const product = productRes.data;
        const quantity = item.quantity || 1;
        const lineTotal = product.price * quantity;
        total += lineTotal;

        enrichedItems.push({
          productId: item.productId,
          name: product.name,
          quantity,
          price: product.price,
          lineTotal,
        });

        // Decrement stock
        await axios.post(
          `${PRODUCT_SERVICE_URL}/products/${item.productId}/stock/decrement`,
          { quantity },
          { timeout: 3000 }
        );
      } catch (err) {
        if (err.response && err.response.status === 404) {
          return res.status(404).json({
            error: 'Not Found',
            message: `Product ${item.productId} not found`,
          });
        }
        if (err.response && err.response.status === 409) {
          return res.status(409).json({
            error: 'Insufficient Stock',
            message: err.response.data.message,
          });
        }
        throw err;
      }
    }

    const order = {
      id: `ord-${uuidv4().split('-')[0]}`,
      userId,
      items: enrichedItems,
      total: Math.round(total * 100) / 100,
      status: 'pending',
      shippingAddress: shippingAddress || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    orders.set(order.id, order);

    // Publish order event to message queue
    await publishOrderEvent({
      type: 'ORDER_CREATED',
      orderId: order.id,
      userId: order.userId,
      total: order.total,
      items: order.items,
      timestamp: order.createdAt,
    });

    console.log(`[Order] Created: ${order.id} — $${order.total} — ${order.items.length} items`);
    res.status(201).json(order);
  } catch (err) {
    console.error('[Order] Error creating order:', err.message);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create order' });
  }
});

// Update order status
app.patch('/orders/:orderId/status', async (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: 'Not Found', message: `Order ${req.params.orderId} not found` });
  }

  const { status } = req.body;
  const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
    });
  }

  order.status = status;
  order.updatedAt = new Date().toISOString();

  // Publish status change event
  await publishOrderEvent({
    type: 'ORDER_STATUS_CHANGED',
    orderId: order.id,
    userId: order.userId,
    oldStatus: order.status,
    newStatus: status,
    timestamp: order.updatedAt,
  });

  console.log(`[Order] Status updated: ${order.id} → ${status}`);
  res.json(order);
});

// Get event log (for debugging / demo purposes)
app.get('/events', (req, res) => {
  res.json({ events: eventLog, count: eventLog.length });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[order-service] Running on port ${PORT}`);
  console.log(`[order-service] Product service URL: ${PRODUCT_SERVICE_URL}`);
  console.log(`[order-service] Queue backend: ${process.env.QUEUE_BACKEND || 'memory'}`);
});

module.exports = app;
