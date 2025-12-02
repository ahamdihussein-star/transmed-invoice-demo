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
// HELPER FUNCTIONS - Business Logic
// ==========================================

/**
 * Determine supplier number based on business rules
 */
function determineSupplierNumber(deliveredFrom, countryOfOrigin, brand) {
    const from = (deliveredFrom || '').toLowerCase().trim();
    const country = (countryOfOrigin || '').toLowerCase().trim();
    const brandLower = (brand || '').toLowerCase().trim();

    // Procter & Gamble rules
    if (from.includes('procter')) {
        if (country.includes('egypt')) return 400001;
        if (country.includes('saudi') || country.includes('bahrain')) return 400002;
        if (brandLower.includes('vicks')) return 400003;
        return 400000; // Default P&G
    }

    // Other suppliers
    if (from.includes('nutricia')) return 500001;
    if (from.includes('oatly')) return 600001;

    return 999999; // Unknown supplier
}

/**
 * Convert European decimal format to standard
 */
function convertDecimalFormat(value) {
    if (!value) return 0;
    // Convert "1.234,56" to "1234.56"
    return parseFloat(
        value.toString()
            .replace(/\./g, '')  // Remove thousand separators
            .replace(/,/g, '.')  // Convert comma to period
    ) || 0;
}

/**
 * Format date to dd/mm/yyyy
 */
function formatDate(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

/**
 * Transform extracted data to business format
 */
function transformInvoiceData(extractedData) {
    const delivered_from = extractedData.delivered_from || extractedData.Delivered_From || '';
    const country_oo = extractedData.country_of_origin || extractedData.Country_of_origin || '';
    const brand = extractedData.brand || extractedData.Brand || '';
    const currency = extractedData.currency || extractedData.Currency || 'USD';

    return {
        invoice_number: extractedData.invoice_number || extractedData.invoice_number || 'N/A',
        delivered_from: delivered_from.trim(),
        country_oo: country_oo,
        supplier_number: determineSupplierNumber(delivered_from, country_oo, brand),
        brand: brand,
        invoice_date: extractedData.invoice_date || extractedData.Invoice_Date || new Date().toISOString(),
        gl_date: formatDate(new Date()),
        total_payable: convertDecimalFormat(extractedData.total_payable || extractedData.Total_Payable || 0),
        total_price: convertDecimalFormat(extractedData.total_price || extractedData.Total_Price || 0),
        vat: convertDecimalFormat(extractedData.vat || extractedData.VAT_Amount || 0),
        slog_discount: convertDecimalFormat(extractedData.slog_discount || extractedData.SLOG_Discount || 0),
        currency: currency === 'DHS' ? 'AED' : currency,
        tax_rate_area: '',
        tax_ex: '',
        exchange_rate: 1,
        supplier_name: extractedData.supplier_name || extractedData.Supplier_Name || 'Unknown'
    };
}

/**
 * Calculate tax fields
 */
function calculateTaxFields(invoiceData) {
    if (invoiceData.vat > 0) {
        invoiceData.tax_rate_area = 'VD03';
        invoiceData.tax_ex = 'V';
    }
    return invoiceData;
}

// ==========================================
// MOCK APIs
// ==========================================

/**
 * Mock Exchange Rate API
 */
async function fetchExchangeRate(currency) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    const rates = {
        'USD': 3.67,
        'EUR': 3.95,
        'AED': 1.00,
        'SAR': 0.98,
        'GBP': 4.52
    };

    return {
        success: true,
        currency: currency,
        rate: rates[currency] || 1,
        base: 'AED',
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
            amount: invoiceData.total_payable,
            currency: invoiceData.currency,
            booked_at: new Date().toISOString(),
            token_used: token
        };
    } finally {
        await releaseToken(token);
    }
}

// ==========================================
// NANONETS INTEGRATION
// ==========================================

/**
 * Extract invoice data using Nanonets
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
 * Parse Nanonets response to extract invoice data
 */
function parseNanonetsResponse(results) {
    const invoices = [];

    console.log('\n═════════════════════════════════════════');
    console.log('📊 NANONETS RESPONSE DEBUG');
    console.log('═════════════════════════════════════════');
    console.log('Total results:', results.length);

    // Nanonets returns array of predictions
    for (let r = 0; r < results.length; r++) {
        const result = results[r];
        const predictions = result.prediction || [];
        
        console.log(`\n--- Result #${r + 1} ---`);
        console.log('Predictions count:', predictions.length);
        
        const invoice = {};

        // LOG ALL LABELS to see what Nanonets actually returns
        console.log('\nAvailable labels:');
        predictions.forEach((pred, i) => {
            console.log(`  [${i}] label: "${pred.label}" = "${pred.ocr_text?.substring(0, 50)}..."`);
        });

        // Extract fields from predictions
        for (const pred of predictions) {
            const label = pred.label;
            const value = pred.ocr_text;

            // Map Nanonets labels to our fields (trying all possible variations)
            const labelLower = label?.toLowerCase() || '';
            
            if (labelLower.includes('invoice') && labelLower.includes('number')) {
                invoice.invoice_number = value;
            } else if (labelLower.includes('invoice') && labelLower.includes('date')) {
                invoice.invoice_date = value;
            } else if (labelLower.includes('supplier') || labelLower.includes('vendor') || labelLower === 'from') {
                invoice.supplier_name = value;
            } else if (labelLower.includes('total') || labelLower.includes('amount') || labelLower.includes('payable')) {
                if (!invoice.total_payable) { // Take first total found
                    invoice.total_payable = value;
                }
            } else if (labelLower.includes('price') && !labelLower.includes('unit')) {
                invoice.total_price = value;
            } else if (labelLower.includes('vat') || labelLower.includes('tax')) {
                invoice.vat = value;
            } else if (labelLower.includes('currency') || label === 'currency') {
                invoice.currency = value;
            } else if (labelLower.includes('delivered') || labelLower.includes('ship from')) {
                invoice.delivered_from = value;
            } else if (labelLower.includes('country') || labelLower.includes('origin')) {
                invoice.country_of_origin = value;
            } else if (labelLower.includes('brand')) {
                invoice.brand = value;
            }
        }

        console.log('\n📦 Extracted invoice:');
        console.log(JSON.stringify(invoice, null, 2));

        if (Object.keys(invoice).length > 0) {
            invoices.push(invoice);
        }
    }

    console.log('\n═════════════════════════════════════════');
    console.log(`✅ Final invoices count: ${invoices.length}`);
    console.log('═════════════════════════════════════════\n');

    return invoices;
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
 * Upload and extract invoice
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
    const sessionId = req.body.sessionId || 'DEMO';

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    try {
        console.log(`📄 Processing invoice for session: ${sessionId}`);

        // Extract with Nanonets
        const extractedInvoices = await extractWithNanonets(req.file.path);

        console.log(`✅ Extracted ${extractedInvoices.length} invoice(s)`);

        // Transform data
        const processedInvoices = extractedInvoices.map(inv => {
            const transformed = transformInvoiceData(inv);
            return calculateTaxFields(transformed);
        });

        // Store in session
        sessions[sessionId] = {
            invoices: processedInvoices,
            uploaded_at: new Date().toISOString(),
            status: 'extracted'
        };

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            count: processedInvoices.length,
            invoices: processedInvoices
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
 * Update invoice data (after user review)
 */
app.put('/api/invoice/:sessionId', express.json(), (req, res) => {
    const { sessionId } = req.params;
    const { data } = req.body;

    if (!sessions[sessionId]) {
        sessions[sessionId] = {};
    }

    // Update with user-edited data
    if (data && data.invoices) {
        sessions[sessionId].invoices = data.invoices;
        sessions[sessionId].status = data.status || 'updated';
        sessions[sessionId].updated_at = new Date().toISOString();
    }

    res.json({
        success: true,
        message: 'Invoice data updated successfully'
    });
});

/**
 * Get invoice data (for Boomi Agent)
 */
app.get('/api/invoice/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions[sessionId];

    if (!session || !session.invoices) {
        return res.status(404).json({ error: 'No invoice data found' });
    }

    // Fetch exchange rates for each invoice
    const invoicesWithRates = await Promise.all(
        session.invoices.map(async (inv) => {
            const rateData = await fetchExchangeRate(inv.currency);
            return {
                ...inv,
                exchange_rate: rateData.rate,
                exchange_rate_date: rateData.date
            };
        })
    );

    session.invoices = invoicesWithRates;
    session.status = 'enriched';

    res.json({
        success: true,
        count: invoicesWithRates.length,
        invoices: invoicesWithRates
    });
});

/**
 * Finalize invoice booking (for Boomi Agent)
 */
app.post('/api/finalize/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const session = sessions[sessionId];

    if (!session || !session.invoices) {
        return res.status(404).json({ error: 'No invoice data found' });
    }

    try {
        console.log(`📦 Booking ${session.invoices.length} invoice(s) to Payables...`);

        // Book each invoice
        const bookingResults = await Promise.all(
            session.invoices.map(inv => bookInvoiceToPayables(inv))
        );

        session.booking_results = bookingResults;
        session.status = 'booked';
        session.booked_at = new Date().toISOString();

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
 * Health check
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        nanonets: 'configured',
        model_id: NANONETS_MODEL_ID,
        sessions: Object.keys(sessions).length
    });
});

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════╗');
    console.log('║   Transmed Invoice Processing API    ║');
    console.log('╚═══════════════════════════════════════╝');
    console.log('');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 Upload URL: http://localhost:${PORT}/upload/DEMO`);
    console.log(`🧪 Health check: http://localhost:${PORT}/health`);
    console.log('');
    console.log('📋 Nanonets Integration:');
    console.log(`   Model ID: ${NANONETS_MODEL_ID}`);
    console.log(`   Status: Active`);
    console.log('');
    console.log('🚀 Ready to process invoices!');
    console.log('');
});
