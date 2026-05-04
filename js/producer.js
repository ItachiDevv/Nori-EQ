/* producer.js — Hermes Producer AI chat */
const chat = document.getElementById('chat');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const producerStatus = document.getElementById('producerStatus');

function pushMsg(who, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function pushAiBubble(text, svgHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ai';
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.maxWidth = '86%';
  wrap.style.width = 'auto';

  const body = document.createElement('p');
  body.style.margin = '0 0 6px 0';
  body.style.lineHeight = '1.4';
  body.textContent = text;
  wrap.appendChild(body);

  if (svgHtml) {
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.maxWidth = '420px';
    container.style.marginTop = '4px';
    container.innerHTML = svgHtml;
    wrap.appendChild(container);
  }

  chat.appendChild(wrap);
  chat.scrollTop = chat.scrollHeight;
}

function buildContext() {
  if (window.lastServerAnalysis?.contextString) return window.lastServerAnalysis.contextString;
  if (window.lastAnalysis) {
    const a = window.lastAnalysis;
    return [
      `File: ${a.filename}`,
      `Duration: ${a.durationSec}s`,
      `LUFS: ${a.lufs}`,
      `Peak: ${a.peakDbfs}dBFS`,
      `Crest: ${a.crestDb}dB`,
      `SpectralCentroid: ${a.spectralCentroidHz}Hz`,
      `Transients: ${a.transientDensity}/s`,
      `StereoWidth: ${a.stereoWidth}`,
      `Tonal Low/Mid/High: ${a.lowRatio}/${a.midRatio}/${a.highRatio}`,
    ].join(', ');
  }
  if (typeof getAudioLevel === 'function') {
    const lvl = getAudioLevel();
    const v = typeof lvl === 'number' ? lvl : (lvl && lvl.vol) || 0;
    return `Live mic level: ${(v * 100).toFixed(0)}%`;
  }
  return '';
}

async function askProducer(prefill) {
  const text = prefill || chatInput.value.trim();
  if (!text) return;
  pushMsg('user', text);
  if (!prefill) chatInput.value = '';
  producerStatus.textContent = 'Hermes Producer is analyzing...';
  chatSend.disabled = true;

  const context = buildContext();

  try {
    const resp = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: text, context }),
    });
    const data = await resp.json();
    if (data.ok) {
      pushAiBubble(data.text || data.reply || '(no reply)', data.infographic);
    } else {
      pushMsg('ai', 'Error: ' + (data.error || 'unknown'));
    }
  } catch (e) {
    pushMsg('ai', 'Network error: ' + e.message);
  } finally {
    producerStatus.textContent = 'Hermes Producer ready';
    chatSend.disabled = false;
  }
}

/* Server-side analysis: Gemini-with-audio. Called by upload.js after browser metrics are ready. */
window.runServerAnalysis = async function (file, metrics) {
  pushMsg('user', `Uploaded: ${file.name}`);
  producerStatus.textContent = 'Hermes Producer is listening to your track...';
  chatSend.disabled = true;
  try {
    const fd = new FormData();
    fd.append('audio', file);
    if (metrics) fd.append('metrics', JSON.stringify(metrics));
    const resp = await fetch('/api/analyze', { method: 'POST', body: fd });
    const data = await resp.json();
    if (data.ok) {
      window.lastServerAnalysis = { metrics: data.metrics, contextString: data.contextString, modelUsed: data.modelUsed };
      pushAiBubble(data.critique || data.text || '(no critique)', data.infographic);
      if (data.modelUsed) producerStatus.textContent = `Hermes Producer ready (${data.modelUsed})`;
    } else {
      pushMsg('ai', 'Analyze error: ' + (data.error || 'unknown'));
    }
  } catch (e) {
    pushMsg('ai', 'Analyze network error: ' + e.message);
  } finally {
    chatSend.disabled = false;
    if (!window.lastServerAnalysis) producerStatus.textContent = 'Hermes Producer ready';
  }
};

chatSend.addEventListener('click', () => askProducer());
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') askProducer(); });

chatInput.placeholder = 'Ask about your mix...';
