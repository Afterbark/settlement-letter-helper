const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Endpoint
app.post('/extract', async (req, res) => {
  const API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not found in environment variables');
    return res.status(500).json({ 
      error: "API Key is not configured. Please set ANTHROPIC_API_KEY in Heroku Config Vars." 
    });
  }

  try {
    console.log('📤 Processing document extraction request...');
    
    // Heroku has a 30s timeout, abort at 28s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 28000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', // Latest Sonnet 4
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: req.body.messages[0].content[0].type,
              source: req.body.messages[0].content[0].source
            },
            {
              type: 'text',
              text: `Extract debt settlement payment details from this document. Return ONLY valid JSON with no markdown formatting.

REQUIRED JSON STRUCTURE:
{
  "paymentBreakdown": {
    "data": "Payment schedule with amounts and dates",
    "confidence": "high|medium|low",
    "source": "Exact quote from document",
    "notes": "Any clarifications",
    "location": "Where found in document"
  },
  "firstPaymentDate": {
    "data": "First payment due date",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Any clarifications",
    "location": "Location description"
  },
  "currentBalance": {
    "data": "Total settlement amount",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Any clarifications",
    "location": "Location description"
  },
  "fees": {
    "data": "List all fees or 'None'",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Any clarifications",
    "location": "Location description"
  },
  "signatureRequired": {
    "data": "YES or NO",
    "confidence": "high|medium|low",
    "source": "Exact quote or explanation",
    "notes": "Any clarifications",
    "location": "Location description"
  },
  "remittanceTo": {
    "data": "Entity name that receives payment",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Default to letterhead if not stated",
    "location": "Location description"
  },
  "mailingAddress": {
    "data": "Complete mailing address for payment",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Default to letterhead if not stated",
    "location": "Location description"
  },
  "checkPayableTo": {
    "data": "Name for check payable",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Only if explicitly stated",
    "location": "Location description"
  },
  "clientName": {
    "data": "Client/debtor name",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Any clarifications",
    "location": "Location description"
  },
  "referenceNumber": {
    "data": "Account/reference number",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Any clarifications",
    "location": "Location description"
  },
  "additionalInstructions": {
    "data": "Any special payment instructions",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Include special requirements",
    "location": "Location description"
  }
}

EXTRACTION RULES:
1. If information not found, use "NOT FOUND" as data value
2. Confidence levels:
   - high: Clearly stated and unambiguous
   - medium: Implied or requires interpretation
   - low: Unclear or possibly incorrect
3. Source must be exact text from document
4. Location describes where in document
5. Return ONLY the JSON object, no markdown code blocks`
            }
          ]
        }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('❌ API Error:', response.status, errData);
      throw new Error(errData.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Document processed successfully');
    res.json(data);

  } catch (error) {
    console.error('❌ Server Error:', error.name, error.message);
    
    if (error.name === 'AbortError') {
      return res.status(504).json({ 
        error: "Timeout: Processing took longer than 28 seconds. Please upload a smaller file or screenshot instead of full PDF." 
      });
    }
    
    res.status(500).json({ 
      error: error.message || 'Failed to process document' 
    });
  }
});

// Catch-all route - serve index.html for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 API Key configured: ${!!process.env.ANTHROPIC_API_KEY}`);
});