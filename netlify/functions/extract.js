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

  // 2. Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // 3. SECURE KEY RETRIEVAL
  // We read the key from Netlify's environment variables
  const API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: "API Key is not configured in Netlify." })
    };
  }

  try {
    const payload = JSON.parse(event.body);

    // 4. Call Anthropic with the Enhanced Prompt
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: payload.messages[0].content[0].type, // 'image' or 'document'
              source: payload.messages[0].content[0].source
            },
            {
              type: 'text',
              text: `You are an expert legal document analyzer for debt settlements. Extract data with extreme precision.

RETURN ONLY JSON. NO MARKDOWN.

JSON STRUCTURE:
{
  "paymentBreakdown": { "data": "extracted text with all amounts and dates", "confidence": "high|medium|low", "source": "exact quote", "notes": "concerns", "location": "where in doc" },
  "firstPaymentDate": { "data": "date", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "currentBalance": { 
    "data": "The total current balance/debt amount BEFORE settlement", 
    "confidence": "...", "source": "...", "notes": "...", "location": "..." 
  },
  "fees": { 
    "data": "List ANY fees explicitly (Attorney Fees, Court Costs, etc). If none, write 'None'. Format: 'Court: $X, Attorney: $Y'", 
    "confidence": "...", "source": "...", "notes": "...", "location": "..." 
  },
  "signatureRequired": { 
    "data": "YES or NO - Does the defendant/client need to sign this letter/stipulation?", 
    "confidence": "...", "source": "...", "notes": "If yes, specify who needs to sign", "location": "..." 
  },
  "remittanceTo": { "data": "Name of entity to remit to", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "mailingAddress": { "data": "Full mailing address", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "checkPayableTo": { "data": "Name on the check", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "clientName": { "data": "Client name", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "referenceNumber": { "data": "Account number", "confidence": "...", "source": "...", "notes": "...", "location": "..." },
  "additionalInstructions": { "data": "Any other instructions", "confidence": "...", "source": "...", "notes": "...", "location": "..." }
}

*** STRICT EXTRACTION RULES ***

1. "PAYABLE TO" vs "REMIT TO":
   - These are DIFFERENT. Do not confuse them.
   - checkPayableTo:
     - ONLY extract a specific name if the text explicitly says "Make check payable to", "Pay to the order of", or "Money orders to".
     - IF NO explicit instruction exists, default to the Name of the Creditor/Law Firm sending the letter.
   - remittanceTo:
     - This is the NAME of the entity receiving the mail.
     - Default to the Law Firm/Agency on the letterhead unless the body explicitly says "Remit payment to [Different Name]".
   - mailingAddress:
     - This is the ADDRESS where the mail goes.
     - Default to the Letterhead address unless the body explicitly says "Send payments to [Different Address]".

2. FEES & BALANCE:
   - Extract the "Current Balance" or "Amount Due" (the large amount before the settlement discount).
   - Look for specific line items for "Court Costs", "Attorney Fees", "Service Fees". List them specifically in the 'fees' field.

3. SIGNATURE:
   - Look for "Please sign and return", "Agreed to by:", "Defendant Signature:", or "Stipulation" lines.
   - If the client must sign, set signatureRequired.data to "YES".

4. GENERAL:
   - If a specific field is not found, set data to "NOT FOUND" and confidence to "low".
   - Do not hallucinate addresses.`
            }
          ]
        }]
      })
    });

    const data = await response.json();

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};