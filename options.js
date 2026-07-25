(function () {
  'use strict';
  const { rules } = globalThis.LFB;
  const box = document.getElementById('rules');

  const DEFAULTS = {
    enabled: true,
    mode: 'collapse',
    marking: true,
    disabled: [],
    phrases: [],
    allow: [],
    blockPosters: []
  };

  chrome.storage.sync.get(DEFAULTS, (data) => {
    document.getElementById('enabled').checked = data.enabled !== false;
    document.getElementById('mode').value = data.mode;
    document.getElementById('blockPosters').value = data.blockPosters.join('\n');
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
    const settings = {
      enabled,
      mode,
      disabled,
      phrases: lines('phrases'),
      allow: lines('allow'),
      blockPosters: lines('blockPosters')
    };
    chrome.storage.sync.set(settings, () => {
      const el = document.getElementById('saved');
      el.textContent = 'saved, reload LinkedIn';
      setTimeout(() => (el.textContent = ''), 3000);
    });
  });

  function addPhrase(phrase) {
    const box = document.getElementById('phrases');
    const have = box.value.split('\n').map((s) => s.trim());
    if (!have.includes(phrase)) box.value = (box.value.trim() + '\n' + phrase).trim();
    document.getElementById('save').click();
    renderLearn();
  }

  function addPoster(key) {
    const box = document.getElementById('blockPosters');
    const have = box.value.split('\n').map((s) => s.trim());
    if (!have.includes(key)) box.value = (box.value.trim() + '\n' + key).trim();
    document.getElementById('save').click();
  }

  function renderLearn() {
    const wrap = document.getElementById('learn');
    chrome.storage.local.get({ marked: [] }, ({ marked }) => {
      chrome.storage.sync.get({ phrases: [] }, ({ phrases }) => {
        wrap.textContent = '';
        if (!marked.length) {
          wrap.append(note('Nothing marked yet. Hover a card on LinkedIn and press F.'));
          return;
        }
        const { candidates, blocked, posters } = globalThis.LFBLearn.suggest(marked, { phrases });
        wrap.append(note(marked.length + ' card(s) marked.'));

        if (candidates.length) {
          wrap.append(head('Suggested phrases'));
          for (const c of candidates) {
            const row = document.createElement('div');
            row.append(document.createTextNode('"' + c.phrase + '" seen in ' + c.count + ' '));
            const b = document.createElement('button');
            b.textContent = 'Add';
            b.style.margin = '0 0 0 6px';
            b.addEventListener('click', () => addPhrase(c.phrase));
            row.append(b);
            wrap.append(row);
          }
        } else {
          wrap.append(note('No phrase recurs across two or more marks yet. Mark a few more.'));
        }

        if (posters.length) {
          wrap.append(head('Posters you marked'));
          for (const p of posters) {
            const row = document.createElement('div');
            row.append(document.createTextNode(p.name + ' (' + p.count + ') '));
            const b = document.createElement('button');
            b.textContent = 'Block this poster';
            b.style.margin = '0 0 0 6px';
            b.addEventListener('click', () => addPoster(p.key));
            row.append(b);
            wrap.append(row);
          }
        }

        wrap.append(head('Cards you marked'));
        wrap.append(note('Remove any you marked by mistake. On LinkedIn, pressing F again on a card also undoes it.'));
        marked
          .slice()
          .reverse()
          .forEach((m, i) => {
            const row = document.createElement('div');
            row.style.margin = '3px 0';
            const label = [m.title, m.company].filter(Boolean).join(' at ') || (m.text || '').slice(0, 70);
            row.append(document.createTextNode(label + ' '));
            const b = document.createElement('button');
            b.textContent = 'Remove';
            b.style.margin = '0 0 0 6px';
            b.addEventListener('click', () => {
              // reverse() above means index i counts back from the end
              const idx = marked.length - 1 - i;
              const next = marked.slice(0, idx).concat(marked.slice(idx + 1));
              chrome.storage.local.set({ marked: next }, renderLearn);
            });
            row.append(b);
            wrap.append(row);
          });

        if (blocked.length) {
          wrap.append(head('Not suggested'));
          wrap.append(
            note(
              'These recur in what you marked, but they identify people rather than describe ' +
                'behaviour, so they are not offered as rules. To stop seeing one specific person, ' +
                'use Block this poster above.'
            )
          );
          for (const b of blocked) {
            wrap.append(note('"' + b.phrase + '": ' + b.reason));
          }
        }
      });
    });
  }

  function note(text) {
    const p = document.createElement('p');
    p.className = 'sev';
    p.textContent = text;
    return p;
  }

  function head(text) {
    const h = document.createElement('h3');
    h.style.font = '600 13px/1.4 inherit';
    h.style.margin = '12px 0 4px';
    h.textContent = text;
    return h;
  }

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
  renderLearn();

  document.getElementById('reset').addEventListener('click', () => {
    chrome.storage.local.set({ counts: {} }, renderCounts);
  });

  document.getElementById('clearMarks').addEventListener('click', () => {
    chrome.storage.local.set({ marked: [] }, renderLearn);
  });
})();
