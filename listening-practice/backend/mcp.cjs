'use strict';

// A small, stateless Streamable HTTP resource server. It exposes no write tools.
const { createHash, createPublicKey, timingSafeEqual, verify } = require('node:crypto');

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const BODY_LIMIT = 64 * 1024;
const JWKS_LIMIT = 256 * 1024;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const loopback = value => ['127.0.0.1', '::1', '[::1]', 'localhost', '::ffff:127.0.0.1'].includes(value);

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(res, status, id, code, message) {
  json(res, status, { jsonrpc: '2.0', id, error: { code, message } });
}

function safeEqual(left, right) {
  const digest = text => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(left), digest(right));
}

function validatedHTTPS(value, name) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(`${name} must be an HTTPS URL without credentials or a fragment.`);
  return url;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let length = 0;
    let rejected = false;
    const chunks = [];
    req.on('data', chunk => {
      if (rejected) return;
      length += chunk.length;
      if (length > BODY_LIMIT) {
        rejected = true;
        chunks.length = 0;
        const error = new Error('MCP request exceeds 64 KiB.');
        error.status = 413;
        reject(error);
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch {
        const error = new Error('Invalid JSON.');
        error.status = 400;
        error.rpcCode = -32700;
        reject(error);
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request aborted.')));
  });
}

function decodeSegment(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid JWT encoding.');
  const decoded = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (!isObject(decoded)) throw new Error('Invalid JWT object.');
  return decoded;
}

function createJwtVerifier(config, fetchImpl) {
  let cached = null;
  let inFlight = null;
  let lastRefreshAt = 0;

  async function keys(force = false) {
    if (cached && !force && cached.expiresAt > Date.now()) return cached.keys;
    if (inFlight) return inFlight;
    // An unknown kid must not turn every invalid request into an outbound fetch.
    if (force && cached && Date.now() - lastRefreshAt < 30000) return cached.keys;
    inFlight = (async () => {
      const response = await fetchImpl(config.oauthJwksUri, { signal: AbortSignal.timeout(5000), redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Signing keys unavailable.');
      if (Number(response.headers.get('content-length')) > JWKS_LIMIT) throw new Error('Signing keys too large.');
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > JWKS_LIMIT) { await reader.cancel(); throw new Error('Signing keys too large.'); }
        chunks.push(Buffer.from(value));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(body.keys) || body.keys.length > 100) throw new Error('Invalid signing-key set.');
      lastRefreshAt = Date.now();
      cached = { keys: body.keys, expiresAt: Date.now() + 5 * 60 * 1000 };
      return cached.keys;
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }

  return async function verifyAccessToken(token) {
    if (token.length > 16384) throw new Error('Invalid access token.');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid access token.');
    const header = decodeSegment(parts[0]);
    const claims = decodeSegment(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.crit || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new Error('Unsupported access token.');
    let jwks = await keys();
    let jwk = jwks.find(key => key.kid === header.kid);
    if (!jwk) { jwks = await keys(true); jwk = jwks.find(key => key.kid === header.kid); }
    if (!jwk || jwk.kty !== 'RSA' || (jwk.use && jwk.use !== 'sig') || (jwk.alg && jwk.alg !== 'RS256') || (jwk.key_ops && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify')))) throw new Error('Unknown signing key.');
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    if ((key.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error('Signing key too small.');
    if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw new Error('Invalid signature.');
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== config.oauthIssuer || claims.sub !== config.oauthSubject) throw new Error('Wrong token identity.');
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(config.oauthAudience)) throw new Error('Wrong token audience.');
    if (!Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now + 30)) || (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > now + 30))) throw new Error('Expired or inactive token.');
    const scopes = typeof claims.scope === 'string' ? claims.scope.split(/\s+/) : typeof claims.scp === 'string' ? claims.scp.split(/\s+/) : Array.isArray(claims.scp) ? claims.scp : [];
    if (!scopes.includes(config.oauthScope)) throw new Error('Missing read permission.');
    return 'owner';
  };
}

function makeTools(scope) {
  const auth = [{ type: 'oauth2', scopes: [scope] }];
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const base = { annotations, securitySchemes: auth, _meta: { securitySchemes: auth } };
  return [
    {
      ...base, name: 'get_learning_progress', title: 'Read learning progress',
      description: 'Read actual personal TOEIC-style practice results, first-attempt accuracy, Part/day breakdowns and review needs. Authored exercises do not imply an official TOEIC score.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      ...base, name: 'list_attempts', title: 'List practice attempts',
      description: 'Read saved practice attempts, paginated and optionally filtered by inclusive local dates (Asia/Bangkok) and Part. Includes retries without replacing older attempts.',
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
          from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Inclusive date YYYY-MM-DD.' },
          to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Inclusive date YYYY-MM-DD.' },
          part: { type: 'integer', enum: [2, 3, 4] }
        }
      }
    },
    {
      ...base, name: 'get_attempt_details', title: 'Read one practice attempt',
      description: 'Read one immutable saved attempt with exercise version, question snapshots, selected/correct answers, explanations, playback counts and timing.',
      inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['id'], additionalProperties: false }
    }
  ];
}

function validateArguments(name, args) {
  if (!isObject(args)) return 'Tool arguments must be an object.';
  const allowed = name === 'list_attempts' ? ['page', 'pageSize', 'from', 'to', 'part'] : name === 'get_attempt_details' ? ['id'] : [];
  if (Object.keys(args).some(key => !allowed.includes(key))) return 'Unknown tool argument.';
  if (name === 'get_attempt_details' && (typeof args.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(args.id))) return 'A valid attempt id is required.';
  if (name === 'list_attempts') {
    if (args.page !== undefined && (!Number.isSafeInteger(args.page) || args.page < 1 || args.page > 1000000)) return 'page must be an integer between 1 and 1000000.';
    if (args.pageSize !== undefined && (!Number.isInteger(args.pageSize) || args.pageSize < 1 || args.pageSize > 100)) return 'pageSize must be between 1 and 100.';
    if (args.part !== undefined && ![2, 3, 4].includes(args.part)) return 'part must be 2, 3 or 4.';
    for (const key of ['from', 'to']) {
      if (args[key] !== undefined && (typeof args[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args[key]) || new Date(`${args[key]}T00:00:00.000Z`).toISOString().slice(0, 10) !== args[key])) return `${key} must be a real date in YYYY-MM-DD form.`;
    }
    if (args.from && args.to && args.from > args.to) return 'from must not be after to.';
  }
  return null;
}

function createMcpHandler({ store, config, fetchImpl = globalThis.fetch }) {
  const originURL = new URL(config.publicOrigin);
  if (!['http:', 'https:'].includes(originURL.protocol) || originURL.username || originURL.password || originURL.search || originURL.hash || originURL.pathname !== '/' || (!loopback(originURL.hostname) && originURL.protocol !== 'https:')) throw new Error('MCP publicOrigin must be an HTTP(S) origin; remote origins require HTTPS.');
  const origin = originURL.origin;
  const normalized = { ...config, oauthScope: config.oauthScope || 'progress:read' };
  const allowedOrigins = new Set([origin]);
  if (normalized.mcpAllowedOrigins !== undefined && !Array.isArray(normalized.mcpAllowedOrigins)) throw new Error('mcpAllowedOrigins must be an array of exact HTTP(S) origins.');
  for (const candidate of normalized.mcpAllowedOrigins || []) {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' || (!loopback(parsed.hostname) && parsed.protocol !== 'https:')) throw new Error('MCP allowed origins must be exact HTTPS or loopback origins.');
    allowedOrigins.add(parsed.origin);
  }
  const oauthFields = ['oauthIssuer', 'oauthAudience', 'oauthJwksUri', 'oauthSubject'];
  const oauthEnabled = oauthFields.every(key => typeof normalized[key] === 'string' && normalized[key].length > 0);
  const oauthPartial = oauthFields.some(key => normalized[key]);
  if (oauthPartial && !oauthEnabled) throw new Error('Set oauthIssuer, oauthAudience, oauthJwksUri and oauthSubject together.');
  if (oauthEnabled) {
    validatedHTTPS(normalized.oauthIssuer, 'oauthIssuer');
    validatedHTTPS(normalized.oauthJwksUri, 'oauthJwksUri');
    if (normalized.oauthAudience !== `${origin}/mcp`) throw new Error('oauthAudience must match the protected MCP resource URL exactly.');
  }
  if (!/^[A-Za-z0-9:._/-]{1,128}$/.test(normalized.oauthScope)) throw new Error('Invalid oauthScope.');
  const localToken = typeof normalized.mcpLocalToken === 'string' && normalized.mcpLocalToken.length >= 32 && loopback(originURL.hostname) ? normalized.mcpLocalToken : '';
  if (normalized.mcpLocalToken && !localToken) throw new Error('MCP local tokens need at least 32 characters and a loopback publicOrigin. Use OAuth for remote connections.');
  const verifyJWT = oauthEnabled ? createJwtVerifier(normalized, fetchImpl) : null;
  const tools = makeTools(normalized.oauthScope);
  const metadataURL = `${origin}/.well-known/oauth-protected-resource/mcp`;

  async function authenticatedUser(req) {
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [^\s]+$/i.test(authorization)) return null;
    const token = authorization.slice(7);
    if (localToken && loopback(req.socket.remoteAddress) && safeEqual(token, localToken)) return 'owner';
    if (verifyJWT) {
      try { return await verifyJWT(token); } catch { return null; }
    }
    return null;
  }

  return async function handleMcp(req, res, url) {
    const pathname = url.pathname;
    if (!['/mcp', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(pathname)) return false;
    // Browser-origin checks are independent of bearer authentication.
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) {
      json(res, 403, { error: 'Origin not permitted.' });
      return true;
    }
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id',
        'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store'
      });
      res.end();
      return true;
    }
    if (pathname !== '/mcp') {
      if (req.method !== 'GET') { json(res, 405, { error: 'Method not allowed.' }, { Allow: 'GET' }); return true; }
      if (!oauthEnabled) { json(res, 503, { error: 'OAuth metadata is not configured. Local developer bearer tokens are not ChatGPT OAuth.' }); return true; }
      json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [normalized.oauthIssuer], scopes_supported: [normalized.oauthScope], bearer_methods_supported: ['header'], resource_name: 'Listen Lab private learning progress' });
      return true;
    }
    if (!localToken && !oauthEnabled) {
      json(res, 503, { error: 'MCP authentication is not configured. The local web app still works; configure OAuth or a local-only developer token.' });
      return true;
    }
    const userId = await authenticatedUser(req);
    if (!userId) {
      json(res, 401, { error: 'A valid read-only access token is required.' }, { 'WWW-Authenticate': `Bearer resource_metadata="${metadataURL}", scope="${normalized.oauthScope}"` });
      return true;
    }
    if (url.search) { json(res, 400, { error: 'MCP query parameters are not supported. Pass credentials only in Authorization headers.' }); return true; }
    if (req.method !== 'POST') { json(res, 405, { error: 'Use POST. This stateless server has no independent SSE stream or session deletion.' }, { Allow: 'POST' }); return true; }
    const protocol = req.headers['mcp-protocol-version'];
    if (protocol && !PROTOCOLS.includes(protocol)) { rpcError(res, 400, null, -32600, 'Unsupported MCP-Protocol-Version header.'); return true; }
    if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) { json(res, 415, { error: 'Content-Type must be application/json.' }); return true; }
    const accept = req.headers.accept || '';
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) { json(res, 406, { error: 'Accept must include application/json and text/event-stream.' }); return true; }
    let message;
    try { message = await readBody(req); }
    catch (error) { rpcError(res, error.status || 400, null, error.rpcCode || -32600, error.message); return true; }
    const hasId = isObject(message) && own(message, 'id');
    const validId = hasId && (typeof message.id === 'string' || Number.isSafeInteger(message.id));
    if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (hasId && !validId) || (own(message, 'params') && !isObject(message.params))) {
      rpcError(res, 400, null, -32600, 'Invalid JSON-RPC request.');
      return true;
    }
    const params = message.params || {};
    if (!hasId) {
      // Unknown notifications may be ignored. A notification never gets a JSON-RPC response.
      res.writeHead(202, { 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    let result;
    if (message.method === 'initialize') {
      if (typeof params.protocolVersion !== 'string' || !isObject(params.capabilities) || !isObject(params.clientInfo) || typeof params.clientInfo.name !== 'string' || typeof params.clientInfo.version !== 'string') {
        rpcError(res, 200, message.id, -32602, 'Initialize requires protocolVersion, capabilities and clientInfo.');
        return true;
      }
      result = {
        protocolVersion: PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'listenlab-readonly', version: '1.0.0', title: 'Listen Lab learning progress' },
        instructions: 'Only read learning data. These are authored exercises with TTS audio, not official ETS tests. Compare first attempts separately from retries and consider listening counts, duration and small samples. Submitting practice results does not send a chat message.'
      };
    } else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') {
      if (params.cursor !== undefined) { rpcError(res, 200, message.id, -32602, 'Tool catalog has one page; cursor is not supported.'); return true; }
      result = { tools };
    } else if (message.method === 'tools/call') {
      if (!tools.some(tool => tool.name === params.name)) { rpcError(res, 200, message.id, -32602, 'Unknown tool.'); return true; }
      const args = params.arguments === undefined ? {} : params.arguments;
      let invalid;
      try { invalid = validateArguments(params.name, args); } catch { invalid = 'Invalid date arguments.'; }
      if (invalid) { rpcError(res, 200, message.id, -32602, invalid); return true; }
      try {
        let data;
        if (params.name === 'get_learning_progress') data = store.getProgress(userId);
        else if (params.name === 'list_attempts') data = store.listAttempts(userId, args);
        else data = store.getAttempt(userId, args.id);
        if (data === null || data === undefined) result = { isError: true, content: [{ type: 'text', text: 'Attempt not found for this user.' }] };
        else result = { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
      } catch (error) {
        result = { isError: true, content: [{ type: 'text', text: error.status && error.status < 500 ? error.message : 'Could not read learning data.' }] };
      }
    } else { rpcError(res, 200, message.id, -32601, 'Method not found.'); return true; }
    json(res, 200, { jsonrpc: '2.0', id: message.id, result });
    return true;
  };
}

module.exports = { createMcpHandler, PROTOCOLS };
