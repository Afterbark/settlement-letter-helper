const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for large images/PDFs
app.use(express.static(__dirname)); // Serve index.html from root

// API Endpoint
app.post('/extract', async (req, res) => {
  const API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: "API Key is not configured in Heroku Config Vars." });
  }

  try {
    // Safety Timeout (Heroku has a 30s limit, we stop at 28s)
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
        model: 'claude-3-5-sonnet-20241022', // Stable Model
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
              text: `Extract debt settlement details. RETURN JSON ONLY.

STRUCTURE:
{
  "paymentBreakdown": { "data": "...", "confidence": "high|medium|low", "source": "...", "notes": "...", "location": "..." },
  "firstPaymentDate": { "data": "...", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "currentBalance": { "data": "...", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "fees": { "data": "List fees or 'None'", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "signatureRequired": { "data": "YES or NO", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "remittanceTo": { "data": "Entity Name", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "mailingAddress": { "data": "Address", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "checkPayableTo": { "data": "Payable Name", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "clientName": { "data": "Name", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "referenceNumber": { "data": "Ref Number", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "additionalInstructions": { "data": "Instructions", "confidence": "...", "source": "...", "notes": "...", "location": "..." }
}

RULES:
1. payableTo: Only if explicit "Make check payable to". Else default to Creditor.
2. remitTo: Entity receiving mail. Default to Letterhead.
3. mailingAddress: Payment address. Default to Letterhead.
4. fees: List Court Costs/Attorney Fees.
5. signature: YES if client must sign.`
            }
          ]
        }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error("Server Error:", error);
    if (error.name === 'AbortError') {
      return res.status(504).json({ error: "Timeout: Heroku limit reached (28s). Please upload a smaller screenshot." });
    }
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});