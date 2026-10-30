
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }
});

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
let isMongoConnected = false;
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => {
      console.log('✅ MongoDB Connected - Permanent Database Active');
      isMongoConnected = true;
    })
    .catch(err => {
      console.error('❌ MongoDB Connection Error:', err);
      console.log('⚠️ Falling back to In-Memory Mode');
    });
} else {
  console.log('⚠️ No MONGODB_URI - Running in In-Memory Mode (Data will reset on restart)');
}

// MongoDB Schemas
const vendorSchema = new mongoose.Schema({
  company: String,
  name: String,
  email: { type: String, unique: true },
  phone: String,
  role: { type: String, default: 'vendor' },
  createdAt: { type: Date, default: Date.now }
});

const tenderSchema = new mongoose.Schema({
  title: String,
  description: String,
  budget: Number,
  deadline: String,
  category: String,
  status: { type: String, default: 'active' },
  createdAt: { type: Date, default: Date.now }
});

const Vendor = mongoose.models.Vendor || mongoose.model('Vendor', vendorSchema);
const Tender = mongoose.models.Tender || mongoose.model('Tender', tenderSchema);

// In-Memory fallback
let inMemoryVendors = [];
let inMemoryTenders = [];
let inMemoryBids = [];

// Routes
app.get('/', (req, res) => {
  res.json({ 
    message: 'UniTender API Running ✅ Permanent',
    mode: isMongoConnected ? 'MongoDB Permanent' : 'In-Memory',
    mongoConnected: isMongoConnected,
    socketio: 'Active',
    backend: 'https://unitender-permanent.onrender.com',
    endpoints: {
      vendors: '/api/vendors',
      tenders: '/api/tenders',
      register: '/api/auth/register',
      login: '/api/auth/login'
    }
  });
});

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, company, email, password, role } = req.body;
    const vendorData = { name: name || company, company: company || name, email, role: role || 'vendor' };
    
    if (isMongoConnected) {
      try {
        const existing = await Vendor.findOne({ email });
        if (existing) {
          return res.json({ success: true, message: 'Vendor already exists', vendor: existing });
        }
        const vendor = new Vendor(vendorData);
        await vendor.save();
        io.emit('vendor_registered', vendor);
        console.log('✅ Vendor saved to MongoDB:', email);
        return res.json({ success: true, vendor });
      } catch (err) {
        if (err.code === 11000) {
          return res.json({ success: true, message: 'Vendor already exists' });
        }
        throw err;
      }
    } else {
      // In-Memory
      if (!inMemoryVendors.find(v => v.email === email)) {
        inMemoryVendors.push({ ...vendorData, _id: Date.now().toString(), createdAt: new Date() });
      }
      io.emit('vendor_registered', vendorData);
      console.log('✅ Vendor saved to In-Memory:', email);
      return res.json({ success: true, vendor: vendorData });
    }
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  // Simple auth for demo
  if (email === 'admin@college.com' && password === 'admin123') {
    return res.json({ success: true, token: 'org-token-' + Date.now(), user: { email, role: 'org' } });
  }
  // Check vendor
  if (isMongoConnected) {
    const vendor = await Vendor.findOne({ email });
    if (vendor) {
      return res.json({ success: true, token: 'vendor-token-' + Date.now(), user: vendor });
    }
  } else {
    const vendor = inMemoryVendors.find(v => v.email === email);
    if (vendor) {
      return res.json({ success: true, token: 'vendor-token-' + Date.now(), user: vendor });
    }
  }
  res.json({ success: true, token: 'demo-token', user: { email, role: email.includes('admin') ? 'org' : 'vendor' } });
});

// Vendors
app.get('/api/vendors', async (req, res) => {
  try {
    if (isMongoConnected) {
      const vendors = await Vendor.find().sort({ createdAt: -1 });
      res.json(vendors);
    } else {
      res.json(inMemoryVendors);
    }
  } catch (err) {
    res.json(inMemoryVendors);
  }
});

app.post('/api/vendors', async (req, res) => {
  try {
    if (isMongoConnected) {
      const vendor = new Vendor(req.body);
      await vendor.save();
      io.emit('vendor_registered', vendor);
      res.json(vendor);
    } else {
      inMemoryVendors.push({ ...req.body, _id: Date.now().toString() });
      io.emit('vendor_registered', req.body);
      res.json(req.body);
    }
  } catch (err) {
    if (err.code === 11000) {
      res.json({ success: true, message: 'Already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// Tenders
app.get('/api/tenders', async (req, res) => {
  try {
    if (isMongoConnected) {
      const tenders = await Tender.find().sort({ createdAt: -1 });
      res.json(tenders);
    } else {
      res.json(inMemoryTenders);
    }
  } catch (err) {
    res.json(inMemoryTenders);
  }
});

app.post('/api/tenders', async (req, res) => {
  try {
    if (isMongoConnected) {
      const tender = new Tender(req.body);
      await tender.save();
      io.emit('tender_created', tender);
      res.json(tender);
    } else {
      const tender = { ...req.body, _id: Date.now().toString(), createdAt: new Date() };
      inMemoryTenders.push(tender);
      io.emit('tender_created', tender);
      res.json(tender);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Socket.io
io.on('connection', (socket) => {
  console.log('🔌 Device connected:', socket.id, '- Total:', io.engine.clientsCount);
  
  socket.on('vendor_registered', (data) => {
    console.log('📢 Broadcasting vendor_registered:', data.email || data.company);
    socket.broadcast.emit('vendor_registered', data);
  });
  
  socket.on('tender_created', (data) => {
    console.log('📢 Broadcasting tender_created:', data.title);
    socket.broadcast.emit('tender_created', data);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Device disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 UniTender Backend Running on port ${PORT}`);
  console.log(`📊 Mode: ${isMongoConnected ? 'MongoDB Permanent' : 'In-Memory'}`);
  console.log(`🔌 Socket.io: Active - Real-time cross-device sync ON`);
  console.log(`🌐 Backend URL: https://unitender-permanent.onrender.com`);
});
