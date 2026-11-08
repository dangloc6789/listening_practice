'use strict';
// Shared Claude API client. Credentials come from the environment (ANTHROPIC_API_KEY,
// ANTHROPIC_AUTH_TOKEN) or an `ant auth login` profile; never from the browser.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

function hasCredentials(env = process.env) {
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE) return true;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  try { return fs.readdirSync(path.join(base, 'anthropic')).length > 0; } catch { return false; }
}

class ClaudeClient {
  constructor({ model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL, client, env = process.env } = {}) {
    this.model = model;
    this.injected = client || null;
    this.env = env;
    this.instance = null;
  }
  get configured() { return Boolean(this.injected) || hasCredentials(this.env); }
  get client() { return this.injected || (this.instance ||= new Anthropic({ maxRetries: 1, timeout: 120000 })); }

  /**
   * One Messages request. Returns { text, json, model }. `schema` turns on structured
   * outputs (JSON Schema); `effort` controls thinking depth (thinking is always on).
   */
  async complete({ system, messages, schema, effort = 'low', maxTokens = 16000, signal, failure }) {
    if (!this.configured) throw failure('Chưa cấu hình Claude API. Thêm ANTHROPIC_API_KEY vào .env rồi khởi động lại server.', 503);
    let response;
    try {
      response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        system,
        messages,
        output_config: { effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
      }, { signal });
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError) throw failure('Yêu cầu AI đã bị hủy.', 499);
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw failure('Claude API từ chối khóa API. Kiểm tra ANTHROPIC_API_KEY trong .env.', 502);
      if (error instanceof Anthropic.RateLimitError) throw failure('Claude API đang giới hạn tốc độ. Đợi một lúc rồi thử lại.', 429);
      if (error instanceof Anthropic.BadRequestError) throw failure(`Claude API không nhận yêu cầu: ${error.message}`.slice(0, 400), 502);
      if (error instanceof Anthropic.APIConnectionError) throw failure('Không kết nối được Claude API. Kiểm tra mạng rồi thử lại.', 502);
      if (error instanceof Anthropic.APIError) throw failure(`Claude API lỗi ${error.status ?? ''}. Hãy thử lại sau.`, 502);
      throw error;
    }
    if (response.stop_reason === 'refusal') throw failure('Claude từ chối yêu cầu này. Hãy diễn đạt lại nội dung.', 422);
    if (response.stop_reason === 'max_tokens') throw failure('Câu trả lời AI bị cắt do quá dài. Hãy rút gọn đầu vào rồi thử lại.', 502);
    const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('').trim();
    if (!text) throw failure('Claude chưa trả nội dung. Hãy thử lại.', 502);
    let json = null;
    if (schema) { try { json = JSON.parse(text); } catch { throw failure('Claude chưa trả JSON hợp lệ. Hãy thử lại.', 502); } }
    return { text, json, model: response.model };
  }
}

module.exports = { ClaudeClient, DEFAULT_MODEL };
