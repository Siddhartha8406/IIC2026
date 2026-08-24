/**
 * ============================================================================
 * Project Prometheus — NCC ANO Assistance System
 * Reference Node.js / Express Backend (Optional Companion Server)
 * ============================================================================
 * 
 * Responsibilities:
 * 1. AI Proxy: Securely holds AI Provider API Keys (Google Gemini / Anthropic)
 *    and proxies requests from the frontend without exposing secrets in browser code.
 * 2. Diagnostics & Health: Provides /api/health for instant frontend connectivity checks.
 * 3. Reference Security Implementation: Real JWT authentication, bcrypt password
 *    hashing, and role-based access control (RBAC) middleware for future multi-user
 *    network deployment beyond single-kiosk mode.
 * 
 * Running this server:
 *   npm install
 *   cp .env.example .env (and set GEMINI_API_KEY)
 *   node server-reference.js
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();

const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const JWT_SECRET = process.env.JWT_SECRET || 'prometheus_secret_jwt_key_change_me_in_production_12345';
const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const LOCAL_SHARED_SECRET = process.env.LOCAL_SHARED_SECRET || '';

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '15mb' }));

// Serve static assets (Subjects/ folder, etc.)
app.use(express.static(__dirname));

// Serve Project Prometheus application on root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Project-Prometheus-NCC-ANO-System.html'));
});

// ----------------------------------------------------------------------------
// CORS Configuration (§7.5)
// Allow null-Origin / file:// pages, all localhost ports, and configured origin
// ----------------------------------------------------------------------------
const allowedCustomOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors({
  origin: (origin, callback) => {
    // Browsers send Origin: null or omit Origin for file:// requests
    if (!origin || origin === 'null' || origin.startsWith('file://')) {
      return callback(null, true);
    }
    // Allow any localhost / 127.0.0.1 port
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    if (allowedCustomOrigin && origin === allowedCustomOrigin) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked request from origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-prometheus-secret', 'x-goog-api-key']
}));

// ----------------------------------------------------------------------------
// In-Memory Reference Data Store (for RBAC & Demo API)
// ----------------------------------------------------------------------------
const SALT_ROUNDS = 10;
const referenceUsers = [
  {
    id: 'usr-ano-001',
    username: 'ano_officer',
    passwordHash: bcrypt.hashSync('ano1234', SALT_ROUNDS),
    name: 'Capt. Rajesh Sharma',
    role: 'pc',
    unit: '1 Karnataka Bn NCC',
    regNo: 'ANO/NCC/KA/2018/1042'
  },
  {
    id: 'usr-cdt-001',
    username: 'cadet_amit',
    passwordHash: bcrypt.hashSync('cdt1234', SALT_ROUNDS),
    name: 'CDT Amit Kumar',
    role: 'kiosk',
    unit: '1 Karnataka Bn NCC',
    regNo: 'KA/22/SDA/10401'
  }
];

let referenceAuditLog = [
  {
    id: 'aud-seed-001',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    actor: 'System',
    role: 'system',
    action: 'SYSTEM_BOOT',
    details: 'Project Prometheus reference backend initialized on ' + HOST + ':' + PORT
  }
];

// ----------------------------------------------------------------------------
// Health Check Endpoint (§7.6)
// ----------------------------------------------------------------------------
app.get(['/health', '/api/health'], (req, res) => {
  const isGemini = AI_PROVIDER === 'gemini';
  const apiKey = isGemini ? process.env.GEMINI_API_KEY : process.env.ANTHROPIC_API_KEY;
  const configured = Boolean(apiKey && apiKey.trim() !== '' && apiKey !== 'your_gemini_api_key_here');

  res.json({
    status: 'ok',
    server: 'Project Prometheus Reference Backend',
    version: '1.0.0',
    provider: AI_PROVIDER,
    configured: configured,
    model: isGemini 
      ? (process.env.GEMINI_MODEL || 'gemini-3.6-flash') 
      : (process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022'),
    authActive: Boolean(JWT_SECRET),
    sharedSecretRequired: Boolean(LOCAL_SHARED_SECRET),
    timestamp: new Date().toISOString()
  });
});

// ----------------------------------------------------------------------------
// AI Proxy Route (§7.2, §7.3, §7.4)
// Securely forwards requests to Google Gemini or Anthropic without client keys
// ----------------------------------------------------------------------------
app.post('/api/ai/generate', async (req, res) => {
  try {
    // Optional shared secret check if exposed beyond localhost (§7.4)
    if (LOCAL_SHARED_SECRET) {
      const clientSecret = req.headers['x-prometheus-secret'];
      if (clientSecret !== LOCAL_SHARED_SECRET) {
        return res.status(401).json({
          error: 'Unauthorized: Invalid or missing x-prometheus-secret header',
          reason: 'SHARED_SECRET_MISMATCH'
        });
      }
    }

    const { prompt, systemInstruction, messages, temperature = 0.7, maxTokens = 1500 } = req.body;

    if (!prompt && (!messages || messages.length === 0)) {
      return res.status(400).json({
        error: 'Bad Request: "prompt" or non-empty "messages" array is required',
        reason: 'MISSING_PROMPT'
      });
    }

    // Provider: Google Gemini (Default)
    if (AI_PROVIDER === 'gemini') {
      const geminiKey = process.env.GEMINI_API_KEY;
      if (!geminiKey || geminiKey === 'your_gemini_api_key_here') {
        return res.status(503).json({
          error: 'AI service unavailable: GEMINI_API_KEY is not configured on the backend server.',
          reason: 'MISSING_GEMINI_KEY'
        });
      }

      // Default to gemini-3.6-flash
      let requestedModel = (process.env.GEMINI_MODEL || 'gemini-3.6-flash').trim();

      // Build Gemini contents array
      let contents = [];
      if (messages && Array.isArray(messages) && messages.length > 0) {
        contents = messages.map(m => ({
          role: (m.role === 'assistant' || m.role === 'model') ? 'model' : 'user',
          parts: [{ text: String(m.content || m.text || '') }]
        }));
      } else {
        contents = [{
          role: 'user',
          parts: [{ text: String(prompt || '') }]
        }];
      }

      const geminiPayload = {
        contents: contents,
        generationConfig: {
          temperature: Number(temperature) || 0.7,
          maxOutputTokens: Number(maxTokens) || 1500
        }
      };

      if (systemInstruction) {
        geminiPayload.systemInstruction = {
          parts: [{ text: String(systemInstruction) }]
        };
      }

      // Try primary model, with automatic fallback list if 404
      const candidateModels = [requestedModel, 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];
      const uniqueModels = [...new Set(candidateModels)];
      let lastErrorText = '';
      let lastStatus = 500;
      let successfulData = null;
      let usedModel = requestedModel;

      for (const currentModel of uniqueModels) {
        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`;

        try {
          const response = await fetch(geminiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': geminiKey
            },
            body: JSON.stringify(geminiPayload)
          });

          if (response.ok) {
            successfulData = await response.json();
            usedModel = currentModel;
            break;
          } else {
            lastStatus = response.status;
            lastErrorText = await response.text();
            console.warn(`[AI Proxy] Model ${currentModel} returned HTTP ${response.status}: ${lastErrorText}`);
            // If error is 404 (model not found), try next model in fallback list
            if (response.status !== 404) {
              break; // If quota (429) or invalid key (400/403), don't loop models
            }
          }
        } catch (fetchErr) {
          lastErrorText = fetchErr.message;
          break;
        }
      }

      if (!successfulData) {
        let parsedMessage = lastErrorText;
        try {
          const parsed = JSON.parse(lastErrorText);
          parsedMessage = parsed.error?.message || lastErrorText;
        } catch (e) {}

        console.error('[AI Proxy Error - Gemini API]', lastStatus, parsedMessage);
        return res.status(lastStatus).json({
          error: parsedMessage || `Gemini API returned status ${lastStatus}`,
          reason: 'UPSTREAM_API_ERROR',
          details: lastErrorText
        });
      }

      const extractedText = successfulData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (!extractedText && successfulData?.promptFeedback) {
        return res.status(422).json({
          error: 'Content was filtered or returned empty by the AI provider.',
          reason: 'CONTENT_FILTERED',
          feedback: successfulData.promptFeedback
        });
      }

      // Return standardized Anthropic-compatible format (§7.2)
      return res.json({
        provider: 'gemini',
        model: usedModel,
        content: [{ type: 'text', text: extractedText }],
        rawCandidates: successfulData.candidates
      });
    }

    // Provider: Anthropic Claude (Alternative)
    if (AI_PROVIDER === 'anthropic') {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey || anthropicKey === 'your_anthropic_api_key_here') {
        return res.status(503).json({
          error: 'AI service unavailable: ANTHROPIC_API_KEY is not configured on the backend server.',
          reason: 'MISSING_ANTHROPIC_KEY'
        });
      }

      const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-20241022';
      let anthropicMessages = [];

      if (messages && Array.isArray(messages) && messages.length > 0) {
        anthropicMessages = messages.map(m => ({
          role: m.role === 'model' ? 'assistant' : m.role,
          content: String(m.content || m.text || '')
        }));
      } else {
        anthropicMessages = [{ role: 'user', content: String(prompt || '') }];
      }

      const anthropicPayload = {
        model: model,
        max_tokens: Number(maxTokens) || 1500,
        temperature: Number(temperature) || 0.7,
        messages: anthropicMessages
      };

      if (systemInstruction) {
        anthropicPayload.system = String(systemInstruction);
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(anthropicPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AI Proxy Error - Anthropic API]', response.status, errorText);
        return res.status(response.status).json({
          error: `Anthropic API returned status ${response.status}`,
          reason: 'UPSTREAM_API_ERROR',
          details: errorText
        });
      }

      const anthropicData = await response.json();
      return res.json({
        provider: 'anthropic',
        model: model,
        content: anthropicData.content || [{ type: 'text', text: '' }]
      });
    }

    return res.status(400).json({
      error: `Unsupported AI_PROVIDER: ${AI_PROVIDER}. Use "gemini" or "anthropic".`,
      reason: 'UNSUPPORTED_PROVIDER'
    });

  } catch (err) {
    console.error('[AI Proxy Fatal Exception]', err);
    return res.status(500).json({
      error: 'Internal server error while processing AI request',
      reason: 'SERVER_EXCEPTION',
      message: err.message
    });
  }
});

// ----------------------------------------------------------------------------
// Reference Real JWT Authentication & RBAC Middleware (§2.3, §7.4)
// ----------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const user = referenceUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const tokenPayload = {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    unit: user.unit,
    regNo: user.regNo
  };

  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

  // Log login in audit trail
  referenceAuditLog.unshift({
    id: 'aud-' + Date.now(),
    timestamp: new Date().toISOString(),
    actor: user.name,
    role: user.role,
    action: 'USER_LOGIN',
    details: `Authenticated via reference backend JWT API (${user.role.toUpperCase()} role)`
  });

  return res.json({
    token: token,
    expiresIn: 28800,
    user: tokenPayload
  });
});

// Authentication middleware
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header with Bearer token required' });
  }

  const token = authHeader.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session token', details: err.message });
    }
    req.user = decoded;
    next();
  });
}

// RBAC middleware
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      referenceAuditLog.unshift({
        id: 'aud-' + Date.now(),
        timestamp: new Date().toISOString(),
        actor: req.user?.name || 'Unknown',
        role: req.user?.role || 'anonymous',
        action: 'ACCESS_DENIED_BLOCKED',
        details: `Unauthorized attempt to access ${req.method} ${req.originalUrl}`
      });

      return res.status(403).json({
        error: 'Forbidden: Insufficient privileges for this operation',
        requiredRoles: allowedRoles,
        userRole: req.user?.role
      });
    }
    next();
  };
}

// Protected sample routes
app.get('/api/auth/verify', authenticateJWT, (req, res) => {
  res.json({ valid: true, user: req.user });
});

app.get('/api/audit', authenticateJWT, requireRole(['pc']), (req, res) => {
  res.json({ auditTrail: referenceAuditLog });
});

app.post('/api/audit', authenticateJWT, (req, res) => {
  const { action, details } = req.body;
  const entry = {
    id: 'aud-' + Date.now(),
    timestamp: new Date().toISOString(),
    actor: req.user.name,
    role: req.user.role,
    action: action || 'GENERIC_ACTION',
    details: details || ''
  };
  referenceAuditLog.unshift(entry);
  res.status(201).json({ entry });
});

// ----------------------------------------------------------------------------
// Server Listen on Localhost (127.0.0.1)
// ----------------------------------------------------------------------------
app.listen(PORT, HOST, () => {
  console.log('================================================================');
  console.log(` 🛡️  PROJECT PROMETHEUS — REFERENCE BACKEND RUNNING`);
  console.log(` 📍 Host/Port: http://${HOST}:${PORT}`);
  console.log(` 🤖 AI Provider: ${AI_PROVIDER.toUpperCase()}`);
  console.log(` 🔍 Health Endpoint: http://${HOST}:${PORT}/api/health`);
  console.log(` 🔑 AI Proxy Route:  http://${HOST}:${PORT}/api/ai/generate`);
  console.log(` 🔒 Security Binding: Bound exclusively to ${HOST}`);
  console.log('================================================================');
});
