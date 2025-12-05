/**
 * Booking Widget - 予約カレンダー
 */
(function(){
  'use strict';
  class BW {
    constructor(el) {
      this.el = el;
      this.proxy = el.dataset.proxyBase || '/apps/booking';
      this.interval = parseInt(el.dataset.slotInterval, 10) || 30;
      this.s = { locs: [], res: [], slots: [], locId: '', locName: '', resId: '', resName: '', date: null, slot: null, month: new Date() };
      this.$ = s => el.querySelector(s);
      this.init();
    }
    async init() {
      this.show('[data-loading]', true);
      this.show('[data-content]', false);
      try {
        await this.fetchLocs();
        this.bind();
        this.show('[data-loading]', false);
        this.show('[data-content]', true);
      } catch (e) { this.setupErr(e.message); }
    }
    bind() {
      this.$('[data-location-select]')?.addEventListener('change', e => {
        const loc = this.s.locs.find(l => l.id === e.target.value);
        this.s.locId = e.target.value;
        this.s.locName = loc?.name || '';
        this.onLoc();
      });
      this.$('[data-prev-month]')?.addEventListener('click', () => this.navMon(-1));
      this.$('[data-next-month]')?.addEventListener('click', () => this.navMon(1));
      this.$('[data-reset]')?.addEventListener('click', () => this.reset());
    }
    async fetchLocs() {
      const r = await fetch(`${this.proxy}/locations`);
      if (!r.ok) throw new Error(`サーバーエラー (${r.status})`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'データ取得失敗');
      this.s.locs = d.locations || [];
      if (!this.s.locs.length) throw new Error('SETUP');
      this.renderLocs();
    }
    async fetchRes() {
      const r = await fetch(`${this.proxy}/resources?locationId=${this.s.locId}`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      this.s.res = d.resources;
      this.renderRes();
    }
    async fetchSlots(date) {
      const ds = this.fmtD(date);
      const r = await fetch(`${this.proxy}/availability?date=${ds}&locationId=${this.s.locId}&resourceId=${this.s.resId}&interval=${this.interval}`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      this.s.slots = d.slots;
      this.renderSlots();
    }
    async onLoc() {
      if (!this.s.locId) { this.hideAll(); return; }
      this.show('[data-loading]', true);
      try { await this.fetchRes(); this.show('[data-section="resource"]', true); this.show('[data-loading]', false); }
      catch (e) { this.err(e.message); }
    }
    onRes(res) {
      this.s.resId = res.id; this.s.resName = res.name;
      this.renderRes(); this.show('[data-section="calendar"]', true); this.renderCal();
    }
    async onDate(date) {
      this.s.date = date;
      this.$('[data-selected-date-display]').textContent = this.fmtDD(date);
      this.show('[data-loading]', true);
      try { await this.fetchSlots(date); this.show('[data-section="slots"]', true); this.renderCal(); this.show('[data-loading]', false); }
      catch (e) { this.err(e.message); }
    }
    onSlot(slot) {
      this.s.slot = slot;
      this.$('[data-booking-start]').value = slot.startTimeUTC;
      this.$('[data-booking-end]').value = slot.endTimeUTC;
      this.$('[data-resource-id]').value = this.s.resId;
      this.$('[data-resource-name]').value = this.s.resName;
      this.$('[data-location-id]').value = this.s.locId;
      this.$('[data-location-name]').value = this.s.locName;
      const dt = `${this.fmtDD(this.s.date)} ${slot.startTime}〜${slot.endTime}`;
      this.$('[data-display-datetime]').value = dt;
      this.$('[data-summary-location]').textContent = this.s.locName;
      this.$('[data-summary-resource]').textContent = this.s.resName;
      this.$('[data-summary-datetime]').textContent = dt;
      this.show('[data-summary]', true); this.renderSlots();
    }
    renderLocs() {
      const sel = this.$('[data-location-select]');
      sel.innerHTML = '<option value="">店舗を選択</option>';
      this.s.locs.forEach(l => { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name + (l.city ? ` (${l.city})` : ''); sel.appendChild(o); });
    }
    renderRes() {
      const list = this.$('[data-resource-list]'); list.innerHTML = '';
      if (!this.s.res.length) { list.innerHTML = '<p class="bw-empty">担当者がいません</p>'; return; }
      this.s.res.forEach(r => {
        const btn = document.createElement('button'); btn.type = 'button';
        btn.className = 'bw-res' + (r.id === this.s.resId ? ' bw-res--sel' : '');
        btn.innerHTML = `<span class="bw-res-name">${this.esc(r.name)}</span><span class="bw-res-type">${{STAFF:'スタッフ',ROOM:'部屋',EQUIPMENT:'機材'}[r.type]||r.type}</span>`;
        btn.onclick = () => this.onRes(r); list.appendChild(btn);
      });
    }
    renderCal() {
      const c = this.$('[data-calendar-days]'), m = this.s.month;
      this.$('[data-month-year]').textContent = `${m.getFullYear()}年${m.getMonth()+1}月`;
      const y = m.getFullYear(), mo = m.getMonth();
      const first = new Date(y, mo, 1), last = new Date(y, mo + 1, 0);
      const off = first.getDay(), days = last.getDate();
      const today = new Date(); today.setHours(0,0,0,0);
      c.innerHTML = '';
      for (let i = 0; i < off; i++) c.appendChild(this.dayEl('', true));
      for (let d = 1; d <= days; d++) {
        const date = new Date(y, mo, d), past = date < today;
        const sel = this.s.date && this.fmtD(date) === this.fmtD(this.s.date);
        const el = this.dayEl(d, past, sel, this.fmtD(date) === this.fmtD(today));
        if (!past) el.onclick = () => this.onDate(date);
        c.appendChild(el);
      }
    }
    dayEl(d, dis, sel, tod) {
      const el = document.createElement('button'); el.type = 'button';
      el.className = 'bw-day' + (dis ? ' bw-day--dis' : '') + (sel ? ' bw-day--sel' : '') + (tod ? ' bw-day--today' : '');
      el.textContent = d; el.disabled = dis; return el;
    }
    renderSlots() {
      const c = this.$('[data-slot-list]'); c.innerHTML = '';
      if (!this.s.slots.length) { c.innerHTML = '<p class="bw-empty">空きがありません</p>'; return; }
      this.s.slots.forEach(s => {
        const btn = document.createElement('button'); btn.type = 'button';
        btn.className = 'bw-slot' + (this.s.slot?.startTimeUTC === s.startTimeUTC ? ' bw-slot--sel' : '');
        btn.innerHTML = `<span>${s.startTime}</span><span>〜</span><span>${s.endTime}</span>`;
        btn.onclick = () => this.onSlot(s); c.appendChild(btn);
      });
    }
    navMon(d) { this.s.month = new Date(this.s.month.getFullYear(), this.s.month.getMonth() + d, 1); this.renderCal(); }
    reset() { this.s.date = null; this.s.slot = null; this.s.slots = []; this.show('[data-section="slots"]', false); this.show('[data-summary]', false); this.renderCal(); }
    hideAll() { ['resource','calendar','slots'].forEach(s => this.show(`[data-section="${s}"]`, false)); this.show('[data-summary]', false); }
    show(s, v) { const e = this.$(s); if (e) e.style.display = v ? '' : 'none'; }
    setupErr(m) { this.show('[data-loading]', false); this.show('[data-content]', false); const e = this.$('[data-setup-required]'); if (e) { e.style.display = ''; if (m !== 'SETUP') { const t = e.querySelector('[data-setup-message]'); if (t) t.textContent = m; } } }
    err(m) { const e = this.$('[data-error]'); if (e) { this.$('[data-error-message]').textContent = m; e.style.display = ''; setTimeout(() => e.style.display = 'none', 5000); } this.show('[data-loading]', false); }
    fmtD(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    fmtDD(d) { const w = ['日','月','火','水','木','金','土']; return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${w[d.getDay()]})`; }
    esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  }
  function init() { document.querySelectorAll('.booking-widget:not([data-init])').forEach(el => { el.dataset.init = '1'; new BW(el); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('shopify:section:load', init);
})();
