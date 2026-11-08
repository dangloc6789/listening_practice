'use strict';

// Read only the files supplied in this request. Nothing is uploaded or written here.
const path = require('node:path');
const MAX_FILE = 5 * 1024 * 1024;
const MAX_TEXT = 120000;
const MAX_PAGES = 60;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status, statusCode:status}); };
let pdfModule;

function decodeDocument(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 150 || /[\r\n\0]/.test(input.name)) fail('Tên tài liệu không hợp lệ.');
  if (typeof input.base64 !== 'string' || !input.base64.length || input.base64.length > Math.ceil(MAX_FILE / 3) * 4 || input.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) fail('PDF/văn bản tối đa 5 MB, cần dữ liệu file hợp lệ.');
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE || bytes.toString('base64') !== input.base64) fail('PDF/văn bản tối đa 5 MB, cần dữ liệu file hợp lệ.');
  const name = input.name.trim();
  if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') return {name, bytes, pdf:true};
  if (/\.pdf$/i.test(name)) fail(`“${name}” không phải file PDF hợp lệ.`);
  let text;
  try { text = new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch { fail(`“${name}” phải là PDF hoặc văn bản UTF-8.`); }
  if (text.includes('\0')) fail(`“${name}” không phải văn bản UTF-8 hợp lệ.`);
  return {name, text, pdf:false};
}

function textLines(content) {
  const rows = [];
  for (const item of content.items) {
    if (typeof item.str !== 'string' || !item.str || !Array.isArray(item.transform)) continue;
    const [,,,,x,y] = item.transform;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const size = Math.max(1, Math.abs(item.transform[3]), Number(item.height) || 0);
    let row = rows.find(entry => Math.abs(entry.y - y) <= Math.max(1.5, Math.min(entry.size, size) * .18));
    if (!row) rows.push(row = {y, size, items:[]});
    row.items.push({...item, x, size});
  }
  return rows.sort((a,b) => b.y - a.y).map(row => {
    let line = '', end = null;
    for (const item of row.items.sort((a,b) => a.x - b.x)) {
      const gap = end === null ? 0 : item.x - end;
      const separator = line && !/\s$/.test(line) && !/^\s/.test(item.str) && gap > item.size * .08 ? (gap > item.size * 2 ? '    ' : ' ') : '';
      line += separator + item.str;
      end = Math.max(end ?? -Infinity, item.x + (Number(item.width) || 0));
    }
    return line.trimEnd();
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractDocuments(documents = []) {
  if (!Array.isArray(documents) || documents.length > 2) fail('Chọn tối đa hai file PDF/văn bản.');
  const inputs = documents.map(decodeDocument), pages = [], warnings = [];
  let total = 0;
  const add = (file, page, text) => {
    if (pages.length >= MAX_PAGES) fail('Tối đa 60 trang trong một lần tạo JSON. Hãy tách tài liệu.');
    total += text.length + file.length + 40;
    if (total > MAX_TEXT) fail('Văn bản vượt 120.000 ký tự. Hãy tách tài liệu; công cụ không tự cắt phần còn lại.');
    pages.push({file, page, text});
  };
  for (const input of inputs) {
    if (!input.pdf) { add(input.name, 1, input.text.trim()); continue; }
    pdfModule ||= import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjs = await pdfModule;
    const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
    const task = pdfjs.getDocument({data:new Uint8Array(input.bytes), isEvalSupported:false, disableFontFace:true, useSystemFonts:false, useWorkerFetch:false, useWasm:false, enableXfa:false, stopAtErrors:true, verbosity:0, standardFontDataUrl:path.join(packageRoot,'standard_fonts').replace(/\\/g,'/') + '/'});
    let timer;
    try {
      await Promise.race([(async () => {
        const pdf = await task.promise;
        if (pages.length + pdf.numPages > MAX_PAGES) fail('Tối đa 60 trang trong một lần tạo JSON. Hãy tách tài liệu.');
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number);
          const content = await page.getTextContent();
          const text = textLines(content);
          add(input.name, number, text);
          if (!text.trim()) warnings.push(`${input.name}, trang ${number}: không có lớp văn bản; cần OCR hoặc chép văn bản để đọc trang scan.`);
          page.cleanup();
        }
      })(), new Promise((_,reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Đọc PDF quá lâu. Hãy tách tài liệu thành ít trang hơn.'), {status:408,statusCode:408})), 20000); })]);
    } catch (error) {
      if (error.status) throw error;
      if (error.name === 'PasswordException') fail(`“${input.name}” có mật khẩu. Hãy cung cấp bản đã mở khóa mà bạn có quyền dùng.`);
      fail(`Không đọc được PDF “${input.name}”. File có thể hỏng hoặc không được hỗ trợ.`);
    } finally { clearTimeout(timer); await task.destroy(); }
  }
  return {text:pages.map(page => `[Tài liệu: ${page.file} | trang ${page.page}]\n${page.text}`).join('\n\n'), pages, warnings};
}

const normalized = value => String(value ?? '').normalize('NFKC').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/\s+/g,' ').trim().toLowerCase();
const isFooter = line => /^(?:©|www\.|https?:\/\/|page\s+\d+(?:\s+of\s+\d+)?\s*$|\[Tài liệu:)/i.test(line.trim());
const heading = /^(?:transcript|transcription|audio\s*script|tapescript|answers?|answer\s+key|discussion|preparation(?:\s+task)?|tasks?)\s*:?(?:\s+\d+)?\s*$/i;

function selectTask(text, requested) {
  const matches = [...text.matchAll(/^\s*Task\s+(\d+)\b[^\n]*$/gim)];
  if (!matches.length) return {text, task:requested ?? null, missing:false};
  const match = requested ? matches.find(entry => Number(entry[1]) === requested) : matches[0];
  if (!match) return {text:'', task:requested, missing:true};
  const index = matches.indexOf(match), start = match.index + match[0].length;
  return {text:text.slice(start, matches[index+1]?.index ?? text.length), task:Number(match[1]), missing:false};
}

function parseAnswerRows(text) {
  const keys = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || isFooter(line)) continue;
    const groups = [...line.matchAll(/(?:^|\s)(\d{1,3})[.)]\s*(.+?)(?=\s+\d{1,3}[.)]\s*|$)/g)];
    if (!groups.length) {
      const simple = line.match(/^(\d{1,3})\s+([A-Za-z]|True|False)\s*$/i);
      if (simple) groups.push(simple);
    }
    for (const group of groups) {
      const number = String(Number(group[1])), value = group[2].trim();
      const previous = keys.get(number);
      keys.set(number, previous && normalized(previous.value) !== normalized(value) ? {value:null, quote:line, conflict:true} : {value, quote:line});
    }
  }
  return keys;
}

function answerIndex(value, options) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/^[([]|[).\]]$/g,'').trim();
  if (/^[A-Z]$/i.test(clean)) {
    const index = clean.toUpperCase().charCodeAt(0) - 65;
    if (index < options.length) return index;
  }
  const index = options.findIndex(option => normalized(option) === normalized(clean));
  return index < 0 ? null : index;
}

function draftFromText(text, {part='general-listening', title='', source={}} = {}) {
  if (typeof text !== 'string' || text.length > MAX_TEXT) fail('Văn bản nguồn không hợp lệ hoặc vượt 120.000 ký tự.');
  const warnings = [];
  const lines = text.replace(/\r\n?/g,'\n').split('\n').filter(line => !isFooter(line));
  const clean = lines.join('\n');
  const transcriptHeading = /^\s*(?:transcript|transcription|audio\s*script|tapescript)\s*:?\s*$/im.exec(clean);
  let transcript = null;
  if (transcriptHeading) {
    const rest = clean.slice(transcriptHeading.index + transcriptHeading[0].length);
    const end = /^\s*(?:answers?|answer\s+key|discussion|tasks?|preparation(?:\s+task)?)\s*:?(?:\s+\d+)?\s*$/im.exec(rest);
    transcript = rest.slice(0, end?.index ?? rest.length).trim() || null;
  }
  const answerHeading = /^\s*(?:answers?|answer\s+key|keys?)\s*:?(?:\s*[-–—]?\s*Task\s+\d+)?\s*$/im.exec(clean);
  let questionText = clean.slice(0, Math.min(answerHeading?.index ?? clean.length, transcriptHeading?.index ?? clean.length));
  const requestedMatch = /\bTask\s+(\d+)\b/i.exec(source.test || '');
  const requested = requestedMatch ? Number(requestedMatch[1]) : null;
  const selection = selectTask(questionText, requested);
  questionText = selection.text;
  if (selection.missing) warnings.push(`Không tìm thấy Task ${requested} trong nội dung câu hỏi.`);
  const questionEnd = /^\s*(?:discussion|transcript|preparation(?:\s+task)?)\s*:?\s*$/im.exec(questionText);
  if (questionEnd) questionText = questionText.slice(0, questionEnd.index);
  const answerText = answerHeading ? clean.slice(answerHeading.index + answerHeading[0].length) : '';
  const answerSelection = selectTask(answerText, selection.task);
  const keys = parseAnswerRows(answerSelection.text);
  if (answerSelection.missing) warnings.push(`Không tìm thấy key cho Task ${selection.task}.`);
  const questions = [];
  const seen = new Set();
  let current = null;
  function finish() {
    if (!current) return;
    const key = current.inlineKey || keys.get(current.number);
    current.answer = key && !key.conflict ? answerIndex(key.value,current.options) : null;
    if (current.answer !== null) current.answerEvidence = key.quote;
    else if (key?.conflict) warnings.push(`Câu ${current.number}: key nguồn mâu thuẫn, cần kiểm tra.`);
    delete current.inlineKey;
    questions.push(current); current = null;
  }
  for (const raw of questionText.split('\n')) {
    const line = raw.trim();
    if (!line || heading.test(line) || isFooter(line)) continue;
    const numbered = /^(\d{1,3})[.)]\s*(.*)$/.exec(line);
    let body = line;
    if (numbered) {
      finish();
      const number = String(Number(numbered[1]));
      if (seen.has(number)) { warnings.push(`Số câu ${number} xuất hiện nhiều lần; cần chọn đúng Task/test trước khi nhập.`); continue; }
      seen.add(number);current={number,prompt:'',options:[],answer:null};body=numbered[2];
    }
    if (!current) continue;
    const inlineKey = /^(?:Answer|Correct\s+answer)\s*:\s*(.+)$/i.exec(body);
    if (inlineKey) {current.inlineKey={value:inlineKey[1],quote:line};continue;}
    const optionMatches = [...body.matchAll(/(?:^|\s)(?:\(([A-Za-z])\)|([A-Za-z])[.)])\s+(.+?)(?=(?:\s+\([A-Za-z]\)|\s+[A-Za-z][.)])\s|$)/g)];
    if (optionMatches.length) {
      const prefix = body.slice(0,optionMatches[0].index).trim();
      if (prefix) current.prompt += (current.prompt?' ':'') + prefix;
      for (const option of optionMatches) {
        const index = (option[1] || option[2]).toUpperCase().charCodeAt(0)-65;
        if (index !== current.options.length) {warnings.push(`Câu ${current.number}: thứ tự nhãn lựa chọn không rõ, cần kiểm tra.`);break;}
        current.options.push(option[3].trim());
      }
    } else if (current.options.length) current.options[current.options.length-1] += ' ' + body;
    else current.prompt += (current.prompt?' ':'') + body;
  }
  finish();
  if (!questions.length) warnings.push('Chưa nhận ra câu hỏi có số và lựa chọn trong nguồn. Có thể dùng mô hình AI hoặc sửa bản nháp.');
  if (questions.some(question => question.answer === null)) warnings.push('Nguồn chưa có key rõ cho một số câu; đáp án để null, công cụ không tự đoán.');
  if (questions.some(question => question.options.length < 2)) warnings.push('Một số câu chưa nhận ra đủ lựa chọn; cần bổ sung từ nguồn.');
  if (selection.task && !requested) warnings.push(`Tài liệu có nhiều phần; đã trích Task ${selection.task}. Kiểm tra đúng phần cần luyện.`);
  return {questions,transcript,warnings,selectedTask:selection.task,questionText,answerText:answerSelection.text,part,title};
}

module.exports = {extractDocuments,draftFromText};
