exports.handler = async function(event, context) {
  // 1. Handle CORS
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

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "API Key is not configured in Netlify." })
    };
  }

  try {
    const payload = JSON.parse(event.body);

    // 2. Setup Timeout Controller (Stop at 9.5 seconds to avoid Netlify 504 crash)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9500);

    // 3. Call Anthropic with the "Latest" Alias (Safest for compatibility)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-latest', // STABLE ALIAS
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
              // Optimized prompt to be faster (saves ~2 seconds of processing)
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
      console.error("Anthropic API Error:", errData);
      throw new Error(errData.error?.message || `API Error: ${response.status}`);
    }

    const data = await response.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error("Function Error:", error);
    
    // Handle the specific timeout error gracefully
    if (error.name === 'AbortError') {
      return {
        statusCode: 504,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Timeout: The document was too large to process in 10 seconds. Please try uploading a screenshot (Image) instead of a PDF, or just the first page." })
      };
    }

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: error.message })
    };
  }
};