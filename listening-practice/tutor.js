(() => {
  'use strict';
  // Gia sư AI: giải thích câu đã nộp qua Claude API (backend /api/tutor/*).
  window.createListenLabTutor = ({ api, post, onBusyChange = () => {} }) => {
    const $ = id => document.getElementById(id);
    const dialog = $('tutor-dialog'), form = $('tutor-form'), input = $('tutor-input'), log = $('tutor-messages');
    let status = null, current = null, busy = false, epoch = 0;

    const setStatus = (text, error = false) => { $('tutor-status').textContent = text; $('tutor-status').classList.toggle('error-text', error); };
    function controls() {
      const ready = Boolean(status?.supported && current && !busy);
      input.disabled = !ready; $('tutor-send').disabled = !ready || !input.value.trim();
      onBusyChange(busy);
    }
    function message(role, text) {
      const item = document.createElement('div');
      item.className = `tutor-message ${role === 'assistant' ? 'from-ai' : 'from-user'}`;
      const who = document.createElement('strong'); who.textContent = role === 'assistant' ? 'Gia sư Claude' : 'Bạn';
      const body = document.createElement('p'); body.textContent = text;
      if (role === 'assistant') body.lang = 'vi';
      item.append(who, body); log.append(item); log.scrollTop = log.scrollHeight;
    }
    function render(items) { log.replaceChildren(); for (const item of items) message(item.role, item.content); }
    async function refreshStatus() {
      try {
        status = await api('/api/tutor/status');
        $('tutor-model-info').textContent = status.supported ? `Mô hình: ${status.model}. Khóa API nằm trên server, không gửi qua trình duyệt.` : status.message;
        if (!current) setStatus(status.supported ? 'Mở một bài đã nộp và bấm “Hỏi gia sư” ở câu bạn muốn hỏi.' : status.message, !status.supported);
      } catch (error) { status = null; setStatus(error.message, true); }
      controls();
    }
    async function open(context) {
      const mine = ++epoch;
      current = context?.attemptId && context?.questionId ? context : null;
      $('tutor-context').textContent = current ? current.label || `Câu ${current.questionId}` : 'Chưa chọn câu hỏi.';
      log.replaceChildren();
      if (!dialog.open) dialog.showModal();
      await refreshStatus();
      if (!current || mine !== epoch) return;
      try {
        const history = await api(`/api/tutor/history?attemptId=${encodeURIComponent(current.attemptId)}&questionId=${encodeURIComponent(current.questionId)}`);
        if (mine !== epoch) return;
        render(history.items || []);
        if (status?.supported) setStatus(history.items?.length ? 'Tiếp tục hỏi về câu này.' : 'Hỏi bất kỳ điều gì về câu này, ví dụ vì sao đáp án của bạn sai.');
        input.focus();
      } catch (error) { if (mine === epoch) setStatus(error.message, true); }
      controls();
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || busy || !current) return;
      const mine = epoch, context = current;
      busy = true; controls(); message('user', text); input.value = ''; setStatus('Claude đang trả lời…');
      try {
        const result = await post('/api/tutor/messages', { attemptId: context.attemptId, questionId: context.questionId, message: text });
        if (mine !== epoch) return;
        render(result.items || []); setStatus('Đã trả lời. Có thể hỏi tiếp.');
      } catch (error) {
        if (mine !== epoch) return;
        log.lastElementChild?.remove(); input.value = text; setStatus(error.message, true);
      } finally { busy = false; controls(); }
    });
    input.addEventListener('input', controls);
    $('tutor-close').addEventListener('click', () => dialog.close());
    $('tutor-open').addEventListener('click', () => void open(null));
    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-tutor-attempt]');
      if (!button) return;
      void open({ attemptId: button.dataset.tutorAttempt, questionId: button.dataset.tutorQuestion, label: button.dataset.tutorLabel });
    });
    return {
      open,
      reset() { epoch++; current = null; busy = false; log.replaceChildren(); input.value = ''; if (dialog.open) dialog.close(); controls(); },
      get busy() { return busy; },
    };
  };
})();
