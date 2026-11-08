'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const MODEL = 'Xenova/whisper-tiny.en';
const REVISION = '79fb389fc764e7c395bd330e9531d9d32ada7049';
const SAMPLE_RATE = 16000;
const MAX_SECONDS = 300;
const MAX_SAMPLES = SAMPLE_RATE * MAX_SECONDS;
const MAX_BASE64 = Math.ceil(MAX_SAMPLES * 4 / 3) * 4;
const failure = (message, status = 400, code = 'AUDIO_TRANSCRIPTION_ERROR') => Object.assign(new Error(message), { status, statusCode: status, code });

let worker = null;
let cacheLocation = null;
let pending = null;
let nextId = 0;
let state = 'idle';

function decodePCM(pcm) {
  if (!pcm || pcm.sampleRate !== SAMPLE_RATE || typeof pcm.base64 !== 'string' || pcm.base64.length > MAX_BASE64 || pcm.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(pcm.base64)) {
    throw failure('Audio cần được chuyển thành PCM Float32 mono 16 kHz, tối đa 5 phút.');
  }
  const bytes = Buffer.from(pcm.base64, 'base64');
  if (bytes.toString('base64') !== pcm.base64 || bytes.length % 4 || bytes.length < SAMPLE_RATE || bytes.length > MAX_SAMPLES * 4) {
    throw failure('Dữ liệu PCM không hợp lệ. Audio cần dài từ 0,25 giây đến 5 phút.');
  }
  const samples = new Float32Array(bytes.length / 4);
  let peak = 0;
  for (let index = 0; index < samples.length; index++) {
    const value = bytes.readFloatLE(index * 4);
    if (!Number.isFinite(value) || Math.abs(value) > 4) throw failure('PCM có mẫu âm thanh không hợp lệ. Hãy chọn lại file audio gốc.');
    samples[index] = Math.max(-1, Math.min(1, value));
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak < 0.00001) throw failure('Audio không có tín hiệu nghe rõ. Hãy kiểm tra file trước khi nhận dạng.');
  return samples;
}

function settle(error, value) {
  if (!pending) return;
  const request = pending;
  pending = null;
  clearTimeout(request.timer);
  worker?.unref();
  if (error) request.reject(error);
  else request.resolve(value);
}

function ensureWorker(directory) {
  if (worker && cacheLocation === directory) return worker;
  if (worker) { void worker.terminate(); worker = null; }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  cacheLocation = directory;
  state = 'loading';
  const created = new Worker(__filename, { workerData: { listenLabTranscriber: true, cacheDir: directory } });
  worker = created;
  created.on('message', message => {
    if (worker !== created) return;
    if (message.type === 'state') { state = message.state; return; }
    if (!pending || message.id !== pending.id) return;
    if (message.type === 'result') { state = 'ready'; settle(null, message.result); }
    else if (message.type === 'failure') {
      state = 'error';
      settle(failure('Không tải hoặc chạy được model nhận dạng audio trên máy. Kiểm tra Internet cho lần tải đầu, RAM và thử lại. File audio không được gửi lên dịch vụ nhận dạng bên ngoài.', 503));
      worker = null;
      void created.terminate();
    }
  });
  created.on('error', () => {
    if (worker !== created) return;
    state = 'error'; worker = null;
    settle(failure('Không khởi động được nhận dạng audio trên máy. Hãy kiểm tra cài đặt thư viện rồi thử lại.', 503));
  });
  created.on('exit', code => {
    if (worker !== created) return;
    worker = null;
    if (pending) { state = 'error'; settle(failure('Nhận dạng audio đã dừng trước khi hoàn tất. Hãy thử lại.', 503)); }
    else if (code) state = 'error';
  });
  created.unref();
  return created;
}

async function transcribePCM(pcm, { cacheDir = path.join(__dirname, '..', '.data', 'models'), timeoutMs = 600000 } = {}) {
  if (pending) throw failure('Đang nhận dạng một file audio. Hãy chờ hoàn tất rồi thử lại.', 409, 'AUDIO_TRANSCRIPTION_BUSY');
  const samples = decodePCM(pcm);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 900000) throw failure('Giới hạn thời gian nhận dạng không hợp lệ.');
  const active = ensureWorker(path.resolve(cacheDir));
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending?.id !== id) return;
      state = 'error'; worker = null;
      settle(failure('Nhận dạng audio vượt quá thời gian cho phép và đã dừng. Thử file ngắn hơn hoặc tải lại model.', 504, 'AUDIO_TRANSCRIPTION_TIMEOUT'));
      void active.terminate();
    }, timeoutMs);
    pending = { id, resolve, reject, timer };
    active.ref();
    active.postMessage({ id, samples }, [samples.buffer]);
  });
}

function getTranscriptionStatus() {
  return { engine: 'local-whisper', model: MODEL, revision: REVISION, state, busy: Boolean(pending), sampleRate: SAMPLE_RATE, maxDurationSeconds: MAX_SECONDS, downloadsModelOnFirstUse: true };
}

async function closeTranscriber() {
  const active = worker;
  worker = null;
  if (pending) settle(failure('Nhận dạng audio đã dừng cùng ứng dụng.', 503));
  if (active) await active.terminate();
  state = 'idle';
}

if (!isMainThread && workerData?.listenLabTranscriber) {
  let transcriber;
  parentPort.on('message', async ({ id, samples }) => {
    try {
      if (!transcriber) {
        parentPort.postMessage({ type: 'state', state: 'loading' });
        const { env, pipeline } = await import('@huggingface/transformers');
        env.cacheDir = workerData.cacheDir;
        env.useFSCache = true;
        env.allowLocalModels = false;
        transcriber = await pipeline('automatic-speech-recognition', MODEL, {
          revision: REVISION, dtype: 'q8', device: 'cpu',
          session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 }
        });
      }
      parentPort.postMessage({ type: 'state', state: 'transcribing' });
      const output = await transcriber(samples, { chunk_length_s: 30, stride_length_s: 5 });
      const text = typeof output?.text === 'string' ? output.text.trim() : '';
      if (!text || text.length > 60000) throw new Error('No usable transcription');
      parentPort.postMessage({ type: 'result', id, result: {
        text, engine: 'local-whisper', model: MODEL, revision: REVISION, language: 'en',
        durationSeconds: samples.length / SAMPLE_RATE,
        warnings: ['Transcript do Whisper nhận dạng tự động trên máy, có thể sai tên riêng hoặc thuật ngữ. Cần nghe và đối chiếu trước khi xác nhận; đây không phải transcript gốc của nhà xuất bản.']
      } });
    } catch {
      parentPort.postMessage({ type: 'failure', id });
    }
  });
}

module.exports = { transcribePCM, getTranscriptionStatus, closeTranscriber };
