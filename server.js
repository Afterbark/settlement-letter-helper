const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const CONFIG = {
  maxFileSize: 50 * 1024 * 1024, // 50MB
  apiTimeout: 28000, // 28 seconds (Heroku has 30s limit)
  model: 'claude-sonnet-4-20250514',
  maxTokens: 4096
};

// Request ID middleware for tracing
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID().slice(0, 8);
  res.setHeader('X-Request-ID', req.requestId);
  next();
});

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// Body parser with size limit
app.use(express.json({ limit: CONFIG.maxFileSize }));

// Static files
app.use(express.static(__dirname));

// Logger helper
const log = (requestId, level, message, data = {}) => {
  const timestamp = new Date().toISOString();
  const prefix = {
    info: '[INFO]',
    warn: '[WARN]',
    error: '[ERROR]',
    success: '[OK]'
  }[level] || '[LOG]';
  
  console.log(`${timestamp} ${prefix} [${requestId}] ${message}`, 
    Object.keys(data).length ? JSON.stringify(data) : '');
};

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    apiConfigured: !!process.env.ANTHROPIC_API_KEY
  };
  res.json(health);
});

// Validate request body
const validateRequest = (body) => {
  const errors = [];
  
  if (!body?.messages?.[0]?.content?.[0]) {
    errors.push('Missing document content');
    return { valid: false, errors };
  }
  
  const content = body.messages[0].content[0];
  
  if (!content.type || !['image', 'document'].includes(content.type)) {
    errors.push('Invalid content type. Must be "image" or "document"');
  }
  
  if (!content.source?.type || content.source.type !== 'base64') {
    errors.push('Invalid source type. Must be "base64"');
  }
  
  if (!content.source?.data) {
    errors.push('Missing base64 data');
  }
  
  const validMediaTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp'
  ];
  
  if (!validMediaTypes.includes(content.source?.media_type)) {
    errors.push(`Invalid media type. Allowed: ${validMediaTypes.join(', ')}`);
  }
  
  // Check base64 data size (rough estimate)
  const estimatedSize = (content.source?.data?.length || 0) * 0.75;
  if (estimatedSize > CONFIG.maxFileSize) {
    errors.push(`File too large. Maximum size: ${CONFIG.maxFileSize / (1024 * 1024)}MB`);
  }
  
  return { valid: errors.length === 0, errors };
};

// Build the extraction prompt
const buildExtractionPrompt = () => `Extract debt settlement payment details from this document. Return ONLY valid JSON with no markdown formatting or code blocks.

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
4. Location describes where in document (e.g., "top of page 1", "payment terms section")
5. Return ONLY the JSON object - no markdown, no explanations, no code blocks`;

// Main extraction endpoint
app.post('/extract', async (req, res) => {
  const { requestId } = req;
  log(requestId, 'info', 'Processing extraction request');

  // Check API key
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    log(requestId, 'error', 'API key not configured');
    return res.status(500).json({
      error: 'API Key is not configured. Please set ANTHROPIC_API_KEY in environment variables.',
      requestId
    });
  }

  // Validate request
  const validation = validateRequest(req.body);
  if (!validation.valid) {
    log(requestId, 'warn', 'Validation failed', { errors: validation.errors });
    return res.status(400).json({
      error: 'Invalid request',
      details: validation.errors,
      requestId
    });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.apiTimeout);

  try {
    const content = req.body.messages[0].content[0];
    
    log(requestId, 'info', 'Calling Anthropic API', {
      contentType: content.type,
      mediaType: content.source.media_type
    });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: CONFIG.model,
        max_tokens: CONFIG.maxTokens,
        messages: [{
          role: 'user',
          content: [
            {
              type: content.type,
              source: {
                type: 'base64',
                media_type: content.source.media_type,
                data: content.source.data
              }
            },
            {
              type: 'text',
              text: buildExtractionPrompt()
            }
          ]
        }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      log(requestId, 'error', 'Anthropic API error', {
        status: response.status,
        error: errorData
      });
      
      const errorMessage = errorData.error?.message || `API Error: ${response.status}`;
      
      // Handle specific error codes
      if (response.status === 401) {
        return res.status(500).json({
          error: 'Invalid API key. Please check your ANTHROPIC_API_KEY configuration.',
          requestId
        });
      }
      
      if (response.status === 429) {
        return res.status(429).json({
          error: 'Rate limit exceeded. Please wait a moment and try again.',
          requestId
        });
      }
      
      if (response.status === 400) {
        return res.status(400).json({
          error: 'Invalid document format. Please ensure the file is a valid PDF or image.',
          details: errorMessage,
          requestId
        });
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    log(requestId, 'success', 'Document processed successfully', {
      usage: data.usage
    });

    res.json(data);

  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      log(requestId, 'error', 'Request timeout');
      return res.status(504).json({
        error: 'Processing timeout. The document took too long to analyze.',
        suggestion: 'Try uploading a screenshot (PNG/JPG) instead of a PDF, or use a smaller file.',
        requestId
      });
    }

    log(requestId, 'error', 'Processing failed', {
      name: error.name,
      message: error.message
    });

    res.status(500).json({
      error: error.message || 'Failed to process document',
      requestId
    });
  }
});

// Catch-all route - serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  log(req.requestId || 'unknown', 'error', 'Unhandled error', {
    message: err.message,
    stack: err.stack
  });
  
  res.status(500).json({
    error: 'An unexpected error occurred',
    requestId: req.requestId
  });
});

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('Settlement Payment Extractor Server');
  console.log('='.repeat(50));
  console.log(`Port: ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`API Key: ${process.env.ANTHROPIC_API_KEY ? 'Configured' : 'NOT CONFIGURED'}`);
  console.log(`Model: ${CONFIG.model}`);
  console.log(`Timeout: ${CONFIG.apiTimeout}ms`);
  console.log('='.repeat(50));
});

module.exports = app;