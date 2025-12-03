const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Nanonets Configuration
const NANONETS_API_KEY = '2a800ebb-cf81-11f0-8d61-1e8c60226715';
const NANONETS_MODEL_ID = 'db63ed6e-31a1-48d5-8d4e-84acc595d31c';

// In-memory storage for demo
const sessions = {};

// Serve static files
app.use(express.static('public'));
app.use(express.json());

// ==========================================
// NANONETS INTEGRATION (RAW DATA ONLY)
// ==========================================

/**
 * Extract invoice data using Nanonets - NO PROCESSING
 */
async function extractWithNanonets(filePath) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    try {
        const response = await axios.post(
            `https://app.nanonets.com/api/v2/OCR/Model/${NANONETS_MODEL_ID}/LabelFile/`,
            form,
            {
                auth: {
                    username: NANONETS_API_KEY,
                    password: ''
                },
                headers: form.getHeaders()
            }
        );

        if (response.data && response.data.result) {
            return parseNanonetsResponse(response.data.result);
        } else {
            throw new Error('Invalid Nanonets response');
        }
    } catch (error) {
        console.error('Nanonets API Error:', error.message);
        throw error;
    }
}

/**
 * Parse Nanonets response - JUST EXTRACT, NO PROCESSING
 */
function parseNanonetsResponse(results) {
    const invoices = [];

    console.log('\n📊 Nanonets Extraction (Raw Data)');
    console.log('═══════════════════════════════════════');
    console.log('Total results:', results.length);

    for (let r = 0; r < results.length; r++) {
        const result = results[r];
        const predictions = result.prediction || [];
        
        const invoice = {};
        
        // Store raw OCR text for Agent to extract missing fields
        if (result.ocr_text) {
            invoice.raw_ocr_text = result.ocr_text;
        }

        // Extract fields from predictions - RAW VALUES ONLY
        for (const pred of predictions) {
            const label = pred.label;
            const value = pred.ocr_text;

            // Direct extraction - NO TRANSFORMATION
            switch (label) {
                case 'invoice_number':
                    invoice.invoice_number = value;
                    break;
                case 'invoice_date':
                    invoice.invoice_date = value;
                    break;
                case 'seller_name':
                    invoice.seller_name = value;
                    break;
                case 'invoice_amount':
                case 'total_due_amount':
                    if (!invoice.invoice_amount) {
                        invoice.invoice_amount = value;
                    }
                    break;
                case 'subtotal':
                    if (!invoice.subtotal) {
                        invoice.subtotal = value;
                    }
                    break;
                case 'total_tax':
                    invoice.total_tax = value;
                    break;
                case 'total_tax_percentage':
                    if (!invoice.tax_percentage) {
                        invoice.tax_percentage = value;
                    }
                    break;
                case 'currency':
                    invoice.currency = value;
                    break;
                case 'seller_address':
                    invoice.seller_address = value;
                    break;
                case 'buyer_name':
                    invoice.buyer_name = value;
                    break;
                case 'po_number':
                    invoice.po_number = value;
                    break;
            }
        }

        if (Object.keys(invoice).length > 0) {
            console.log(`\n✓ Invoice ${r + 1}:`, invoice.invoice_number || 'N/A');
            invoices.push(invoice);
        }
    }

    console.log(`\n✅ Extracted ${invoices.length} raw invoices`);
    console.log('═══════════════════════════════════════\n');

    return invoices;
}

// ==========================================
// HELPER APIs FOR AGENT
// ==========================================

/**
 * Mock Exchange Rate API
 */
async function getExchangeRate(fromCurrency, toCurrency = 'AED') {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const rates = {
        'USD': 3.67,
        'EUR': 3.95,
        'AED': 1.00,
        'SAR': 0.98,
        'GBP': 4.52
    };

    const rate = rates[fromCurrency] || 1;

    return {
        success: true,
        from: fromCurrency,
        to: toCurrency,
        rate: rate,
        date: new Date().toISOString()
    };
}

/**
 * Mock Token Management
 */
async function getToken() {
    await new Promise(resolve => setTimeout(resolve, 300));
    return `TOKEN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function releaseToken(token) {
    await new Promise(resolve => setTimeout(resolve, 200));
    console.log(`✅ Token released: ${token}`);
    return { success: true };
}

/**
 * Mock Payables API
 */
async function bookInvoiceToPayables(invoiceData) {
    const token = await getToken();

    try {
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        const bookingRef = `AP-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

        return {
            success: true,
            reference: bookingRef,
            invoice_number: invoiceData.invoice_number,
            supplier_number: invoiceData.supplier_number,
            amount: invoiceData.total_amount,
            currency: invoiceData.currency,
            booked_at: new Date().toISOString(),
            token_used: token
        };
    } finally {
        await releaseToken(token);
    }
}

// ==========================================
// API ENDPOINTS
// ==========================================

/**
 * Upload page
 */
app.get('/upload/:sessionId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Upload and extract invoice - RAW DATA ONLY
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
    const sessionId = req.body.sessionId || 'DEMO';

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        console.log(`📄 Processing invoice for session: ${sessionId}`);

        // Extract with Nanonets - RAW DATA ONLY
        const rawInvoices = await extractWithNanonets(req.file.path);

        console.log(`✅ Extracted ${rawInvoices.length} invoice(s) - RAW DATA`);

        // Store RAW data in session
        sessions[sessionId] = {
            raw_invoices: rawInvoices,
            uploaded_at: new Date().toISOString(),
            status: 'raw_extracted'
        };

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        // Return RAW data for display
        res.json({
            success: true,
            count: rawInvoices.length,
            invoices: rawInvoices.map(inv => ({
                invoice_number: inv.invoice_number || 'N/A',
                seller_name: inv.seller_name || 'Unknown',
                invoice_amount: inv.invoice_amount || '0',
                currency: inv.currency || 'USD'
            }))
        });

    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({
            error: 'Failed to process invoice',
            message: error.message
        });
    }
});

/**
 * Get RAW invoice data (for Boomi Agent)
 */
app.get('/api/invoice/raw/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = sessions[sessionId];

    if (!session || !session.raw_invoices) {
        return res.status(404).json({ error: 'No invoice data found' });
    }

    res.json({
        success: true,
        count: session.raw_invoices.length,
        invoices: session.raw_invoices,
        note: 'Raw data - Agent should process with business logic'
    });
});

/**
 * Get exchange rate (for Boomi Agent)
 */
app.get('/api/exchange-rate/:currency', async (req, res) => {
    const { currency } = req.params;
    const toCurrency = req.query.to || 'AED';

    try {
        const rateData = await getExchangeRate(currency, toCurrency);
        res.json(rateData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get exchange rate' });
    }
});

// Simplified exchange rate endpoint for Boomi Agent (always returns to AED)
app.get('/api/rate/:currency', async (req, res) => {
    const { currency } = req.params;
    
    try {
        const rateData = await getExchangeRate(currency, 'AED');
        res.json(rateData);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get exchange rate' });
    }
});

// Get all exchange rates to AED (no parameters needed)
app.get('/api/exchange-rates', async (req, res) => {
    try {
        const rates = {
            success: true,
            base_currency: 'AED',
            rates: {
                EUR: 3.95,
                USD: 3.67,
                GBP: 4.82,
                SAR: 0.98,
                AED: 1.0
            },
            timestamp: new Date().toISOString()
        };
        
        res.json(rates);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get exchange rates' });
    }
});

/**
 * Book processed invoice (for Boomi Agent)
 */
app.post('/api/invoice/book', express.json(), async (req, res) => {
    const { sessionId, invoices } = req.body;

    // Validate invoices array
    if (!invoices || !Array.isArray(invoices)) {
        return res.status(400).json({ 
            error: 'Invalid invoice data',
            message: 'Expected "invoices" to be an array'
        });
    }

    if (invoices.length === 0) {
        return res.status(400).json({ 
            error: 'Invalid invoice data',
            message: 'Invoices array is empty'
        });
    }

    // Validate each invoice has required fields
    const requiredFields = ['invoice_number', 'supplier_number', 'total_amount', 'currency'];
    for (let i = 0; i < invoices.length; i++) {
        const invoice = invoices[i];
        const missingFields = requiredFields.filter(field => !invoice[field]);
        
        if (missingFields.length > 0) {
            return res.status(400).json({ 
                error: 'Invalid invoice data',
                message: `Invoice ${i + 1} (${invoice.invoice_number || 'unknown'}) missing fields: ${missingFields.join(', ')}`
            });
        }

        // Validate data types
        if (typeof invoice.supplier_number !== 'number') {
            return res.status(400).json({ 
                error: 'Invalid invoice data',
                message: `Invoice ${i + 1}: supplier_number must be a number, got ${typeof invoice.supplier_number}`
            });
        }

        if (typeof invoice.total_amount !== 'number') {
            return res.status(400).json({ 
                error: 'Invalid invoice data',
                message: `Invoice ${i + 1}: total_amount must be a number, got ${typeof invoice.total_amount}`
            });
        }
    }

    try {
        console.log(`📦 Booking ${invoices.length} invoice(s)...`);
        console.log('Sample invoice:', JSON.stringify(invoices[0], null, 2));

        // Book each invoice
        const bookingResults = await Promise.all(
            invoices.map(inv => bookInvoiceToPayables(inv))
        );

        // Update session
        if (sessionId && sessions[sessionId]) {
            sessions[sessionId].booking_results = bookingResults;
            sessions[sessionId].status = 'booked';
            sessions[sessionId].booked_at = new Date().toISOString();
        }

        console.log(`✅ All invoices booked successfully`);

        res.json({
            success: true,
            count: bookingResults.length,
            bookings: bookingResults
        });

    } catch (error) {
        console.error('❌ Booking error:', error);
        res.status(500).json({
            error: 'Failed to book invoices',
            message: error.message
        });
    }
});

/**
 * Update invoice data (after user review)
 */
app.put('/api/invoice/:sessionId', express.json(), (req, res) => {
    const { sessionId } = req.params;
    const { data } = req.body;

    if (!sessions[sessionId]) {
        sessions[sessionId] = {};
    }

    // Store user-edited raw data
    if (data && data.invoices) {
        sessions[sessionId].raw_invoices = data.invoices;
        sessions[sessionId].status = 'user_reviewed';
        sessions[sessionId].updated_at = new Date().toISOString();
    }

    res.json({
        success: true,
        message: 'Invoice data updated successfully'
    });
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        mode: 'agent_version',
        nanonets: 'configured',
        model_id: NANONETS_MODEL_ID,
        sessions: Object.keys(sessions).length,
        note: 'Returns raw data - Agent processes with business logic'
    });
});

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════╗');
    console.log('║   Transmed Invoice API (Agent Ver)   ║');
    console.log('╚═══════════════════════════════════════╝');
    console.log('');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 Upload URL: http://localhost:${PORT}/upload/DEMO`);
    console.log(`🧪 Health check: http://localhost:${PORT}/health`);
    console.log('');
    console.log('📋 Mode: Agent-Driven Processing');
    console.log('   - Returns RAW Nanonets data');
    console.log('   - Agent handles business logic');
    console.log('');
    console.log('🎯 Agent APIs:');
    console.log('   GET  /api/invoice/raw/:sessionId');
    console.log('   GET  /api/exchange-rate/:currency');
    console.log('   POST /api/invoice/book');
    console.log('');
    console.log('🚀 Ready for Agent orchestration!');
    console.log('');
});
