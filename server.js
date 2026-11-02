const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const BOOKS_FILE = path.join(DATA_DIR, 'books.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const PAYMENT_SETTINGS_FILE = path.join(DATA_DIR, 'payment-settings.json');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const PAYMENT_UPI = 'coderslab@upi';
const MAX_BOOKS_VISIBLE = 10;
const DEFAULT_PAYMENT_SETTINGS = {
  upiId: PAYMENT_UPI,
  qrImage: '',
  merchantName: 'CodersLab',
  note: 'Scan and pay using any UPI app.'
};
const JWT_SECRET = process.env.JWT_SECRET || 'coderslab-mytechshelf-secret';
const ADMIN_ACCOUNT = {
  email: 'yasminfathima0401@gmail.com',
  password: 'inara@456'
};
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://yasminefathima0401_db_user:9Yn0Xsc1IHegupT3@cluster0.jghuucp.mongodb.net/infinity-software?retryWrites=true&w=majority';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'infinity-software';

let mongoClient = null;

const defaultReviews = [
  { name: 'Aaryan', rating: 5, comment: 'Very clear, practical, and beginner-friendly.' },
  { name: 'Nisha', rating: 4, comment: 'Helpful examples and strong career value.' },
  { name: 'Rithik', rating: 5, comment: 'Perfect for a fast learning boost.' }
];

const defaultBooks = [
  {
    id: 'book-1',
    title: 'Full Stack Web Developer Bootcamp',
    author: 'A. Raghavan',
    description: 'Master HTML, CSS, JavaScript, backend logic, and deployment with hands-on projects for real-world work.',
    price: 499,
    category: 'Programming Books',
    image: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80',
    featured: true,
    stock: 25,
    rating: 4.8,
    reviews: defaultReviews
  },
  {
    id: 'book-2',
    title: 'Python for Data and Automation',
    author: 'M. Sreya',
    description: 'Learn Python from fundamentals to automation scripts, APIs, and dashboard-driven problem solving.',
    price: 399,
    category: 'Programming Books',
    image: 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=900&q=80',
    featured: false,
    stock: 18,
    rating: 4.7,
    reviews: defaultReviews
  },
  {
    id: 'book-3',
    title: 'UI/UX Design Blueprint',
    author: 'K. Harini',
    description: 'Create elegant user experiences with high-converting interfaces, wireframes, and user research methods.',
    price: 449,
    category: 'Programming Books',
    image: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80',
    featured: true,
    stock: 14,
    rating: 4.9,
    reviews: defaultReviews
  },
  {
    id: 'book-4',
    title: 'Interview Crackers for Developers',
    author: 'N. Jayanth',
    description: 'Practice real interview questions, coding patterns, and communication strategies for modern product teams.',
    price: 399,
    category: 'Interview Practice Books',
    image: 'https://images.unsplash.com/photo-1516321165247-4aa89a48be28?auto=format&fit=crop&w=900&q=80',
    featured: false,
    stock: 20,
    rating: 4.8,
    reviews: defaultReviews
  },
  {
    id: 'book-5',
    title: 'DSA Interview Playbook',
    author: 'R. Shalini',
    description: 'Sharpen your problem-solving skills with common DSA patterns, mock rounds, and fast revision notes.',
    price: 429,
    category: 'Interview Practice Books',
    image: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=900&q=80',
    featured: true,
    stock: 16,
    rating: 4.9,
    reviews: defaultReviews
  }
];

function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  const localBooks = readJson(BOOKS_FILE, []);
  const needsSeed = !Array.isArray(localBooks) || localBooks.length === 0 || !localBooks.some((book) => book.category === 'Programming Books' || book.category === 'Interview Practice Books');

  if (!fs.existsSync(BOOKS_FILE) || needsSeed) {
    fs.writeFileSync(BOOKS_FILE, JSON.stringify(defaultBooks, null, 2));
  }

  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
  }

  if (!fs.existsSync(PAYMENT_SETTINGS_FILE)) {
    fs.writeFileSync(PAYMENT_SETTINGS_FILE, JSON.stringify(DEFAULT_PAYMENT_SETTINGS, null, 2));
  }
}

function readJson(filePath, fallback) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return data ? JSON.parse(data) : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function getPaymentSettings() {
  return readJson(PAYMENT_SETTINGS_FILE, DEFAULT_PAYMENT_SETTINGS);
}

function savePaymentSettings(settings) {
  const nextSettings = {
    ...DEFAULT_PAYMENT_SETTINGS,
    ...(settings || {})
  };

  writeJson(PAYMENT_SETTINGS_FILE, nextSettings);
  return nextSettings;
}

function normalizeBook(book) {
  const reviews = Array.isArray(book.reviews) && book.reviews.length > 0 ? book.reviews : defaultReviews;
  const rating = Number(book.rating || (reviews.reduce((sum, review) => sum + Number(review.rating || 5), 0) / reviews.length) || 4.7);

  return {
    ...book,
    rating: Number(rating.toFixed(1)),
    reviews,
    featured: Boolean(book.featured),
    stock: Number(book.stock || 25),
    price: Number(book.price || 0)
  };
}

function limitVisibleBooks(books, limit = MAX_BOOKS_VISIBLE) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : books.length;
  return books.slice(0, safeLimit).map(normalizeBook);
}

async function connectMongo() {
  if (mongoClient) {
    return mongoClient.db(MONGODB_DB_NAME);
  }

  try {
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 4000
    });
    await mongoClient.connect();
    return mongoClient.db(MONGODB_DB_NAME);
  } catch (error) {
    console.warn('MongoDB Atlas is unavailable. Using local data files instead.');
    return null;
  }
}

async function getBooksFromStore(options = {}) {
  const { limit = MAX_BOOKS_VISIBLE } = options;
  const db = await connectMongo();

  if (db) {
    try {
      const collection = db.collection('books');
      const books = await collection.find({}).sort({ createdAt: -1 }).toArray();
      if (books.length) {
        const normalizedBooks = books.map(normalizeBook);
        return limit > 0 ? limitVisibleBooks(normalizedBooks, limit) : normalizedBooks;
      }

      await collection.insertMany(defaultBooks.map((book) => ({ ...book, createdAt: new Date().toISOString() })));
      return limit > 0 ? limitVisibleBooks(defaultBooks, limit) : defaultBooks.map(normalizeBook);
    } catch (error) {
      console.warn('Unable to load books from MongoDB, falling back to JSON files.');
    }
  }

  const localBooks = readJson(BOOKS_FILE, defaultBooks);
  return limit > 0 ? limitVisibleBooks(localBooks, limit) : localBooks.map(normalizeBook);
}

async function saveBooksToStore(books) {
  const db = await connectMongo();

  if (db) {
    try {
      const collection = db.collection('books');
      await collection.deleteMany({});
      if (books.length) {
        await collection.insertMany(books.map((book) => ({ ...book, createdAt: book.createdAt || new Date().toISOString() })));
      }
      writeJson(BOOKS_FILE, books);
      return;
    } catch (error) {
      console.warn('Failed to save books to MongoDB, using local files instead.');
    }
  }

  writeJson(BOOKS_FILE, books);
}

async function getOrdersFromStore() {
  const db = await connectMongo();

  if (db) {
    try {
      return await db.collection('orders').find({}).sort({ createdAt: -1 }).toArray();
    } catch (error) {
      console.warn('Unable to load orders from MongoDB, falling back to JSON files.');
    }
  }

  return readJson(ORDERS_FILE, []);
}

async function saveOrdersToStore(orders) {
  const db = await connectMongo();

  if (db) {
    try {
      const collection = db.collection('orders');
      await collection.deleteMany({});
      if (orders.length) {
        await collection.insertMany(orders);
      }
      return;
    } catch (error) {
      console.warn('Failed to save orders to MongoDB, using local files instead.');
    }
  }

  writeJson(ORDERS_FILE, orders);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.png';
      cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    }
  })
});

function formatCurrency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(value);
}

function createAdminToken() {
  return jwt.sign(
    {
      sub: 'coderslab-admin',
      email: ADMIN_ACCOUNT.email,
      role: 'admin'
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''; 

  if (!token) {
    return res.status(401).json({ message: 'Admin access is required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired admin token.' });
  }
}

function computeStats(books, orders) {
  const totalRevenue = orders.reduce((sum, order) => sum + Number(order.amount || 0), 0);
  const totalOrders = orders.length;
  const totalBooks = books.length;
  const soldCopies = orders.reduce((sum, order) => sum + Number(order.quantity || 1), 0);

  return { totalRevenue, totalOrders, totalBooks, soldCopies };
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));

if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

app.get('/', (_req, res) => {
  res.json({
    name: 'MyTechShelf API',
    status: 'running',
    message: 'Backend is running successfully.',
    endpoints: ['/api/books', '/api/orders', '/api/admin/login', '/api/payment-settings']
  });
});

app.get('/api/books', async (req, res) => {
  const category = String(req.query.category || '').trim();
  const sourceBooks = await getBooksFromStore({ limit: 0 });
  const filteredBooks = category
    ? sourceBooks.filter((book) => book.category === category)
    : sourceBooks.slice(0, MAX_BOOKS_VISIBLE);

  res.json(filteredBooks);
});

app.get('/api/books/:id', async (req, res) => {
  const books = await getBooksFromStore();
  const book = books.find((item) => item.id === req.params.id);

  if (!book) {
    return res.status(404).json({ message: 'Book not found.' });
  }

  res.json(book);
});

app.delete('/api/books/:id', async (req, res) => {
  const books = await getBooksFromStore({ limit: 0 });
  const remainingBooks = books.filter((book) => book.id !== req.params.id);

  await saveBooksToStore(remainingBooks);

  res.json({ success: true, message: 'Book deleted successfully.' });
});

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedPassword = String(password).trim();

  if (
    normalizedEmail === ADMIN_ACCOUNT.email.toLowerCase() &&
    normalizedPassword === ADMIN_ACCOUNT.password
  ) {
    return res.json({
      token: createAdminToken(),
      user: {
        email: ADMIN_ACCOUNT.email,
        name: 'CodersLab Admin'
      }
    });
  }

  return res.status(401).json({ message: 'Invalid email or password.' });
});

app.get('/api/orders', async (_req, res) => {
  const orders = await getOrdersFromStore();
  res.json(orders);
});

app.get('/api/stats', async (_req, res) => {
  const books = await getBooksFromStore();
  const orders = await getOrdersFromStore();
  res.json(computeStats(books, orders));
});

app.get('/api/payment-settings', requireAdmin, async (_req, res) => {
  res.json(getPaymentSettings());
});

app.post('/api/payment-settings', requireAdmin, upload.single('qrImage'), async (req, res) => {
  const currentSettings = getPaymentSettings();
  const upiId = String(req.body.upiId || currentSettings.upiId || PAYMENT_UPI).trim();
  const merchantName = String(req.body.merchantName || currentSettings.merchantName || 'CodersLab').trim();
  const note = String(req.body.note || currentSettings.note || 'Scan and pay using any UPI app.').trim();
  const qrImage = req.file ? `/uploads/${req.file.filename}` : String(req.body.qrImage || currentSettings.qrImage || '').trim();

  const updatedSettings = savePaymentSettings({
    upiId: upiId || PAYMENT_UPI,
    merchantName: merchantName || 'CodersLab',
    note: note || 'Scan and pay using any UPI app.',
    qrImage
  });

  res.json({
    success: true,
    message: 'Payment QR settings updated successfully.',
    paymentSettings: updatedSettings
  });
});

app.get('/api/qr', async (req, res) => {
  try {
    const amount = Number(req.query.amount || 0);
    const settings = getPaymentSettings();
    const upiId = String(req.query.upi || settings.upiId || PAYMENT_UPI).trim() || PAYMENT_UPI;
    const merchantName = String(settings.merchantName || 'CodersLab').trim() || 'CodersLab';

    if (settings.qrImage) {
      return res.json({
        qrDataUrl: settings.qrImage.startsWith('http') ? settings.qrImage : settings.qrImage,
        upi: upiId,
        amount: formatCurrency(amount),
        merchantName
      });
    }

    const payload = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${amount}&cu=INR`;
    const dataUrl = await QRCode.toDataURL(payload, {
      type: 'image/png',
      width: 500,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });

    res.json({
      qrDataUrl: dataUrl,
      upi: upiId,
      amount: formatCurrency(amount),
      merchantName
    });
  } catch (error) {
    res.status(500).json({ message: 'Unable to generate the QR code right now.' });
  }
});

app.post('/api/books', upload.array('images', 10), async (req, res) => {
  const books = await getBooksFromStore({ limit: 0 });
  const { title, author, description, price, category, imageUrl, std } = req.body;

  if (!title || !author || !description || !price) {
    return res.status(400).json({ message: 'Book title, author, description, and price are required.' });
  }

  const normalizedCategory = String(category || 'Programming Books').trim();
  const nextBook = normalizeBook({
    id: `book-${Date.now()}`,
    title: title.trim(),
    author: author.trim(),
    description: description.trim(),
    price: Number(price),
    category: normalizedCategory,
    std: String(std || '').trim(),
    image: req.files && req.files.length ? `/uploads/${req.files[0].filename}` : (imageUrl || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80'),
    featured: false,
    stock: 25,
    rating: 4.8,
    reviews: defaultReviews,
    createdAt: new Date().toISOString()
  });

  const updatedBooks = [nextBook, ...books];
  await saveBooksToStore(updatedBooks);

  res.status(201).json({ success: true, message: 'Book added successfully.', book: nextBook });
});

app.delete('/api/books/:id', async (req, res) => {
  const books = await getBooksFromStore();
  const updated = books.filter((b) => b.id !== req.params.id);
  await saveBooksToStore(updated);
  res.json({ success: true, message: 'Book deleted.' });
});

app.post('/api/orders', upload.single('screenshot'), async (req, res) => {
  const books = await getBooksFromStore();
  const orders = await getOrdersFromStore();

  const { bookId, name, email, whatsapp, deliveryType, amount, paymentStatus } = req.body;

  if (!bookId || !name || !email || !whatsapp) {
    return res.status(400).json({ message: 'Name, email, and WhatsApp number are required.' });
  }

  const selectedBook = books.find((book) => book.id === bookId) || books[0];
  const orderAmount = Number(amount || selectedBook.price || 0);
  const screenshot = req.file ? `/uploads/${req.file.filename}` : '';
  const normalizedStatus = String(paymentStatus || (screenshot ? 'Paid' : 'Pending')).trim();

  const newOrder = {
    id: `order-${Date.now()}`,
    bookId: selectedBook.id,
    bookTitle: selectedBook.title,
    amount: orderAmount,
    quantity: 1,
    paymentStatus: normalizedStatus === 'Paid' ? 'Paid' : 'Pending',
    sentPdf: false,
    deliveryType: deliveryType || 'soft copy',
    screenshot,
    customer: {
      name: name.trim(),
      email: email.trim(),
      whatsapp: whatsapp.trim()
    },
    createdAt: new Date().toISOString()
  };

  const updatedOrders = [newOrder, ...orders];
  await saveOrdersToStore(updatedOrders);

  res.status(201).json({
    success: true,
    message: normalizedStatus === 'Paid'
      ? 'Payment received successfully. We will send the PDF within 10–15 minutes. If not received, contact us at info@mytechshelf.in.'
      : 'Order received. Please complete the payment confirmation to unlock delivery.',
    order: newOrder
  });
});

app.patch('/api/orders/:id/sent-pdf', requireAdmin, async (req, res) => {
  const orders = await getOrdersFromStore();
  const orderIndex = orders.findIndex((order) => order.id === req.params.id);

  if (orderIndex === -1) {
    return res.status(404).json({ message: 'Order not found.' });
  }

  orders[orderIndex] = {
    ...orders[orderIndex],
    sentPdf: Boolean(req.body?.sentPdf)
  };

  await saveOrdersToStore(orders);
  res.json({ success: true, order: orders[orderIndex] });
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/admin/login', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.get('/admin/dashboard', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-dashboard.html'));
});

app.get('/admin/books', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-books.html'));
});

app.get('/admin/buyers', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-buyers.html'));
});

app.get('/admin/payment', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin-payment.html'));
});

app.get('/favorites', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'favorites.html'));
});

app.get('/more-books', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'more-books.html'));
});

app.get('/books', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'category-books.html'));
});

app.get('/cart', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'cart.html'));
});

app.get('/checkout', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'checkout.html'));
});

app.get('/book/:id', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'book.html'));
});

app.use((req, res) => {
  const requestedPath = req.originalUrl;

  if (!fs.existsSync(PUBLIC_DIR)) {
    return res.status(404).json({
      message: 'Route not found for this backend-only deployment.',
      requestedPath,
      note: 'Frontend is served from a separate GitHub Pages repo.'
    });
  }

  if (requestedPath === '/admin.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
  }

  if (requestedPath === '/admin-dashboard.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'admin-dashboard.html'));
  }

  if (requestedPath === '/admin-books.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'admin-books.html'));
  }

  if (requestedPath === '/admin-buyers.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'admin-buyers.html'));
  }

  if (requestedPath === '/admin-payment.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'admin-payment.html'));
  }

  if (requestedPath === '/more-books.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'more-books.html'));
  }

  if (requestedPath === '/favorites.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'favorites.html'));
  }

  if (requestedPath === '/category-books.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'category-books.html'));
  }

  if (requestedPath === '/cart.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'cart.html'));
  }

  if (requestedPath === '/checkout.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'checkout.html'));
  }

  if (requestedPath === '/book.html') {
    return res.sendFile(path.join(PUBLIC_DIR, 'book.html'));
  }

  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }

  return res.status(404).json({
    message: 'Frontend file not found in this backend-only repo.',
    requestedPath,
    note: 'The frontend should be deployed separately on GitHub Pages.'
  });
});

ensureDirectories();

app.listen(PORT, () => {
  console.log(`CodersLab server running on http://localhost:${PORT}`);
});
