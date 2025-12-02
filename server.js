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

// Auto-initialize DEMO session on server startup
sessions.set('DEMO', {
  status: 'pending',
  createdAt: new Date().toISOString(),
  invoices: [] // Support multiple invoices
});
console.log('✅ DEMO session initialized');

// API 1: Create new invoice session (fixed DEMO session)
app.post('/api/invoice/new', (req, res) => {
  const sessionId = 'DEMO';
  const uploadUrl = `${req.protocol}://${req.get('host')}/upload/${sessionId}`;
  
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      status: 'pending',
      createdAt: new Date().toISOString(),
      invoices: []
    });
  }
  
  res.json({
    success: true,
    sessionId,
    uploadUrl
  });
});

// API 2: Get invoice data - returns array of invoices
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
    data: session.data || null,
    count: session.data?.count || 0,
    invoices: session.data?.invoices || []
  });
});

// API 2.5: Update invoice data (from form submission) - supports array of invoices
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
    message: `${req.body.data.count || 1} invoice(s) saved successfully`
  });
});

// API 3: Finalize invoice - processes all invoices and returns array of references
app.post('/api/invoice/:sessionId/finalize', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({
      success: false,
      message: 'Session not found'
    });
  }
  
  if (!session.data || !session.data.invoices) {
    return res.status(400).json({
      success: false,
      message: 'No invoices to finalize'
    });
  }
  
  // Generate reference numbers for all invoices
  const references = session.data.invoices.map((inv, idx) => {
    const ref = 'AP-2025-' + Math.floor(10000 + Math.random() * 90000);
    return {
      invoiceNumber: inv.invoice,
      supplier: inv.supplier,
      amount: inv.amount,
      currency: inv.currency,
      date: inv.date,
      reference: ref
    };
  });
  
  session.status = 'completed';
  session.references = references;
  session.completedAt = new Date().toISOString();
  
  res.json({
    success: true,
    count: references.length,
    references: references,
    message: `${references.length} invoice(s) booked successfully`
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
