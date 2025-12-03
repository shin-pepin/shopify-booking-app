/**
 * Booking Widget - 予約カレンダー
 */
(function(){
  'use strict';
  class BookingWidget {
    constructor(el) {
      this.el = el;
      this.proxy = el.dataset.proxyBase || '/apps/booking';
      this.interval = parseInt(el.dataset.slotInterval, 10) || 30;
      this.state = {
        locations: [], resources: [], slots: [],
        locId: '', locName: '', resId: '', resName: '',
        date: null, slot: null, month: new Date()
      };
      this.$ = s => el.querySelector(s);
      this.init();
    }
    async init() {
      this.show('[data-loading]', true);
      try {
        await this.fetchLocations();
        this.bind();
        this.show('[data-loading]', false);
        this.show('[data-content]', true);
      } catch (e) { this.error(e.message); }
    }
    bind() {
      this.$('[data-location-select]')?.addEventListener('change', e => {
        const loc = this.state.locations.find(l => l.id === e.target.value);
        this.state.locId = e.target.value;
        this.state.locName = loc?.name || '';
        this.onLocSelect();
      });
      this.$('[data-prev-month]')?.addEventListener('click', () => this.navMonth(-1));
      this.$('[data-next-month]')?.addEventListener('click', () => this.navMonth(1));
      this.$('[data-reset]')?.addEventListener('click', () => this.reset());
    }
    async fetchLocations() {
      const r = await fetch(`${this.proxy}/locations`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      this.state.locations = d.locations;
      this.renderLocs();
    }
    async fetchResources() {
      const r = await fetch(`${this.proxy}/resources?locationId=${this.state.locId}`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      this.state.resources = d.resources;
      this.renderRes();
    }
    async fetchSlots(date) {
      const ds = this.fmtDate(date);
      const r = await fetch(`${this.proxy}/availability?date=${ds}&locationId=${this.state.locId}&resourceId=${this.state.resId}&interval=${this.interval}`);
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      this.state.slots = d.slots;
      this.renderSlots();
    }
    async onLocSelect() {
      if (!this.state.locId) { this.hideAll(); return; }
      this.show('[data-loading]', true);
      try {
        await this.fetchResources();
        this.show('[data-section="resource"]', true);
        this.show('[data-loading]', false);
      } catch (e) { this.error(e.message); }
    }
    onResSelect(res) {
      this.state.resId = res.id;
      this.state.resName = res.name;
      this.renderRes();
      this.show('[data-section="calendar"]', true);
      this.renderCal();
    }
    async onDateSelect(date) {
      this.state.date = date;
      this.$('[data-selected-date-display]').textContent = this.fmtDispDate(date);
      this.show('[data-loading]', true);
      try {
        await this.fetchSlots(date);
        this.show('[data-section="slots"]', true);
        this.renderCal();
        this.show('[data-loading]', false);
      } catch (e) { this.error(e.message); }
    }
    onSlotSelect(slot) {
      this.state.slot = slot;
      this.$('[data-booking-start]').value = slot.startTimeUTC;
      this.$('[data-booking-end]').value = slot.endTimeUTC;
      this.$('[data-resource-id]').value = this.state.resId;
      this.$('[data-resource-name]').value = this.state.resName;
      this.$('[data-location-id]').value = this.state.locId;
      this.$('[data-location-name]').value = this.state.locName;
      const dt = `${this.fmtDispDate(this.state.date)} ${slot.startTime}〜${slot.endTime}`;
      this.$('[data-display-datetime]').value = dt;
      this.$('[data-summary-location]').textContent = this.state.locName;
      this.$('[data-summary-resource]').textContent = this.state.resName;
      this.$('[data-summary-datetime]').textContent = dt;
      this.show('[data-summary]', true);
      this.renderSlots();
      this.el.dispatchEvent(new CustomEvent('booking:selected', { bubbles: true, detail: { ...slot, locId: this.state.locId, resId: this.state.resId } }));
    }
    renderLocs() {
      const sel = this.$('[data-location-select]');
      sel.innerHTML = '<option value="">店舗を選択</option>';
      this.state.locations.forEach(l => {
        const o = document.createElement('option');
        o.value = l.id;
        o.textContent = l.name + (l.city ? ` (${l.city})` : '');
        sel.appendChild(o);
      });
    }
    renderRes() {
      const list = this.$('[data-resource-list]');
      list.innerHTML = '';
      if (!this.state.resources.length) { list.innerHTML = '<p class="bw-empty">選択可能な担当者がいません</p>'; return; }
      this.state.resources.forEach(r => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bw-res' + (r.id === this.state.resId ? ' bw-res--sel' : '');
        btn.innerHTML = `<span class="bw-res-name">${this.esc(r.name)}</span><span class="bw-res-type">${{STAFF:'スタッフ',ROOM:'部屋',EQUIPMENT:'機材'}[r.type]||r.type}</span>`;
        btn.onclick = () => this.onResSelect(r);
        list.appendChild(btn);
      });
    }
    renderCal() {
      const c = this.$('[data-calendar-days]');
      const m = this.state.month;
      this.$('[data-month-year]').textContent = `${m.getFullYear()}年${m.getMonth()+1}月`;
      const y = m.getFullYear(), mo = m.getMonth();
      const first = new Date(y, mo, 1), last = new Date(y, mo + 1, 0);
      const off = first.getDay(), days = last.getDate();
      const today = new Date(); today.setHours(0,0,0,0);
      c.innerHTML = '';
      for (let i = 0; i < off; i++) c.appendChild(this.dayEl('', true));
      for (let d = 1; d <= days; d++) {
        const date = new Date(y, mo, d);
        const past = date < today;
        const sel = this.state.date && this.fmtDate(date) === this.fmtDate(this.state.date);
        const isToday = this.fmtDate(date) === this.fmtDate(today);
        const el = this.dayEl(d, past, sel, isToday);
        if (!past) el.onclick = () => this.onDateSelect(date);
        c.appendChild(el);
      }
    }
    dayEl(d, dis, sel, tod) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'bw-day' + (dis ? ' bw-day--dis' : '') + (sel ? ' bw-day--sel' : '') + (tod ? ' bw-day--today' : '');
      el.textContent = d;
      el.disabled = dis;
      return el;
    }
    renderSlots() {
      const c = this.$('[data-slot-list]');
      c.innerHTML = '';
      if (!this.state.slots.length) { c.innerHTML = '<p class="bw-empty">この日は空きがありません</p>'; return; }
      this.state.slots.forEach(s => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bw-slot' + (this.state.slot?.startTimeUTC === s.startTimeUTC ? ' bw-slot--sel' : '');
        btn.innerHTML = `<span>${s.startTime}</span><span>〜</span><span>${s.endTime}</span>`;
        btn.onclick = () => this.onSlotSelect(s);
        c.appendChild(btn);
      });
    }
    navMonth(d) { this.state.month = new Date(this.state.month.getFullYear(), this.state.month.getMonth() + d, 1); this.renderCal(); }
    reset() { this.state.date = null; this.state.slot = null; this.state.slots = []; this.show('[data-section="slots"]', false); this.show('[data-summary]', false); this.renderCal(); }
    hideAll() { ['resource','calendar','slots'].forEach(s => this.show(`[data-section="${s}"]`, false)); this.show('[data-summary]', false); }
    show(s, v) { const e = this.$(s); if (e) e.style.display = v ? '' : 'none'; }
    error(m) { const e = this.$('[data-error]'); if (e) { this.$('[data-error-message]').textContent = m; e.style.display = ''; setTimeout(() => e.style.display = 'none', 5000); } this.show('[data-loading]', false); }
    fmtDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
    fmtDispDate(d) { const w = ['日','月','火','水','木','金','土']; return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${w[d.getDay()]})`; }
    esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  }
  function init() { document.querySelectorAll('.booking-widget:not([data-init])').forEach(el => { el.dataset.init = '1'; new BookingWidget(el); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  document.addEventListener('shopify:section:load', init);
})();
