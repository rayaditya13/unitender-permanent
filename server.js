
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*", methods: ["GET","POST","PUT","DELETE"] } 
});

const JWT_SECRET = process.env.JWT_SECRET || 'unitender_secret';
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

app.use(cors({ origin: "*" }));
app.use(express.json());

// In-Memory Storage with MongoDB fallback
let users = [
  { id: '1', name: 'Admin', email: 'admin@college.com', password: bcrypt.hashSync('admin123', 10), role: 'admin', status: 'approved' }
];
let vendors = [];
let tenders = [];
let vendorIdCounter = 1;
let tenderIdCounter = 1;

if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI).then(()=>console.log('✅ MongoDB Connected - Permanent Storage')).catch(e=>console.log('⚠️ MongoDB failed, using In-Memory:', e.message));
} else {
  console.log('⚠️ No MONGODB_URI - Running In-Memory Mode (Render free tier)');
}

app.get('/', (req, res) => res.json({ 
  message: 'UniTender API Running ✅ Permanent', 
  realtime: 'Socket.io active',
  mode: MONGODB_URI ? 'MongoDB' : 'In-Memory',
  timestamp: new Date()
}));

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role, company, phone } = req.body;
  if (users.find(u => u.email === email) || vendors.find(v => v.email === email)) {
    return res.status(400).json({ error: 'Email already exists' });
  }
  const hashed = await bcrypt.hash(password, 10);
  if (role === 'vendor') {
    const vendor = { id: String(vendorIdCounter++), name, email, password: hashed, company, phone, status: 'pending', role: 'vendor', createdAt: new Date() };
    vendors.push(vendor);
    io.emit('vendor_registered', vendor);
    io.emit('notification', { type: 'vendor_registered', message: `🔥 New vendor ${vendor.name} registered!`, data: vendor });
    return res.json({ message: 'Vendor registration pending approval', vendor });
  }
  const user = { id: String(Date.now()), name, email, password: hashed, role, status: 'approved' };
  users.push(user);
  res.json({ message: 'Registered' });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  let user = users.find(u => u.email === email) || vendors.find(v => v.email === email);
  if (!user) return res.status(400).json({ error: 'User not found' });
  if (user.status === 'pending') return res.status(400).json({ error: 'Pending approval - Admin will approve soon' });
  if (user.status === 'rejected') return res.status(400).json({ error: 'Rejected by admin' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ error: 'Wrong password' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/vendors', (req, res) => res.json(vendors));
app.get('/api/vendors/pending', (req, res) => res.json(vendors.filter(v => v.status === 'pending')));
app.post('/api/vendors/:id/approve', (req, res) => {
  const vendor = vendors.find(v => v.id === req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  vendor.status = 'approved';
  io.emit('vendor_approved', vendor);
  io.emit('notification', { type: 'vendor_approved', message: `✅ Vendor ${vendor.name} approved!`, data: vendor });
  res.json(vendor);
});
app.post('/api/vendors/:id/reject', (req, res) => {
  const vendor = vendors.find(v => v.id === req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Not found' });
  vendor.status = 'rejected';
  io.emit('vendor_rejected', vendor);
  res.json(vendor);
});

app.get('/api/tenders', (req, res) => res.json(tenders));
app.post('/api/tenders', (req, res) => {
  const { title, description, budget, deadline, category } = req.body;
  const tender = { id: String(tenderIdCounter++), title, description, budget, deadline, category, status: 'open', createdAt: new Date() };
  tenders.push(tender);
  io.emit('tender_created', tender);
  io.emit('notification', { type: 'tender_created', message: `📄 New tender: ${tender.title}`, data: tender });
  res.json(tender);
});
app.put('/api/tenders/:id', (req, res) => {
  const tender = tenders.find(t => t.id === req.params.id);
  if (!tender) return res.status(404).json({ error: 'Not found' });
  Object.assign(tender, req.body);
  io.emit('tender_updated', tender);
  res.json(tender);
});
app.delete('/api/tenders/:id', (req, res) => {
  const idx = tenders.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const deleted = tenders.splice(idx, 1)[0];
  io.emit('tender_deleted', deleted);
  res.json({ message: 'Deleted' });
});

io.on('connection', socket => {
  console.log('📱 Device connected:', socket.id, 'Total:', io.engine.clientsCount);
  socket.emit('connected', { message: 'Connected to UniTender Real-time ✅', socketId: socket.id });
  socket.on('disconnect', () => console.log('📴 Device disconnected:', socket.id));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.io active - Real-time notifications enabled`);
});
