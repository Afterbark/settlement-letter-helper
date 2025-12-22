exports.handler = async function(event, context) {
  // 1. Handle CORS preflight requests
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  // 2. Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { 
      statusCode: 405, 
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  // 3. Check for API key
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: { 
        "Content-Type": "application/json", 
        "Access-Control-Allow-Origin": "*" 
      },
      body: JSON.stringify({ 
        error: "API Key is not configured. Please add ANTHROPIC_API_KEY to Netlify environment variables." 
      })
    };
  }

  try {
    const payload = JSON.parse(event.body);

    // 4. Set timeout for Netlify's 10-second limit
    // Abort at 9.5s to return clean error instead of 504
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9500);

    // 5. Call Anthropic API with latest model
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', // Latest Sonnet 4 model
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: payload.messages[0].content[0].type,
              source: payload.messages[0].content[0].source
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
    "location": "Where found in document (e.g., 'Payment Terms section, paragraph 2')"
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
    "data": "List all fees (court costs, attorney fees) or 'None' if not applicable",
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
    "notes": "Default to letterhead entity if not explicitly stated",
    "location": "Location description"
  },
  "mailingAddress": {
    "data": "Complete mailing address for payment",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Default to letterhead address if not explicitly stated",
    "location": "Location description"
  },
  "checkPayableTo": {
    "data": "Name for check payable",
    "confidence": "high|medium|low",
    "source": "Exact quote",
    "notes": "Only if 'Make check payable to' is explicitly stated, otherwise use creditor name",
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
    "notes": "Include wire transfer details, overnight delivery requirements, etc.",
    "location": "Location description"
  }
}

EXTRACTION RULES:
1. If information is not found, use "NOT FOUND" as the data value
2. Confidence levels:
   - high: Information is clearly stated and unambiguous
   - medium: Information is implied or requires interpretation
   - low: Information is unclear or possibly incorrect
3. Source must be exact text from document
4. Location should describe where in the document (header, footer, specific section, page number if visible)
5. For remittanceTo and mailingAddress: default to letterhead information if not explicitly stated elsewhere
6. For checkPayableTo: only populate if "Make check payable to" or similar phrase exists
7. Return ONLY the JSON object, no markdown code blocks`
            }
          ]
        }]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // 6. Handle API errors
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error("Anthropic API Error:", response.status, errData);
      
      let errorMessage = `API Error: ${response.status}`;
      if (errData.error?.message) {
        errorMessage = errData.error.message;
      }
      
      throw new Error(errorMessage);
    }

    // 7. Return successful response
    const data = await response.json();
    return {
      statusCode: 200,
      headers: { 
        "Content-Type": "application/json", 
        "Access-Control-Allow-Origin": "*" 
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error("Function Error:", error.name, error.message);
    
    // Handle timeout errors
    if (error.name === 'AbortError') {
      return {
        statusCode: 504,
        headers: { 
          "Content-Type": "application/json", 
          "Access-Control-Allow-Origin": "*" 
        },
        body: JSON.stringify({ 
          error: "Request timeout: Document processing took too long (>9.5s). Try uploading a smaller file or a screenshot instead of the full PDF." 
        })
      };
    }

    // Handle all other errors
    return {
      statusCode: 500,
      headers: { 
        "Content-Type": "application/json", 
        "Access-Control-Allow-Origin": "*" 
      },
      body: JSON.stringify({ 
        error: error.message || "An unexpected error occurred while processing the document." 
      })
    };
  }
};