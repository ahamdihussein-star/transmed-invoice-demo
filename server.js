const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve upload page
app.get('/upload/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// In-memory storage for demo - single session
const sessions = new Map();

// API 1: Create new invoice session (fixed DEMO session)
app.post('/api/invoice/new', (req, res) => {
  const sessionId = 'DEMO';
  const uploadUrl = `${req.protocol}://${req.get('host')}/upload/${sessionId}`;
  
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      status: 'pending',
      createdAt: new Date().toISOString()
    });
  }
  
  res.json({
    success: true,
    sessionId,
    uploadUrl
  });
});

// API 2: Get invoice data
app.get('/api/invoice/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session not found'
    });
  }
  
  res.json({
    success: true,
    status: session.status,
    data: session.data || null
  });
});

// API 2.5: Update invoice data (from form submission)
app.put('/api/invoice/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session not found'
    });
  }
  
  session.data = req.body.data;
  session.status = 'submitted';
  
  res.json({
    success: true,
    message: 'Data saved successfully'
  });
});

// API 3: Finalize invoice
app.post('/api/invoice/:sessionId/finalize', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session not found'
    });
  }
  
  const invoiceRef = 'AP-2025-' + Math.floor(10000 + Math.random() * 90000);
  session.status = 'completed';
  session.invoiceRef = invoiceRef;
  session.completedAt = new Date().toISOString();
  
  res.json({
    success: true,
    invoiceRef,
    message: 'Invoice booked successfully'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
