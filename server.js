// BlockChat Relay Server
// WebSocket relay with wallet-based routing and file uploads

import express from 'express';
import { WebSocketServer } from 'ws';
import { ethers } from 'ethers';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
const uploadsDir = path.join(__dirname, 'uploads');
// Ensure uploads directory exists (Railway ephemeral fs still needs the dir present)
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use('/uploads', express.static(uploadsDir));

// File upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|webm|mp3|wav|ogg|webm|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connectedClients: clients.size,
    uptime: process.uptime()
  });
});

// File upload endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    
    console.log('📁 File uploaded:', {
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype,
      url: fileUrl
    });

    res.json({
      success: true,
      fileUrl,
      filename: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Start HTTP server
// Bind to 0.0.0.0 which is required on some PaaS (like Railway)
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 BlockChat Relay Server running on port ${PORT}`);
  console.log(`📁 Upload endpoint: http://localhost:${PORT}/upload`);
  console.log(`🔌 WebSocket ready for connections`);
});

// WebSocket Server
const wss = new WebSocketServer({ server });

// Store connected clients: Map<normalizedAddress, WebSocket>
const clients = new Map();

// Normalize wallet address using ethers.js
function normalizeAddress(addr) {
  if (!addr || typeof addr !== 'string') return null;
  try {
    // First get checksum address, then lowercase for consistent comparison
    return ethers.getAddress(addr).toLowerCase();
  } catch (error) {
    console.warn('⚠️ Address normalization failed, using lowercase:', addr);
    return addr.toLowerCase();
  }
}

// Broadcast connection count to all clients
function broadcastStats() {
  const stats = {
    type: 'server-stats',
    connectedClients: clients.size,
    timestamp: Date.now()
  };
  
  clients.forEach((ws) => {
    if (ws.readyState === 1) { // OPEN
      try {
        ws.send(JSON.stringify(stats));
      } catch (err) {
        console.error('Failed to send stats:', err.message);
      }
    }
  });
}

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log('🔌 New WebSocket connection from', clientIp);

  let clientAddress = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle registration
      if (message.type === 'register') {
        const rawAddress = message.address || message.walletAddress;
        if (!rawAddress) {
          console.error('❌ Registration failed: no address provided');
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'No wallet address provided' 
          }));
          return;
        }

        const normalizedAddress = normalizeAddress(rawAddress);
        if (!normalizedAddress) {
          console.error('❌ Registration failed: invalid address format');
          ws.send(JSON.stringify({ 
            type: 'error', 
            message: 'Invalid wallet address format' 
          }));
          return;
        }

        // Remove old connection if exists
        if (clients.has(normalizedAddress)) {
          const oldWs = clients.get(normalizedAddress);
          if (oldWs !== ws && oldWs.readyState === 1) {
            console.log('🔄 Replacing existing connection for', normalizedAddress);
            oldWs.close();
          }
        }

        // Store new connection
        clientAddress = normalizedAddress;
        clients.set(normalizedAddress, ws);
        
        console.log('✅ Registered wallet:', normalizedAddress);
        console.log('📊 Total connected clients:', clients.size);

        // Send registration acknowledgment
        ws.send(JSON.stringify({ 
          type: 'registered',
          address: normalizedAddress,
          timestamp: Date.now()
        }));

        // Also send 'ack' for compatibility
        ws.send(JSON.stringify({ 
          type: 'ack',
          address: normalizedAddress
        }));

        broadcastStats();
        return;
      }

      // Handle all other messages - route to recipient
      const fromAddress = normalizeAddress(message.from);
      const toAddress = normalizeAddress(message.to);

      if (!fromAddress || !toAddress) {
        console.warn('⚠️ Message missing from/to addresses:', message.type);
        return;
      }

      // Log message routing
      console.log('📨 Routing message:', {
        type: message.type,
        from: fromAddress.slice(0, 10) + '...',
        to: toAddress.slice(0, 10) + '...',
        timestamp: new Date().toLocaleTimeString()
      });

      // Find recipient
      const recipientWs = clients.get(toAddress);

      if (!recipientWs || recipientWs.readyState !== 1) {
        console.warn('⚠️ Recipient not connected:', toAddress);
        
        // Send delivery failure back to sender
        if (clientAddress && clients.has(fromAddress)) {
          ws.send(JSON.stringify({
            type: 'delivery-failed',
            originalMessage: message,
            reason: 'Recipient not connected',
            timestamp: Date.now()
          }));
        }
        return;
      }

      // Forward message to recipient
      try {
        recipientWs.send(JSON.stringify(message));
        console.log('✅ Message delivered:', message.type, 'from', fromAddress.slice(0, 10), 'to', toAddress.slice(0, 10));

        // Send delivery confirmation back to sender
        if (message.type === 'message' || message.type === 'media' || message.type === 'voice') {
          ws.send(JSON.stringify({
            type: 'message-delivered',
            messageId: message.messageId,
            to: toAddress,
            timestamp: Date.now()
          }));
        }
      } catch (error) {
        console.error('❌ Failed to deliver message:', error.message);
      }

    } catch (error) {
      console.error('❌ Message processing error:', error.message);
      console.error('Raw data:', data.toString().slice(0, 200));
    }
  });

  ws.on('close', () => {
    if (clientAddress) {
      clients.delete(clientAddress);
      console.log('🔌 Client disconnected:', clientAddress);
      console.log('📊 Remaining clients:', clients.size);
      broadcastStats();
    } else {
      console.log('🔌 Unregistered client disconnected');
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
    if (clientAddress) {
      clients.delete(clientAddress);
    }
  });

  // Send initial ping
  ws.send(JSON.stringify({ 
    type: 'ping',
    timestamp: Date.now() 
  }));
});

// Periodic cleanup of dead connections
setInterval(() => {
  let cleaned = 0;
  clients.forEach((ws, address) => {
    if (ws.readyState !== 1) { // Not OPEN
      clients.delete(address);
      cleaned++;
    }
  });
  
  if (cleaned > 0) {
    console.log('🧹 Cleaned up', cleaned, 'dead connections');
    broadcastStats();
  }
}, 30000); // Every 30 seconds

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`🛑 ${signal} received, closing server...`);

  // Close all client sockets
  clients.forEach((ws) => {
    try { ws.close(); } catch (e) { /* ignore */ }
  });

  // Close WebSocket server (stop accepting new upgrades)
  try { wss.close(); } catch (e) { /* ignore */ }

  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

console.log('✅ Relay server initialized');
