/* ============================================================
   Smart Flashcard — Local database (IndexedDB)
   Starts 100% empty. No sample decks, cards, or stats are ever
   inserted here. The user is the only source of content.
   ============================================================ */
const DB_NAME = 'smart_flashcard_db';
const DB_VERSION = 1;

let _db = null;

function openDB(){
  return new Promise((resolve, reject) => {
    if(_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if(!db.objectStoreNames.contains('decks')){
        const decks = db.createObjectStore('decks', { keyPath:'id', autoIncrement:true });
        decks.createIndex('name', 'name', { unique:false });
      }
      if(!db.objectStoreNames.contains('cards')){
        const cards = db.createObjectStore('cards', { keyPath:'id', autoIncrement:true });
        cards.createIndex('deckId', 'deckId', { unique:false });
        cards.createIndex('nextReview', 'nextReview', { unique:false });
        cards.createIndex('status', 'status', { unique:false });
      }
      if(!db.objectStoreNames.contains('reviewLog')){
        const log = db.createObjectStore('reviewLog', { keyPath:'id', autoIncrement:true });
        log.createIndex('cardId', 'cardId', { unique:false });
        log.createIndex('timestamp', 'timestamp', { unique:false });
      }
      if(!db.objectStoreNames.contains('settings')){
        db.createObjectStore('settings', { keyPath:'key' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeNames, mode = 'readonly'){
  return openDB().then(db => db.transaction(storeNames, mode));
}

function reqToPromise(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  // ---------- Decks ----------
  async addDeck(name){
    const t = await tx(['decks'], 'readwrite');
    const store = t.objectStore('decks');
    const id = await reqToPromise(store.add({ name, createdAt: Date.now() }));
    return id;
  },
  async renameDeck(id, name){
    const t = await tx(['decks'], 'readwrite');
    const store = t.objectStore('decks');
    const deck = await reqToPromise(store.get(id));
    deck.name = name;
    await reqToPromise(store.put(deck));
  },
  async deleteDeck(id){
    const t = await tx(['decks','cards'], 'readwrite');
    const deckStore = t.objectStore('decks');
    const cardStore = t.objectStore('cards');
    const idx = cardStore.index('deckId');
    const cards = await reqToPromise(idx.getAll(id));
    for(const c of cards){ c.deckId = null; await reqToPromise(cardStore.put(c)); }
    await reqToPromise(deckStore.delete(id));
  },
  async getDecks(){
    const t = await tx(['decks']);
    return reqToPromise(t.objectStore('decks').getAll());
  },

  // ---------- Cards ----------
  async addCard(card){
    const t = await tx(['cards'], 'readwrite');
    const now = Date.now();
    const full = Object.assign({
      deckId: null, question:'', answer:'', tags:[], notes:'',
      createdAt: now, lastReview: null, nextReview: now,
      reviews: 0, hardCount:0, mediumCount:0, easyCount:0,
      interval: 0, ease: 2.0, status: 'NEW'
    }, card);
    const id = await reqToPromise(t.objectStore('cards').add(full));
    return id;
  },
  async updateCard(card){
    const t = await tx(['cards'], 'readwrite');
    await reqToPromise(t.objectStore('cards').put(card));
  },
  async deleteCard(id){
    const t = await tx(['cards'], 'readwrite');
    await reqToPromise(t.objectStore('cards').delete(id));
  },
  async getCard(id){
    const t = await tx(['cards']);
    return reqToPromise(t.objectStore('cards').get(id));
  },
  async getAllCards(){
    const t = await tx(['cards']);
    return reqToPromise(t.objectStore('cards').getAll());
  },
  async getDueCards(now = Date.now()){
    const all = await this.getAllCards();
    return all.filter(c => c.nextReview <= now).sort((a,b) => a.nextReview - b.nextReview);
  },

  // ---------- Review log ----------
  async logReview(entry){
    const t = await tx(['reviewLog'], 'readwrite');
    await reqToPromise(t.objectStore('reviewLog').add(Object.assign({ timestamp: Date.now() }, entry)));
  },
  async getAllLogs(){
    const t = await tx(['reviewLog']);
    return reqToPromise(t.objectStore('reviewLog').getAll());
  },

  // ---------- Settings ----------
  async getSetting(key, fallback){
    const t = await tx(['settings']);
    const row = await reqToPromise(t.objectStore('settings').get(key));
    return row ? row.value : fallback;
  },
  async setSetting(key, value){
    const t = await tx(['settings'], 'readwrite');
    await reqToPromise(t.objectStore('settings').put({ key, value }));
  },

  // ---------- Danger zone ----------
  async exportAll(){
    const [decks, cards, logs] = await Promise.all([this.getDecks(), this.getAllCards(), this.getAllLogs()]);
    return { exportedAt: Date.now(), decks, cards, logs, version: DB_VERSION };
  },
  async importAll(data){
    const t = await tx(['decks','cards','reviewLog'], 'readwrite');
    const stores = { decks: t.objectStore('decks'), cards: t.objectStore('cards'), reviewLog: t.objectStore('reviewLog') };
    for(const d of (data.decks||[])) await reqToPromise(stores.decks.put(d));
    for(const c of (data.cards||[])) await reqToPromise(stores.cards.put(c));
    for(const l of (data.logs||[])) await reqToPromise(stores.reviewLog.put(l));
  },
  async resetAll(){
    const t = await tx(['decks','cards','reviewLog','settings'], 'readwrite');
    await reqToPromise(t.objectStore('decks').clear());
    await reqToPromise(t.objectStore('cards').clear());
    await reqToPromise(t.objectStore('reviewLog').clear());
    await reqToPromise(t.objectStore('settings').clear());
  }
};

window.DB = DB;
