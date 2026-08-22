const state = {
  filter: '',
  search: '',
  rarity: '',
  type: '',
  cardClass: '',
  cards: [],
};

const grid = document.getElementById('grid');
const emptyMsg = document.getElementById('empty');
const statsEl = document.getElementById('stats');
const modalOverlay = document.getElementById('modalOverlay');
const modalContent = document.getElementById('modalContent');

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v) usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

async function loadStats() {
  const res = await fetch('/api/stats');
  const s = await res.json();
  statsEl.innerHTML = `
    <span><b>${s.owned}</b>/${s.total} possédées</span>
    <span><b>${s.missing}</b> manquantes</span>
    <span><b>${s.notMaxedWithStock}</b> avec doublons non utilisés</span>
    <span><b>${s.notAwakened}</b> non Dokkan Awaken</span>
  `;
}

async function loadCards() {
  const res = await fetch(
    `/api/cards${qs({
      filter: state.filter,
      search: state.search,
      rarity: state.rarity,
      type: state.type,
      cardClass: state.cardClass,
    })}`,
  );
  state.cards = await res.json();
  renderGrid();
}

function renderGrid() {
  grid.innerHTML = '';
  emptyMsg.classList.toggle('hidden', state.cards.length > 0);

  const fragment = document.createDocumentFragment();
  for (const card of state.cards) {
    fragment.appendChild(renderTile(card));
  }
  grid.appendChild(fragment);
}

function renderTile(card) {
  const tile = document.createElement('div');
  tile.className = `card-tile rarity-${card.rarity || 'N'} ${card.owned ? '' : 'not-owned'}`;
  tile.title = `${card.name} - ${card.title || ''}`;

  const flags = [];
  if (card.owned && card.canUpgrade) flags.push('<span title="Doublons disponibles non utilisés">🔺</span>');
  if (card.owned && !card.dokkanAwakened) flags.push('<span title="Pas encore Dokkan Awaken">🌀</span>');

  tile.innerHTML = `
    <div class="inner">
      <img src="${card.imageUrl}" alt="${card.name}" loading="lazy"
           onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect width=%22100%22 height=%22100%22 fill=%22%23131a2b%22/></svg>'" />
      <div class="type-badge type-${card.type || ''}">${card.type ? card.type[0] : '?'}</div>
      <div class="flag-icons">${flags.join('')}</div>
      ${card.owned ? `<div class="percent-badge ${card.currentPercent >= 100 ? 'maxed' : ''}">${card.currentPercent}%</div>` : ''}
    </div>
  `;

  tile.addEventListener('click', () => openModal(card));
  return tile;
}

function openModal(card) {
  modalOverlay.classList.remove('hidden');
  modalContent.innerHTML = `
    <img class="modal-image" src="${card.imageUrl}" alt="${card.name}"
         onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22220%22 height=%22220%22><rect width=%22220%22 height=%22220%22 fill=%22%23131a2b%22/></svg>'" />
    <h2>${card.name}</h2>
    <p class="subtitle">${card.title || ''}</p>
    <div class="modal-tags">
      <span>${card.rarity || '?'}</span>
      <span>${card.type || '?'}</span>
      <span>${card.class || '?'}</span>
    </div>

    <div class="field-row">
      <label for="f-owned">Carte possédée</label>
      <label class="switch">
        <input type="checkbox" id="f-owned" ${card.owned ? 'checked' : ''} />
        <span class="slider"></span>
      </label>
    </div>

    <div class="field-row">
      <label>% actuel (en jeu)</label>
      <div class="stepper">
        <button type="button" id="pct-down">-10</button>
        <output id="pct-value">${card.currentPercent}%</output>
        <button type="button" id="pct-up">+10</button>
      </div>
    </div>

    <div class="field-row">
      <label>Doublons en stock (non utilisés)</label>
      <div class="stepper">
        <button type="button" id="stock-down">-1</button>
        <output id="stock-value">${card.dupesInStock}</output>
        <button type="button" id="stock-up">+1</button>
      </div>
    </div>

    <div class="field-row">
      <label for="f-awakened">Dokkan Awaken effectué</label>
      <label class="switch">
        <input type="checkbox" id="f-awakened" ${card.dokkanAwakened ? 'checked' : ''} />
        <span class="slider"></span>
      </label>
    </div>

    <div id="upgradeHint" class="upgrade-hint hidden"></div>
    <div id="saveIndicator" class="save-indicator">Enregistré ✓</div>
  `;

  const local = {
    owned: card.owned,
    currentPercent: card.currentPercent,
    dupesInStock: card.dupesInStock,
    dokkanAwakened: card.dokkanAwakened,
  };

  const pctValue = modalContent.querySelector('#pct-value');
  const stockValue = modalContent.querySelector('#stock-value');
  const upgradeHint = modalContent.querySelector('#upgradeHint');

  function refreshHint() {
    const potential = Math.min(100, local.currentPercent + local.dupesInStock * 10);
    if (local.owned && potential > local.currentPercent) {
      upgradeHint.classList.remove('hidden');
      upgradeHint.textContent = `Tu peux monter cette carte à ${potential}% avec les doublons que tu as en stock !`;
    } else {
      upgradeHint.classList.add('hidden');
    }
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
  }

  async function save() {
    const res = await fetch(`/api/collection/${card.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(local),
    });
    const updated = await res.json();
    Object.assign(card, updated);
    const indicator = modalContent.querySelector('#saveIndicator');
    if (indicator) {
      indicator.classList.add('visible');
      setTimeout(() => indicator.classList.remove('visible'), 900);
    }
    loadStats();
  }

  modalContent.querySelector('#f-owned').addEventListener('change', (e) => {
    local.owned = e.target.checked;
    refreshHint();
    scheduleSave();
  });

  modalContent.querySelector('#f-awakened').addEventListener('change', (e) => {
    local.dokkanAwakened = e.target.checked;
    scheduleSave();
  });

  modalContent.querySelector('#pct-up').addEventListener('click', () => {
    local.currentPercent = Math.min(100, local.currentPercent + 10);
    pctValue.textContent = `${local.currentPercent}%`;
    refreshHint();
    scheduleSave();
  });
  modalContent.querySelector('#pct-down').addEventListener('click', () => {
    local.currentPercent = Math.max(0, local.currentPercent - 10);
    pctValue.textContent = `${local.currentPercent}%`;
    refreshHint();
    scheduleSave();
  });

  modalContent.querySelector('#stock-up').addEventListener('click', () => {
    local.dupesInStock += 1;
    stockValue.textContent = local.dupesInStock;
    refreshHint();
    scheduleSave();
  });
  modalContent.querySelector('#stock-down').addEventListener('click', () => {
    local.dupesInStock = Math.max(0, local.dupesInStock - 1);
    stockValue.textContent = local.dupesInStock;
    refreshHint();
    scheduleSave();
  });

  refreshHint();
}

document.getElementById('modalClose').addEventListener('click', () => {
  modalOverlay.classList.add('hidden');
  loadCards();
});
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) {
    modalOverlay.classList.add('hidden');
    loadCards();
  }
});

document.getElementById('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  state.filter = btn.dataset.filter;
  loadCards();
});

let searchTimer = null;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    loadCards();
  }, 200);
});

document.getElementById('filterRarity').addEventListener('change', (e) => {
  state.rarity = e.target.value;
  loadCards();
});
document.getElementById('filterType').addEventListener('change', (e) => {
  state.type = e.target.value;
  loadCards();
});
document.getElementById('filterClass').addEventListener('change', (e) => {
  state.cardClass = e.target.value;
  loadCards();
});

loadStats();
loadCards();
