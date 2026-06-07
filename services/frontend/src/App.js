import React, { useState, useEffect, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Config — API base URLs (proxied through Nginx in production)
// ---------------------------------------------------------------------------
const API = {
  products: process.env.REACT_APP_PRODUCT_URL || '/api/products',
  orders:   process.env.REACT_APP_ORDER_URL   || '/api/orders',
  auth:     process.env.REACT_APP_USER_URL    || '/api/auth',
  users:    process.env.REACT_APP_USER_URL    || '/api/users',
};

// ---------------------------------------------------------------------------
// Styles (inline — students can extract to CSS files)
// ---------------------------------------------------------------------------
const styles = {
  app: { minHeight: '100vh', background: '#f5f5f5' },
  header: {
    background: '#1a1a2e', color: '#fff', padding: '16px 32px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  logo: { fontSize: '24px', fontWeight: 'bold' },
  nav: { display: 'flex', gap: '16px', alignItems: 'center' },
  navBtn: {
    background: 'none', border: '1px solid rgba(255,255,255,0.3)',
    color: '#fff', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer',
  },
  main: { maxWidth: '1200px', margin: '0 auto', padding: '24px' },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '20px', marginTop: '20px',
  },
  card: {
    background: '#fff', borderRadius: '8px', padding: '20px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)', transition: 'box-shadow 0.2s',
  },
  cardTitle: { fontSize: '18px', fontWeight: '600', marginBottom: '8px' },
  cardPrice: { fontSize: '22px', fontWeight: 'bold', color: '#e94560', margin: '8px 0' },
  badge: {
    display: 'inline-block', background: '#e8f5e9', color: '#2e7d32',
    padding: '2px 8px', borderRadius: '12px', fontSize: '12px',
  },
  btn: {
    background: '#e94560', color: '#fff', border: 'none',
    padding: '10px 20px', borderRadius: '4px', cursor: 'pointer',
    fontSize: '14px', fontWeight: '600',
  },
  btnSecondary: {
    background: '#1a1a2e', color: '#fff', border: 'none',
    padding: '10px 20px', borderRadius: '4px', cursor: 'pointer',
    fontSize: '14px',
  },
  input: {
    width: '100%', padding: '10px', border: '1px solid #ddd',
    borderRadius: '4px', fontSize: '14px', marginBottom: '12px',
  },
  formGroup: { marginBottom: '16px' },
  label: { display: 'block', marginBottom: '4px', fontWeight: '600', fontSize: '14px' },
  alert: {
    padding: '12px 16px', borderRadius: '4px', marginBottom: '16px',
    background: '#fff3e0', border: '1px solid #ff9800', color: '#e65100',
  },
  success: {
    padding: '12px 16px', borderRadius: '4px', marginBottom: '16px',
    background: '#e8f5e9', border: '1px solid #4caf50', color: '#2e7d32',
  },
  cartBadge: {
    background: '#e94560', color: '#fff', borderRadius: '50%',
    padding: '2px 8px', fontSize: '12px', marginLeft: '4px',
  },
  modal: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex',
    justifyContent: 'center', alignItems: 'center', zIndex: 1000,
  },
  modalContent: {
    background: '#fff', borderRadius: '8px', padding: '32px',
    maxWidth: '500px', width: '90%', maxHeight: '80vh', overflowY: 'auto',
  },
  table: { width: '100%', borderCollapse: 'collapse', marginTop: '16px' },
  th: { textAlign: 'left', padding: '8px', borderBottom: '2px solid #eee', fontSize: '14px' },
  td: { padding: '8px', borderBottom: '1px solid #eee', fontSize: '14px' },
};

// ---------------------------------------------------------------------------
// App Component
// ---------------------------------------------------------------------------
function App() {
  const [page, setPage] = useState('products');
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  // Fetch products
  const fetchProducts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set('search', searchTerm);
      if (categoryFilter) params.set('category', categoryFilter);
      const url = `${API.products}${params.toString() ? '?' + params : ''}`;
      const res = await fetch(url);
      const data = await res.json();
      setProducts(data.products || []);
    } catch {
      setError('Failed to load products. Is the product-service running?');
    }
  }, [searchTerm, categoryFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Fetch orders
  const fetchOrders = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API.orders}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setOrders(data.orders || []);
    } catch {
      // Silently fail
    }
  }, [token]);

  useEffect(() => { if (page === 'orders') fetchOrders(); }, [page, fetchOrders]);

  // Cart functions
  const addToCart = (product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { productId: product.id, name: product.name, price: product.price, quantity: 1 }];
    });
    setSuccess(`Added ${product.name} to cart`);
    setTimeout(() => setSuccess(''), 2000);
  };

  const removeFromCart = (productId) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  };

  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  // Place order
  const placeOrder = async () => {
    if (!user) { setShowAuth(true); return; }
    if (cart.length === 0) { setError('Cart is empty'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(API.orders, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId: user.id,
          items: cart.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          shippingAddress: user.address || 'Address not provided',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Order failed');
      }
      const order = await res.json();
      setSuccess(`Order placed! ID: ${order.id} — Total: $${order.total.toFixed(2)}`);
      setCart([]);
      setPage('orders');
      fetchOrders();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Auth
  const handleAuth = async (isLogin, formData) => {
    setLoading(true);
    setError('');
    try {
      const endpoint = isLogin ? `${API.auth}/login` : `${API.auth}/register`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Authentication failed');
      setUser(data.user);
      setToken(data.token);
      localStorage.setItem('token', data.token);
      setShowAuth(false);
      setSuccess(`Welcome, ${data.user.name}!`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    setPage('products');
    setSuccess('Logged out');
    setTimeout(() => setSuccess(''), 2000);
  };

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logo} onClick={() => setPage('products')}>
          CloudMart
        </div>
        <nav style={styles.nav}>
          <button style={styles.navBtn} onClick={() => setPage('products')}>Products</button>
          <button style={styles.navBtn} onClick={() => setPage('cart')}>
            Cart {cart.length > 0 && <span style={styles.cartBadge}>{cart.length}</span>}
          </button>
          {user ? (
            <>
              <button style={styles.navBtn} onClick={() => setPage('orders')}>My Orders</button>
              <span style={{ fontSize: '14px' }}>{user.name}</span>
              <button style={styles.navBtn} onClick={logout}>Logout</button>
            </>
          ) : (
            <button style={styles.navBtn} onClick={() => setShowAuth(true)}>Login</button>
          )}
        </nav>
      </header>

      {/* Main content */}
      <main style={styles.main}>
        {error && <div style={styles.alert}>{error}</div>}
        {success && <div style={styles.success}>{success}</div>}

        {page === 'products' && (
          <ProductsPage
            products={products}
            addToCart={addToCart}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
          />
        )}
        {page === 'cart' && (
          <CartPage
            cart={cart}
            removeFromCart={removeFromCart}
            cartTotal={cartTotal}
            placeOrder={placeOrder}
            loading={loading}
          />
        )}
        {page === 'orders' && <OrdersPage orders={orders} />}
      </main>

      {/* Auth Modal */}
      {showAuth && (
        <AuthModal
          onAuth={handleAuth}
          onClose={() => setShowAuth(false)}
          loading={loading}
          error={error}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function ProductsPage({ products, addToCart, searchTerm, setSearchTerm, categoryFilter, setCategoryFilter }) {
  const categories = [...new Set(products.map((p) => p.category))].sort();

  return (
    <>
      <h2 style={{ marginBottom: '16px' }}>Products</h2>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <input
          style={{ ...styles.input, maxWidth: '300px', marginBottom: 0 }}
          placeholder="Search products..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select
          style={{ ...styles.input, maxWidth: '200px', marginBottom: 0 }}
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
      <div style={styles.grid}>
        {products.map((product) => (
          <div key={product.id} style={styles.card}>
            <div style={styles.cardTitle}>{product.name}</div>
            <p style={{ color: '#666', fontSize: '14px', marginBottom: '8px' }}>
              {product.description}
            </p>
            <div style={styles.cardPrice}>${product.price.toFixed(2)}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={styles.badge}>{product.category}</span>
              <span style={{ fontSize: '13px', color: '#888' }}>Stock: {product.stock}</span>
            </div>
            <button
              style={{ ...styles.btn, width: '100%', marginTop: '12px' }}
              onClick={() => addToCart(product)}
              disabled={product.stock === 0}
            >
              {product.stock > 0 ? 'Add to Cart' : 'Out of Stock'}
            </button>
          </div>
        ))}
        {products.length === 0 && (
          <p style={{ color: '#888', gridColumn: '1 / -1', textAlign: 'center', padding: '40px' }}>
            No products found. Is the product-service running?
          </p>
        )}
      </div>
    </>
  );
}

function CartPage({ cart, removeFromCart, cartTotal, placeOrder, loading }) {
  if (cart.length === 0) {
    return (
      <>
        <h2>Shopping Cart</h2>
        <p style={{ color: '#888', marginTop: '20px' }}>Your cart is empty.</p>
      </>
    );
  }
  return (
    <>
      <h2>Shopping Cart</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Product</th>
            <th style={styles.th}>Price</th>
            <th style={styles.th}>Qty</th>
            <th style={styles.th}>Subtotal</th>
            <th style={styles.th}></th>
          </tr>
        </thead>
        <tbody>
          {cart.map((item) => (
            <tr key={item.productId}>
              <td style={styles.td}>{item.name}</td>
              <td style={styles.td}>${item.price.toFixed(2)}</td>
              <td style={styles.td}>{item.quantity}</td>
              <td style={styles.td}>${(item.price * item.quantity).toFixed(2)}</td>
              <td style={styles.td}>
                <button
                  style={{ ...styles.btnSecondary, padding: '4px 12px', fontSize: '12px' }}
                  onClick={() => removeFromCart(item.productId)}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} style={{ ...styles.td, fontWeight: 'bold' }}>Total</td>
            <td style={{ ...styles.td, fontWeight: 'bold', fontSize: '18px', color: '#e94560' }}>
              ${cartTotal.toFixed(2)}
            </td>
            <td style={styles.td}></td>
          </tr>
        </tfoot>
      </table>
      <button
        style={{ ...styles.btn, marginTop: '20px', padding: '14px 32px', fontSize: '16px' }}
        onClick={placeOrder}
        disabled={loading}
      >
        {loading ? 'Placing Order...' : 'Place Order'}
      </button>
    </>
  );
}

function OrdersPage({ orders }) {
  if (orders.length === 0) {
    return (
      <>
        <h2>My Orders</h2>
        <p style={{ color: '#888', marginTop: '20px' }}>No orders yet.</p>
      </>
    );
  }
  return (
    <>
      <h2>My Orders</h2>
      {orders.map((order) => (
        <div key={order.id} style={{ ...styles.card, marginTop: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <strong>{order.id}</strong>
            <span style={{
              ...styles.badge,
              background: order.status === 'delivered' ? '#e8f5e9' : '#fff3e0',
              color: order.status === 'delivered' ? '#2e7d32' : '#e65100',
            }}>
              {order.status}
            </span>
          </div>
          <p style={{ fontSize: '13px', color: '#888' }}>
            {new Date(order.createdAt).toLocaleString()}
          </p>
          <table style={{ ...styles.table, marginTop: '8px' }}>
            <tbody>
              {order.items.map((item, i) => (
                <tr key={i}>
                  <td style={styles.td}>{item.name}</td>
                  <td style={styles.td}>x{item.quantity}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>${item.price.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ textAlign: 'right', fontSize: '18px', fontWeight: 'bold', color: '#e94560', marginTop: '8px' }}>
            Total: ${order.total.toFixed(2)}
          </div>
        </div>
      ))}
    </>
  );
}

function AuthModal({ onAuth, onClose, loading }) {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({ email: '', password: '', name: '', address: '' });
  const [localError, setLocalError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setLocalError('');
    if (!formData.email || !formData.password) {
      setLocalError('Email and password are required');
      return;
    }
    if (!isLogin && !formData.name) {
      setLocalError('Name is required for registration');
      return;
    }
    onAuth(isLogin, formData);
  };

  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: '20px' }}>{isLogin ? 'Login' : 'Register'}</h2>
        {localError && <div style={styles.alert}>{localError}</div>}
        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Name</label>
              <input
                style={styles.input}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Your full name"
              />
            </div>
          )}
          <div style={styles.formGroup}>
            <label style={styles.label}>Email</label>
            <input
              style={styles.input}
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="you@example.com"
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Password</label>
            <input
              style={styles.input}
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="Min 8 characters"
            />
          </div>
          {!isLogin && (
            <div style={styles.formGroup}>
              <label style={styles.label}>Address</label>
              <input
                style={styles.input}
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Shipping address"
              />
            </div>
          )}
          <button style={{ ...styles.btn, width: '100%' }} type="submit" disabled={loading}>
            {loading ? 'Please wait...' : isLogin ? 'Login' : 'Register'}
          </button>
        </form>
        <p style={{ textAlign: 'center', marginTop: '16px', fontSize: '14px' }}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            style={{ background: 'none', border: 'none', color: '#e94560', cursor: 'pointer', fontWeight: '600' }}
            onClick={() => { setIsLogin(!isLogin); setLocalError(''); }}
          >
            {isLogin ? 'Register' : 'Login'}
          </button>
        </p>
        <p style={{ textAlign: 'center', marginTop: '8px', fontSize: '12px', color: '#888' }}>
          Demo credentials: alice@cloudmart.example / password123
        </p>
      </div>
    </div>
  );
}

export default App;
