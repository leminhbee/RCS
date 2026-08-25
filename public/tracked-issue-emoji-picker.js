// Emoji picker for the tracked-issue compose modal. Exposes
// window.rcsEmojiPicker with open()/close()/getEmojiChar(name) methods.
//
// Curated list of common Slack emojis (name -> unicode char). Slack canvas
// renders `:name:` as the corresponding image, so we insert `:name:` into
// the editor and the char stays for our local details rendering.

(() => {
  const EMOJIS = [
    ['warning', '⚠️'], ['white_check_mark', '✅'], ['x', '❌'],
    ['heavy_check_mark', '✔️'], ['heavy_multiplication_x', '✖️'],
    ['question', '❓'], ['exclamation', '❗'], ['bangbang', '‼️'],
    ['rocket', '🚀'], ['tada', '🎉'], ['fire', '🔥'], ['sparkles', '✨'],
    ['thumbsup', '👍'], ['thumbsdown', '👎'], ['clap', '👏'], ['pray', '🙏'],
    ['muscle', '💪'], ['ok_hand', '👌'], ['point_right', '👉'], ['point_left', '👈'],
    ['eyes', '👀'], ['thinking_face', '🤔'], ['exploding_head', '🤯'],
    ['smiley', '😃'], ['grinning', '😀'], ['sweat_smile', '😅'],
    ['joy', '😂'], ['rolling_on_the_floor_laughing', '🤣'],
    ['heart', '❤️'], ['broken_heart', '💔'], ['orange_heart', '🧡'],
    ['bug', '🐛'], ['lady_beetle', '🐞'], ['ant', '🐜'],
    ['wrench', '🔧'], ['hammer', '🔨'], ['gear', '⚙️'], ['nut_and_bolt', '🔩'],
    ['zap', '⚡'], ['bulb', '💡'], ['battery', '🔋'], ['electric_plug', '🔌'],
    ['phone', '📞'], ['iphone', '📱'], ['computer', '💻'], ['desktop_computer', '🖥️'],
    ['satellite', '📡'], ['antenna_bars', '📶'], ['wifi', '📶'],
    ['calendar', '📅'], ['clock1', '🕐'], ['hourglass', '⌛'], ['alarm_clock', '⏰'],
    ['red_circle', '🔴'], ['large_orange_circle', '🟠'], ['large_yellow_circle', '🟡'],
    ['large_green_circle', '🟢'], ['large_blue_circle', '🔵'], ['large_purple_circle', '🟣'],
    ['white_circle', '⚪'], ['black_circle', '⚫'],
    ['no_entry', '⛔'], ['no_entry_sign', '🚫'], ['do_not_litter', '🚯'],
    ['construction', '🚧'], ['police_car_light', '🚨'], ['siren', '🚨'],
    ['dart', '🎯'], ['trophy', '🏆'], ['medal', '🏅'], ['star', '⭐'], ['star2', '🌟'],
    ['100', '💯'], ['checkered_flag', '🏁'], ['triangular_flag_on_post', '🚩'],
    ['mag', '🔍'], ['mag_right', '🔎'], ['memo', '📝'], ['pencil2', '✏️'],
    ['clipboard', '📋'], ['bookmark', '🔖'], ['pushpin', '📌'], ['round_pushpin', '📍'],
    ['link', '🔗'], ['paperclip', '📎'], ['scissors', '✂️'],
    ['bell', '🔔'], ['no_bell', '🔕'], ['loudspeaker', '📢'], ['mega', '📣'],
    ['inbox_tray', '📥'], ['outbox_tray', '📤'], ['envelope', '✉️'], ['e-mail', '📧'],
    ['package', '📦'], ['label', '🏷️'],
    ['coffee', '☕'], ['pizza', '🍕'], ['beer', '🍺'], ['cookie', '🍪'],
  ];

  let popup = null;
  let activeEditorRef = null;

  function ensurePopup() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.id = 'rcs-emoji-picker';
    popup.className = 'rcs-emoji-picker';
    popup.style.display = 'none';
    popup.innerHTML = `
      <input class="rcs-emoji-picker-search" type="text" placeholder="Search emoji…" autocomplete="off">
      <div class="rcs-emoji-picker-grid"></div>
    `;
    document.body.appendChild(popup);
    const search = popup.querySelector('.rcs-emoji-picker-search');
    const grid = popup.querySelector('.rcs-emoji-picker-grid');

    function renderGrid(filter = '') {
      const f = filter.trim().toLowerCase();
      const filtered = EMOJIS.filter(([name]) => !f || name.includes(f));
      grid.innerHTML = filtered
        .map(([name, char]) => `<button type="button" class="rcs-emoji-picker-btn" data-name="${name}" title=":${name}:">${char}</button>`)
        .join('');
    }
    renderGrid();

    search.addEventListener('input', (e) => renderGrid(e.target.value));
    grid.addEventListener('click', (e) => {
      const btn = e.target.closest('.rcs-emoji-picker-btn');
      if (!btn) return;
      const name = btn.dataset.name;
      insertIntoActiveEditor(`:${name}:`);
      hide();
    });

    document.addEventListener('click', (e) => {
      if (popup.style.display === 'none') return;
      if (popup.contains(e.target)) return;
      if (e.target.closest('.rcs-emoji-toolbar-btn')) return;
      hide();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && popup.style.display !== 'none') hide();
    });
    return popup;
  }

  function insertIntoActiveEditor(text) {
    if (activeEditorRef && typeof activeEditorRef.codemirror !== 'undefined') {
      const cm = activeEditorRef.codemirror;
      cm.replaceSelection(text);
      cm.focus();
      return;
    }
    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
      const start = el.selectionStart, end = el.selectionEnd;
      el.value = el.value.substring(0, start) + text + el.value.substring(end);
      el.selectionStart = el.selectionEnd = start + text.length;
      el.focus();
    }
  }

  function show(anchorEl, editor) {
    const p = ensurePopup();
    activeEditorRef = editor || null;
    const rect = anchorEl.getBoundingClientRect();
    p.style.display = '';
    p.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    p.style.left = Math.max(8, Math.min(rect.left + window.scrollX, window.innerWidth - 320)) + 'px';
    p.querySelector('.rcs-emoji-picker-search').value = '';
    p.querySelector('.rcs-emoji-picker-search').focus();
    p.querySelector('.rcs-emoji-picker-grid').innerHTML =
      EMOJIS.map(([name, char]) => `<button type="button" class="rcs-emoji-picker-btn" data-name="${name}" title=":${name}:">${char}</button>`).join('');
  }

  function hide() {
    if (popup) popup.style.display = 'none';
    activeEditorRef = null;
  }

  const nameToChar = Object.fromEntries(EMOJIS);
  function getEmojiChar(name) { return nameToChar[name] || null; }
  function renderEmojisInText(text) {
    if (!text) return text;
    return String(text).replace(/:([a-z0-9_+-]+):/gi, (m, name) => nameToChar[name] || m);
  }

  window.rcsEmojiPicker = { show, hide, getEmojiChar, renderEmojisInText, list: EMOJIS };
})();
