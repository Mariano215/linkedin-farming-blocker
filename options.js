(function () {
  'use strict';
  const { rules } = globalThis.LFB;
  const box = document.getElementById('rules');

  chrome.storage.sync.get({ enabled: true, mode: 'collapse', disabled: [], phrases: [], allow: [] }, (data) => {
    document.getElementById('enabled').checked = data.enabled !== false;
    document.getElementById('mode').value = data.mode;
    for (const r of rules) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = r.id;
      cb.checked = !data.disabled.includes(r.id);
      label.append(cb, ' ' + r.label + ' ');
      const sev = document.createElement('span');
      sev.className = 'sev';
      sev.textContent = '(' + r.id + ', ' + r.severity + ')';
      label.append(sev);
      box.append(label);
    }
    document.getElementById('phrases').value = data.phrases.join('\n');
    document.getElementById('allow').value = data.allow.join('\n');
  });

  const lines = (id) =>
    document
      .getElementById(id)
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

  document.getElementById('save').addEventListener('click', () => {
    const disabled = Array.from(box.querySelectorAll('input:not(:checked)')).map((c) => c.value);
    const enabled = document.getElementById('enabled').checked;
    const mode = document.getElementById('mode').value;
    chrome.storage.sync.set({ enabled, mode, disabled, phrases: lines('phrases'), allow: lines('allow') }, () => {
      const el = document.getElementById('saved');
      el.textContent = 'saved, reload LinkedIn';
      setTimeout(() => (el.textContent = ''), 3000);
    });
  });

  function renderCounts() {
    chrome.storage.local.get({ counts: {} }, ({ counts }) => {
      const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const table = document.getElementById('counts');
      table.innerHTML = '<tr><th>rule</th><th>hits</th></tr>';
      for (const [id, n] of rows) {
        const tr = table.insertRow();
        tr.insertCell().textContent = id;
        tr.insertCell().textContent = n;
      }
      if (!rows.length) table.insertRow().insertCell().textContent = 'nothing yet';
    });
  }
  renderCounts();

  document.getElementById('reset').addEventListener('click', () => {
    chrome.storage.local.set({ counts: {} }, renderCounts);
  });
})();
