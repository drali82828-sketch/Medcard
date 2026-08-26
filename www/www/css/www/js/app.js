/* ============================================================
   Smart Flashcard — App controller
   ============================================================ */
(() => {
  let state = {
    screen: 'home',
    reviewQueue: [],
    reviewIndex: 0,
    reviewFlipped: false,
    reviewStats: { total: 0, hard: 0, medium: 0, easy: 0 },
    cardsFilter: 'all',
    cardsDeck: null,
    cardsSearch: ''
  };

  function $(sel, root){ return (root || document).querySelector(sel); }
  function $$(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }

  // ---------------- Splash ----------------
  function buildParticles(){
    const wrap = $('#splashParticles');
    for(let i = 0; i < 22; i++){
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.top = Math.random() * 100 + '%';
      p.style.animationDelay = (Math.random() * 4) + 's';
      p.style.animationDuration = (4 + Math.random() * 4) + 's';
      wrap.appendChild(p);
    }
  }

  function runSplash(){
    buildParticles();
    setTimeout(() => {
      const el = $('#splash');
      el.classList.add('hide');
      setTimeout(() => el.remove(), 550);
    }, 2500);
  }

  // ---------------- Toast ----------------
  let toastTimer = null;
  function toast(msg){
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------------- Theme ----------------
  async function applyTheme(theme){
    if(theme === 'system'){
      const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.dataset.theme = dark ? 'dark' : 'light';
    } else {
      document.body.dataset.theme = theme;
    }
    document.querySelector('meta[name="theme-color"]').setAttribute('content',
      document.body.dataset.theme === 'dark' ? '#0E1730' : '#14203F');
    if(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins.StatusBar){
      try{
        await window.Capacitor.Plugins.StatusBar.setStyle({ style: document.body.dataset.theme === 'dark' ? 'DARK' : 'LIGHT' });
      }catch(e){}
    }
  }

  async function toggleTheme(){
    const current = await DB.getSetting('theme', 'light');
    const order = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(current) + 1) % order.length];
    await DB.setSetting('theme', next);
    await applyTheme(next);
    toast(next === 'system' ? 'Following system theme' : `${next[0].toUpperCase()}${next.slice(1)} mode`);
  }

  // ---------------- Navigation ----------------
  function go(screen){
    state.screen = screen;
    $$('.screen').forEach(s => s.classList.remove('active'));
    $('#screen-' + screen).classList.add('active');
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === screen));
    if(screen === 'home') renderHome();
    if(screen === 'cards') renderCardsScreen();
    if(screen === 'stats') renderStats();
    if(screen === 'settings') renderSettings();
    if(screen === 'add') resetAddForm();
    if(screen === 'review') startReviewSession();
    window.scrollTo(0,0);
  }

  // ---------------- Deck helpers ----------------
  async function deckMap(){
    const decks = await DB.getDecks();
    const map = {};
    decks.forEach(d => map[d.id] = d.name);
    return map;
  }

  async function refreshDeckSelects(){
    const decks = await DB.getDecks();
    const sel = $('#cardDeck');
    sel.innerHTML = '<option value="">No deck</option>' + decks.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
  }

  function escapeHtml(s){
    return String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // ---------------- HOME ----------------
  async function renderHome(){
    const [cards, logs] = await Promise.all([DB.getAllCards(), DB.getAllLogs()]);
    const now = Date.now();
    const host = $('#homeContent');

    if(cards.length === 0){
      host.innerHTML = `
        <div class="empty-state">
          <div class="glyph">🧠</div>
          <h2>Your Memory System Is Empty</h2>
          <p>Add your first piece of information and let the application take care of the reviews.</p>
          <button class="btn-primary" style="background:var(--blue);color:#fff;" id="emptyAddBtn">+ ADD INFORMATION</button>
        </div>`;
      $('#emptyAddBtn').onclick = () => go('add');
      return;
    }

    const due = cards.filter(c => c.nextReview <= now);
    const overdue = due.filter(c => c.status !== 'NEW' && c.nextReview < now - SRS.DAY);
    const hardDue = due.filter(c => SRS.displayStatus(c, now) === 'OVERDUE' || c.status === 'RELEARNING').length;
    const newCount = cards.filter(c => c.status === 'NEW').length;
    const learningCount = cards.filter(c => c.status === 'LEARNING' || c.status === 'RELEARNING').length;
    const reviewCount = cards.filter(c => c.status === 'REVIEW' || c.status === 'MASTERED').length;

    const streak = await computeStreak(logs);

    let subMsg = 'Nothing due right now — nice work staying ahead.';
    if(due.length === 1) subMsg = '1 card is ready for review.';
    else if(due.length > 1) subMsg = `${due.length} cards are ready for review.`;
    if(overdue.length > 0) subMsg = `You have ${overdue.length} overdue card${overdue.length>1?'s':''}.`;

    host.innerHTML = `
      <div class="hero">
        <div class="eyebrow">Today's Review</div>
        <div class="count mono">${due.length}</div>
        <div class="sub">${subMsg}</div>
        ${due.length > 0
          ? `<button class="btn-primary" id="startReviewBtn">START REVIEW</button>`
          : `<button class="btn-ghost-onhero" id="addMoreBtn">+ Add more information</button>`}
        <div class="stat-row">
          <div class="stat-pill"><b>${newCount}</b><span>New</span></div>
          <div class="stat-pill"><b>${learningCount}</b><span>Learning</span></div>
          <div class="stat-pill"><b>${reviewCount}</b><span>Review</span></div>
        </div>
      </div>

      ${hardDue > 0 ? `<div class="streak-strip"><span class="fire">⚠️</span><span>You have <b>${hardDue}</b> challenging card${hardDue>1?'s':''} waiting.</span></div>` : ''}

      <div class="mini-stats">
        <div class="mini-card"><div class="n">📚 ${cards.length}</div><div class="l">Total Cards</div></div>
        <div class="mini-card"><div class="n">🔥 ${streak}</div><div class="l">Day Streak</div></div>
        <div class="mini-card"><div class="n">${masteredPct(cards)}%</div><div class="l">Mastered</div></div>
      </div>
    `;
    const startBtn = $('#startReviewBtn');
    if(startBtn) startBtn.onclick = () => go('review');
    const addBtn = $('#addMoreBtn');
    if(addBtn) addBtn.onclick = () => go('add');
  }

  function masteredPct(cards){
    if(cards.length === 0) return 0;
    const m = cards.filter(c => c.status === 'MASTERED').length;
    return Math.round((m / cards.length) * 100);
  }

  async function computeStreak(logs){
    if(logs.length === 0) return 0;
    const days = new Set(logs.map(l => new Date(l.timestamp).toDateString()));
    let streak = 0;
    let cursor = new Date();
    if(!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
    while(days.has(cursor.toDateString())){
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  // ---------------- ADD ----------------
  function resetAddForm(){
    $('#cardQuestion').value = '';
    $('#cardAnswer').value = '';
    $('#cardTags').value = '';
    $('#cardNotes').value = '';
    $('#quickAddText').value = '';
    refreshDeckSelects();
  }

  function quickAddToQA(){
    const raw = $('#quickAddText').value.trim();
    if(!raw){ toast('Type a fact first'); return; }
    // Lightweight local heuristic (no network/AI call): turns a statement into a question.
    // The user reviews and edits before saving — never auto-saved.
    let q = raw.replace(/\.$/, '');
    q = `What is described by: "${q}"?`;
    $('#cardQuestion').value = q;
    $('#cardAnswer').value = raw;
    toast('Draft created — review before saving');
  }

  async function saveCard(){
    const question = $('#cardQuestion').value.trim();
    const answer = $('#cardAnswer').value.trim();
    if(!question || !answer){ toast('Question and answer are required'); return; }
    const deckId = $('#cardDeck').value ? Number($('#cardDeck').value) : null;
    const tags = $('#cardTags').value.split(',').map(t => t.trim()).filter(Boolean);
    const notes = $('#cardNotes').value.trim();

    const id = await DB.addCard({ question, answer, deckId, tags, notes });
    const card = await DB.getCard(id);
    await Notif.scheduleForCard(card, 1);
    toast('Saved — first review scheduled');
    resetAddForm();
    go('home');
  }

  // ---------------- REVIEW ----------------
  async function startReviewSession(){
    const cards = await DB.getDueCards();
    state.reviewQueue = cards;
    state.reviewIndex = 0;
    state.reviewFlipped = false;
    state.reviewStats = { total: cards.length, hard: 0, medium: 0, easy: 0 };
    renderReview();
  }

  async function renderReview(){
    const host = $('#reviewContent');
    const { reviewQueue, reviewIndex } = state;

    if(reviewQueue.length === 0){
      host.innerHTML = `
        <div class="empty-state">
          <div class="glyph">✅</div>
          <h2>All caught up</h2>
          <p>No cards are due right now. New reviews will appear here as they come up.</p>
          <button class="btn-primary" style="background:var(--blue);color:#fff;" id="reviewHomeBtn">Back to Home</button>
        </div>`;
      $('#reviewHomeBtn').onclick = () => go('home');
      return;
    }

    if(reviewIndex >= reviewQueue.length){
      const s = state.reviewStats;
      host.innerHTML = `
        <div class="empty-state">
          <div class="glyph">🎉</div>
          <h2>Session complete</h2>
          <p>You reviewed ${s.total} card${s.total>1?'s':''}.</p>
          <div class="diff-dist" style="max-width:260px;margin:0 auto 10px;">
            ${s.hard ? `<div class="seg hard" style="flex:${s.hard}"></div>`:''}
            ${s.medium ? `<div class="seg medium" style="flex:${s.medium}"></div>`:''}
            ${s.easy ? `<div class="seg easy" style="flex:${s.easy}"></div>`:''}
          </div>
          <p style="font-size:.8rem;">🔴 ${s.hard} Hard · 🟠 ${s.medium} Medium · 🟢 ${s.easy} Easy</p>
          <button class="btn-primary" style="background:var(--blue);color:#fff;" id="reviewHomeBtn">Back to Home</button>
        </div>`;
      $('#reviewHomeBtn').onclick = () => go('home');
      return;
    }

    const card = reviewQueue[reviewIndex];
    const decks = await deckMap();
    const pct = Math.round((reviewIndex / reviewQueue.length) * 100);

    host.innerHTML = `
      <div class="review-progress">
        <div class="track"><div class="fill" style="width:${pct}%"></div></div>
        <div class="count mono">${reviewIndex + 1}/${reviewQueue.length}</div>
      </div>
      <div class="flashcard" id="flashcard">
        <div class="flashcard-inner">
          <div class="flashcard-face front">
            <div class="face-label">Question</div>
            ${card.deckId && decks[card.deckId] ? `<div class="face-deck">${escapeHtml(decks[card.deckId])}</div>` : ''}
            <div class="face-text">${escapeHtml(card.question)}</div>
          </div>
          <div class="flashcard-face back">
            <div class="face-label">Answer</div>
            <div class="face-text">${escapeHtml(card.answer)}</div>
          </div>
        </div>
      </div>
      <div id="reviewActionArea"></div>
    `;

    const actionArea = $('#reviewActionArea');
    if(!state.reviewFlipped){
      actionArea.innerHTML = `<button class="btn-primary" style="background:var(--blue);color:#fff;" id="showAnswerBtn">SHOW ANSWER</button>`;
      $('#showAnswerBtn').onclick = () => {
        state.reviewFlipped = true;
        $('#flashcard').classList.add('flipped');
        setTimeout(renderReviewActions, 260);
      };
    } else {
      $('#flashcard').classList.add('flipped');
      renderReviewActions();
    }
  }

  function renderReviewActions(){
    const actionArea = $('#reviewActionArea');
    actionArea.innerHTML = `
      <p style="text-align:center;color:var(--text-dim);font-size:.86rem;margin:14px 0 12px;">How well did you remember it?</p>
      <div class="diff-grid">
        <button class="diff-btn hard" data-r="HARD">🔴 HARD<small>Forgot it</small></button>
        <button class="diff-btn medium" data-r="MEDIUM">🟠 MEDIUM<small>Took effort</small></button>
        <button class="diff-btn easy" data-r="EASY">🟢 EASY<small>Instant recall</small></button>
      </div>
    `;
    $$('.diff-btn').forEach(b => b.onclick = () => rateCard(b.dataset.r));
  }

  async function rateCard(rating){
    const card = state.reviewQueue[state.reviewIndex];
    const updated = SRS.schedule(card, rating);
    await DB.updateCard(updated);
    await DB.logReview({ cardId: card.id, rating, intervalHours: updated.interval });
    await Notif.scheduleForCard(updated, 1);

    state.reviewStats[rating.toLowerCase()]++;

    const messages = {
      HARD: `We'll review this again soon.<br>Next review: ${SRS.formatInterval(updated.interval)}`,
      MEDIUM: `We'll strengthen this memory.<br>Next review: ${SRS.formatInterval(updated.interval)}`,
      EASY: `Great! We'll give your brain more time.<br>Next review: ${SRS.formatInterval(updated.interval)}`
    };
    showNextToast(messages[rating]);

    state.reviewIndex++;
    state.reviewFlipped = false;
    setTimeout(renderReview, 700);
  }

  function showNextToast(html){
    let el = document.querySelector('.next-toast');
    if(!el){
      el = document.createElement('div');
      el.className = 'next-toast';
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 900);
  }

  // ---------------- CARDS LIST ----------------
  const FILTERS = ['all','new','due','overdue','learning','review','mastered','hard','medium','easy'];

  async function renderCardsScreen(){
    $('#filterChips').innerHTML = FILTERS.map(f =>
      `<button class="filter-chip ${state.cardsFilter===f?'active':''}" data-f="${f}">${f[0].toUpperCase()+f.slice(1)}</button>`
    ).join('');
    $$('.filter-chip').forEach(b => b.onclick = () => { state.cardsFilter = b.dataset.f; renderCardsScreen(); });

    const decks = await DB.getDecks();
    $('#deckChipsForCards').innerHTML =
      `<span class="deck-chip ${state.cardsDeck===null?'active':''}" data-d="">All decks</span>` +
      decks.map(d => `<span class="deck-chip ${state.cardsDeck===d.id?'active':''}" data-d="${d.id}">${escapeHtml(d.name)}</span>`).join('') +
      `<span class="deck-chip" id="manageDecksChip">⚙ Manage</span>`;
    $$('.deck-chip[data-d]').forEach(b => b.onclick = () => {
      state.cardsDeck = b.dataset.d === '' ? null : Number(b.dataset.d);
      renderCardsScreen();
    });
    const manageChip = $('#manageDecksChip');
    if(manageChip) manageChip.onclick = openDeckModal;

    $('#cardSearch').oninput = (e) => { state.cardsSearch = e.target.value.toLowerCase(); renderCardsList(); };
    $('#cardSearch').value = state.cardsSearch;

    renderCardsList();
  }

  async function renderCardsList(){
    const [cards, decks] = await Promise.all([DB.getAllCards(), deckMap()]);
    const now = Date.now();
    let list = cards;

    if(state.cardsDeck !== null) list = list.filter(c => c.deckId === state.cardsDeck);
    if(state.cardsSearch){
      const q = state.cardsSearch;
      list = list.filter(c =>
        c.question.toLowerCase().includes(q) ||
        c.answer.toLowerCase().includes(q) ||
        (c.tags||[]).some(t => t.toLowerCase().includes(q)) ||
        (decks[c.deckId]||'').toLowerCase().includes(q)
      );
    }
    const f = state.cardsFilter;
    if(f === 'new') list = list.filter(c => c.status === 'NEW');
    else if(f === 'due') list = list.filter(c => c.nextReview <= now);
    else if(f === 'overdue') list = list.filter(c => SRS.displayStatus(c, now) === 'OVERDUE');
    else if(f === 'learning') list = list.filter(c => c.status === 'LEARNING' || c.status === 'RELEARNING');
    else if(f === 'review') list = list.filter(c => c.status === 'REVIEW');
    else if(f === 'mastered') list = list.filter(c => c.status === 'MASTERED');
    else if(f === 'hard') list = list.filter(c => c.hardCount > 0);
    else if(f === 'medium') list = list.filter(c => c.mediumCount > 0);
    else if(f === 'easy') list = list.filter(c => c.easyCount > 0);

    const host = $('#cardsList');
    if(list.length === 0){
      host.innerHTML = `<div class="empty-state"><div class="glyph">🔍</div><h2>No cards found</h2><p>Try a different filter or search term.</p></div>`;
      return;
    }
    list.sort((a,b) => a.nextReview - b.nextReview);
    host.innerHTML = list.map(c => {
      const st = SRS.displayStatus(c, now);
      return `
      <div class="card-row" data-id="${c.id}">
        <div class="q">${escapeHtml(c.question)}</div>
        <div class="meta">
          <span class="badge ${st.toLowerCase()}">${st}</span>
          ${c.deckId && decks[c.deckId] ? `<span>${escapeHtml(decks[c.deckId])}</span><span class="dot"></span>`:''}
          <span>${c.reviews} review${c.reviews!==1?'s':''}</span>
          <span class="dot"></span>
          <span>Next: ${new Date(c.nextReview).toLocaleDateString()}</span>
        </div>
      </div>`;
    }).join('');
    $$('.card-row').forEach(row => row.onclick = () => openCardEditor(Number(row.dataset.id)));
  }

  async function openCardEditor(id){
    const card = await DB.getCard(id);
    const decks = await DB.getDecks();
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop show';
    backdrop.innerHTML = `
      <div class="modal-sheet">
        <div class="modal-close"><button class="icon-btn" id="editClose">✕</button></div>
        <h3>Edit Card</h3>
        <div class="field"><label>Question</label><textarea id="editQ">${escapeHtml(card.question)}</textarea></div>
        <div class="field"><label>Answer</label><textarea id="editA">${escapeHtml(card.answer)}</textarea></div>
        <div class="field">
          <label>Deck</label>
          <select id="editDeck">
            <option value="">No deck</option>
            ${decks.map(d => `<option value="${d.id}" ${card.deckId===d.id?'selected':''}>${escapeHtml(d.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Tags</label><input id="editTags" value="${escapeHtml((card.tags||[]).join(', '))}"></div>
        <button class="btn-primary" style="background:var(--blue);color:#fff;margin-bottom:10px;" id="editSaveBtn">SAVE CHANGES</button>
        <button class="btn-secondary" style="margin-bottom:10px;" id="editResetBtn">Reset learning progress</button>
        <button class="btn-secondary" id="editDeleteBtn" style="color:var(--hard);border-color:var(--hard);">Delete card</button>
      </div>`;
    document.body.appendChild(backdrop);
    backdrop.onclick = (e) => { if(e.target === backdrop) backdrop.remove(); };
    $('#editClose', backdrop).onclick = () => backdrop.remove();

    backdrop.querySelector('#editSaveBtn').onclick = async () => {
      card.question = backdrop.querySelector('#editQ').value.trim();
      card.answer = backdrop.querySelector('#editA').value.trim();
      card.deckId = backdrop.querySelector('#editDeck').value ? Number(backdrop.querySelector('#editDeck').value) : null;
      card.tags = backdrop.querySelector('#editTags').value.split(',').map(t=>t.trim()).filter(Boolean);
      await DB.updateCard(card);
      toast('Card updated');
      backdrop.remove();
      renderCardsList();
    };
    backdrop.querySelector('#editResetBtn').onclick = async () => {
      Object.assign(card, { interval: 0, ease: 2.0, reviews: 0, hardCount:0, mediumCount:0, easyCount:0, status:'NEW', nextReview: Date.now(), lastReview: null });
      await DB.updateCard(card);
      await Notif.scheduleForCard(card, 1);
      toast('Progress reset — card is NEW again');
      backdrop.remove();
      renderCardsList();
    };
    backdrop.querySelector('#editDeleteBtn').onclick = async () => {
      if(!confirm('Delete this card permanently?')) return;
      await Notif.cancelForCard(card.id);
      await DB.deleteCard(card.id);
      toast('Card deleted');
      backdrop.remove();
      renderCardsList();
    };
  }

  // ---------------- DECK MODAL ----------------
  function openDeckModal(){ $('#deckModalBackdrop').classList.add('show'); renderDeckManageList(); }
  function closeDeckModal(){ $('#deckModalBackdrop').classList.remove('show'); }

  async function renderDeckManageList(){
    const decks = await DB.getDecks();
    const cards = await DB.getAllCards();
    const host = $('#deckManageList');
    if(decks.length === 0){
      host.innerHTML = `<p style="color:var(--text-dim);font-size:.86rem;">No decks yet. Create one above.</p>`;
      return;
    }
    host.innerHTML = decks.map(d => {
      const count = cards.filter(c => c.deckId === d.id).length;
      return `<div class="setting-row">
        <div><div class="label">${escapeHtml(d.name)}</div><div class="desc">${count} card${count!==1?'s':''}</div></div>
        <div style="display:flex;gap:8px;">
          <button class="icon-btn" data-rename="${d.id}" title="Rename">✎</button>
          <button class="icon-btn" data-del="${d.id}" title="Delete">🗑</button>
        </div>
      </div>`;
    }).join('');
    $$('#deckManageList [data-rename]').forEach(b => b.onclick = async () => {
      const name = prompt('Rename deck to:');
      if(name && name.trim()){ await DB.renameDeck(Number(b.dataset.rename), name.trim()); renderDeckManageList(); refreshDeckSelects(); renderCardsScreen(); }
    });
    $$('#deckManageList [data-del]').forEach(b => b.onclick = async () => {
      if(!confirm('Delete this deck? Cards will be kept but unassigned.')) return;
      await DB.deleteDeck(Number(b.dataset.del));
      renderDeckManageList(); refreshDeckSelects(); renderCardsScreen();
    });
  }

  // ---------------- STATISTICS ----------------
  async function renderStats(){
    const [cards, logs] = await Promise.all([DB.getAllCards(), DB.getAllLogs()]);
    const host = $('#statsContent');

    if(cards.length === 0){
      host.innerHTML = `<div class="empty-state"><div class="glyph">📊</div><h2>No activity yet</h2><p>Statistics appear once you start adding and reviewing cards.</p></div>`;
      return;
    }

    const totalReviews = logs.length;
    const hard = logs.filter(l => l.rating === 'HARD').length;
    const medium = logs.filter(l => l.rating === 'MEDIUM').length;
    const easy = logs.filter(l => l.rating === 'EASY').length;
    const mastered = cards.filter(c => c.status === 'MASTERED').length;
    const overdue = cards.filter(c => SRS.displayStatus(c) === 'OVERDUE').length;
    const streak = await computeStreak(logs);
    const accuracy = totalReviews ? Math.round(((medium + easy) / totalReviews) * 100) : 0;

    const now = new Date();
    const dayBuckets = [];
    for(let i = 6; i >= 0; i--){
      const d = new Date(now); d.setDate(now.getDate() - i);
      const key = d.toDateString();
      const count = logs.filter(l => new Date(l.timestamp).toDateString() === key).length;
      dayBuckets.push({ label: d.toLocaleDateString(undefined,{ weekday:'short' })[0], count });
    }
    const maxDay = Math.max(1, ...dayBuckets.map(b => b.count));

    host.innerHTML = `
      <div class="mini-stats">
        <div class="mini-card"><div class="n">${cards.length}</div><div class="l">Total Cards</div></div>
        <div class="mini-card"><div class="n">${totalReviews}</div><div class="l">Total Reviews</div></div>
        <div class="mini-card"><div class="n">${accuracy}%</div><div class="l">Accuracy</div></div>
      </div>
      <div class="mini-stats" style="margin-top:10px;">
        <div class="mini-card"><div class="n">🔥 ${streak}</div><div class="l">Study Streak</div></div>
        <div class="mini-card"><div class="n">${mastered}</div><div class="l">Mastered</div></div>
        <div class="mini-card"><div class="n">${overdue}</div><div class="l">Overdue</div></div>
      </div>

      <div class="section-title">Reviews — last 7 days</div>
      <div class="card">
        <div class="bar-chart">
          ${dayBuckets.map(b => `<div class="bar" style="height:${Math.max(4,(b.count/maxDay)*100)}%"></div>`).join('')}
        </div>
        <div class="bar-chart bar-label">${dayBuckets.map(b => `<span>${b.label}</span>`).join('')}</div>
      </div>

      <div class="section-title">Difficulty distribution</div>
      <div class="card">
        <div class="diff-dist">
          ${hard ? `<div class="seg hard" style="flex:${hard}"></div>`:''}
          ${medium ? `<div class="seg medium" style="flex:${medium}"></div>`:''}
          ${easy ? `<div class="seg easy" style="flex:${easy}"></div>`:''}
          ${totalReviews===0 ? `<div class="seg" style="flex:1;background:var(--border)"></div>`:''}
        </div>
        <div class="legend">
          <span><span class="sw" style="background:var(--hard)"></span>Hard ${hard}</span>
          <span><span class="sw" style="background:var(--medium)"></span>Medium ${medium}</span>
          <span><span class="sw" style="background:var(--easy)"></span>Easy ${easy}</span>
        </div>
      </div>
    `;
  }

  // ---------------- SETTINGS ----------------
  async function renderSettings(){
    const host = $('#settingsContent');
    const [dailyGoal, newPerDay, notifOn, sound, vibration, animations, theme] = await Promise.all([
      DB.getSetting('dailyGoal', 20),
      DB.getSetting('newCardsPerDay', 10),
      DB.getSetting('notificationsEnabled', true),
      DB.getSetting('soundEnabled', true),
      DB.getSetting('vibrationEnabled', true),
      DB.getSetting('animationsEnabled', true),
      DB.getSetting('theme', 'light')
    ]);

    host.innerHTML = `
      <div class="section-title">Study</div>
      <div class="card">
        <div class="field"><label>Daily review goal</label><input type="number" id="setGoal" value="${dailyGoal}" min="1"></div>
        <div class="field" style="margin-bottom:0;"><label>New cards per day</label><input type="number" id="setNewPerDay" value="${newPerDay}" min="1"></div>
      </div>

      <div class="section-title">Notifications</div>
      <div class="card">
        <div class="setting-row">
          <div><div class="label">Enable notifications</div><div class="desc">Get reminded when cards are due</div></div>
          <div class="switch ${notifOn?'on':''}" id="switchNotif"><div class="knob"></div></div>
        </div>
      </div>

      <div class="section-title">Appearance</div>
      <div class="card">
        <div class="theme-row">
          <div class="theme-opt ${theme==='light'?'active':''}" data-t="light">☀️ Light</div>
          <div class="theme-opt ${theme==='dark'?'active':''}" data-t="dark">🌙 Dark</div>
          <div class="theme-opt ${theme==='system'?'active':''}" data-t="system">⚙️ System</div>
        </div>
      </div>

      <div class="section-title">Experience</div>
      <div class="card">
        <div class="setting-row">
          <div><div class="label">Sound</div></div>
          <div class="switch ${sound?'on':''}" id="switchSound"><div class="knob"></div></div>
        </div>
        <div class="setting-row">
          <div><div class="label">Vibration</div></div>
          <div class="switch ${vibration?'on':''}" id="switchVibe"><div class="knob"></div></div>
        </div>
        <div class="setting-row">
          <div><div class="label">Animations</div></div>
          <div class="switch ${animations?'on':''}" id="switchAnim"><div class="knob"></div></div>
        </div>
      </div>

      <div class="section-title">Data</div>
      <div class="card">
        <button class="btn-secondary" id="exportBtn" style="margin-bottom:10px;">⬇ Export data</button>
        <button class="btn-secondary" id="importBtn" style="margin-bottom:10px;">⬆ Import data</button>
        <input type="file" id="importFile" accept="application/json" style="display:none;">
        <button class="btn-secondary" id="resetBtn" style="color:var(--hard);border-color:var(--hard);">Reset all progress</button>
      </div>

      <div class="section-title">About</div>
      <div class="about-card card">
        <div class="about-icon">🧠</div>
        <h3 class="display">Smart Flashcard</h3>
        <div class="creator">
          <b>Made by Ali Mohammad Mahdi</b>
          College of Medicine<br>University of Kufa
        </div>
      </div>
    `;

    $('#setGoal').onchange = (e) => DB.setSetting('dailyGoal', Number(e.target.value) || 20);
    $('#setNewPerDay').onchange = (e) => DB.setSetting('newCardsPerDay', Number(e.target.value) || 10);

    $('#switchNotif').onclick = async () => {
      const cur = await DB.getSetting('notificationsEnabled', true);
      if(!cur){ const granted = await Notif.requestPermission(); if(!granted){ toast('Permission denied'); return; } }
      await DB.setSetting('notificationsEnabled', !cur);
      renderSettings();
    };
    $('#switchSound').onclick = async () => { const c = await DB.getSetting('soundEnabled', true); await DB.setSetting('soundEnabled', !c); renderSettings(); };
    $('#switchVibe').onclick = async () => { const c = await DB.getSetting('vibrationEnabled', true); await DB.setSetting('vibrationEnabled', !c); renderSettings(); };
    $('#switchAnim').onclick = async () => { const c = await DB.getSetting('animationsEnabled', true); await DB.setSetting('animationsEnabled', !c); renderSettings(); };

    $$('.theme-opt').forEach(el => el.onclick = async () => {
      await DB.setSetting('theme', el.dataset.t);
      await applyTheme(el.dataset.t);
      renderSettings();
    });

    $('#exportBtn').onclick = async () => {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `smart-flashcard-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast('Exported');
    };
    $('#importBtn').onclick = () => $('#importFile').click();
    $('#importFile').onchange = async (e) => {
      const file = e.target.files[0];
      if(!file) return;
      const text = await file.text();
      try{
        const data = JSON.parse(text);
        await DB.importAll(data);
        toast('Import complete');
        renderHome();
      }catch(err){ toast('Import failed — invalid file'); }
    };
    $('#resetBtn').onclick = async () => {
      if(!confirm('This deletes ALL cards, decks, and history permanently. Continue?')) return;
      await DB.resetAll();
      toast('Everything reset');
      go('home');
    };
  }

  // ---------------- INIT ----------------
  async function init(){
    runSplash();
    const theme = await DB.getSetting('theme', 'light');
    await applyTheme(theme);
    await Notif.createChannel();

    $$('.nav-btn').forEach(b => b.onclick = () => go(b.dataset.screen));
    $('#themeToggleBtn').onclick = toggleTheme;
    $('#settingsBtn').onclick = () => go('settings');
    $('#quickAddBtn').onclick = quickAddToQA;
    $('#saveCardBtn').onclick = saveCard;
    $('#deckModalClose').onclick = closeDeckModal;
    $('#addDeckBtn').onclick = async () => {
      const name = $('#newDeckName').value.trim();
      if(!name) return;
      await DB.addDeck(name);
      $('#newDeckName').value = '';
      renderDeckManageList(); refreshDeckSelects(); renderCardsScreen();
    };
    $('#deckModalBackdrop').onclick = (e) => { if(e.target === $('#deckModalBackdrop')) closeDeckModal(); };

    if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications){
      window.Capacitor.Plugins.LocalNotifications.addListener('localNotificationActionPerformed', () => go('review'));
    }
    if(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App){
      window.Capacitor.Plugins.App.addListener('appStateChange', ({ isActive }) => {
        if(isActive){ Notif.rescheduleAll(); if(state.screen === 'home') renderHome(); }
      });
    }

    await refreshDeckSelects();
    go('home');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
