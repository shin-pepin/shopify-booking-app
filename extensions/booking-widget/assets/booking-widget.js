/**
 * Booking Widget - 予約カレンダーウィジェット
 * 
 * 商品ページに埋め込んで予約日時を選択し、
 * Line Item Propertiesとしてカートに追加する
 */

(function() {
  'use strict';

  // ウィジェットの初期化
  class BookingWidget {
    constructor(container) {
      this.container = container;
      this.blockId = container.dataset.blockId;
      this.proxyBase = container.dataset.proxyBase || '/apps/booking';
      this.slotInterval = parseInt(container.dataset.slotInterval, 10) || 30;
      this.showLocation = container.dataset.showLocation !== 'false';
      this.showResource = container.dataset.showResource !== 'false';
      this.defaultResourceId = container.dataset.defaultResourceId || '';
      this.defaultLocationId = container.dataset.defaultLocationId || '';

      // 状態管理
      this.state = {
        locations: [],
        resources: [],
        selectedLocationId: '',
        selectedLocationName: '',
        selectedResourceId: '',
        selectedResourceName: '',
        selectedDate: null,
        selectedSlot: null,
        currentMonth: new Date(),
        slots: [],
        loading: false,
        error: null,
      };

      // DOM要素のキャッシュ
      this.elements = {
        loading: container.querySelector('[data-loading]'),
        content: container.querySelector('[data-content]'),
        error: container.querySelector('[data-error]'),
        errorMessage: container.querySelector('[data-error-message]'),
        
        // セクション
        locationSection: container.querySelector('[data-section="location"]'),
        resourceSection: container.querySelector('[data-section="resource"]'),
        calendarSection: container.querySelector('[data-section="calendar"]'),
        slotsSection: container.querySelector('[data-section="slots"]'),
        summary: container.querySelector('[data-summary]'),

        // 入力要素
        locationSelect: container.querySelector('[data-location-select]'),
        resourceList: container.querySelector('[data-resource-list]'),
        calendarDays: container.querySelector('[data-calendar-days]'),
        slotList: container.querySelector('[data-slot-list]'),
        monthYear: container.querySelector('[data-month-year]'),
        selectedDateDisplay: container.querySelector('[data-selected-date-display]'),

        // サマリー
        summaryLocation: container.querySelector('[data-summary-location]'),
        summaryResource: container.querySelector('[data-summary-resource]'),
        summaryDatetime: container.querySelector('[data-summary-datetime]'),

        // 隠しフィールド
        bookingStart: container.querySelector('[data-booking-start]'),
        bookingEnd: container.querySelector('[data-booking-end]'),
        resourceId: container.querySelector('[data-resource-id]'),
        resourceName: container.querySelector('[data-resource-name]'),
        locationId: container.querySelector('[data-location-id]'),
        locationName: container.querySelector('[data-location-name]'),
        displayDatetime: container.querySelector('[data-display-datetime]'),

        // ナビゲーション
        prevMonth: container.querySelector('[data-prev-month]'),
        nextMonth: container.querySelector('[data-next-month]'),
        resetBtn: container.querySelector('[data-reset]'),

        // ステップ
        steps: container.querySelectorAll('[data-step]'),
      };

      this.init();
    }

    async init() {
      this.showLoading(true);
      
      try {
        // ロケーション一覧を取得
        await this.fetchLocations();
        
        // イベントリスナーを設定
        this.bindEvents();
        
        // デフォルト値がある場合は自動選択
        if (this.defaultLocationId) {
          this.state.selectedLocationId = this.defaultLocationId;
          const loc = this.state.locations.find(l => l.id === this.defaultLocationId);
          if (loc) {
            this.state.selectedLocationName = loc.name;
            this.elements.locationSelect.value = this.defaultLocationId;
            await this.onLocationSelect();
          }
        }

        // ロケーション選択を非表示にする場合
        if (!this.showLocation && this.state.locations.length === 1) {
          this.state.selectedLocationId = this.state.locations[0].id;
          this.state.selectedLocationName = this.state.locations[0].name;
          this.elements.locationSection.style.display = 'none';
          await this.onLocationSelect();
        }

        this.showLoading(false);
        this.updateSteps(1);
      } catch (error) {
        this.showError('初期化に失敗しました: ' + error.message);
      }
    }

    bindEvents() {
      // ロケーション選択
      this.elements.locationSelect?.addEventListener('change', () => {
        this.state.selectedLocationId = this.elements.locationSelect.value;
        const loc = this.state.locations.find(l => l.id === this.state.selectedLocationId);
        this.state.selectedLocationName = loc?.name || '';
        this.onLocationSelect();
      });

      // 月ナビゲーション
      this.elements.prevMonth?.addEventListener('click', () => this.changeMonth(-1));
      this.elements.nextMonth?.addEventListener('click', () => this.changeMonth(1));

      // リセットボタン
      this.elements.resetBtn?.addEventListener('click', () => this.reset());
    }

    // === API呼び出し ===

    async fetchLocations() {
      const response = await fetch(`${this.proxyBase}/locations`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'ロケーションの取得に失敗しました');
      }

      this.state.locations = data.locations;
      this.renderLocations();
    }

    async fetchResources(locationId) {
      const response = await fetch(`${this.proxyBase}/resources?locationId=${locationId}`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'リソースの取得に失敗しました');
      }

      this.state.resources = data.resources;
      this.renderResources();
    }

    async fetchAvailability(date) {
      const params = new URLSearchParams({
        date: this.formatDate(date),
        locationId: this.state.selectedLocationId,
        resourceId: this.state.selectedResourceId,
        interval: this.slotInterval.toString(),
      });

      const response = await fetch(`${this.proxyBase}/availability?${params}`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || '空き状況の取得に失敗しました');
      }

      this.state.slots = data.slots;
      this.renderSlots();
    }

    // === イベントハンドラー ===

    async onLocationSelect() {
      if (!this.state.selectedLocationId) {
        this.elements.resourceSection.style.display = 'none';
        this.elements.calendarSection.style.display = 'none';
        return;
      }

      this.showLoading(true);
      
      try {
        await this.fetchResources(this.state.selectedLocationId);
        
        // リソース選択を非表示にする場合、または1件のみの場合
        if (!this.showResource && this.state.resources.length === 1) {
          this.state.selectedResourceId = this.state.resources[0].id;
          this.state.selectedResourceName = this.state.resources[0].name;
          this.elements.resourceSection.style.display = 'none';
          this.onResourceSelect();
        } else if (this.defaultResourceId) {
          const res = this.state.resources.find(r => r.id === this.defaultResourceId);
          if (res) {
            this.state.selectedResourceId = this.defaultResourceId;
            this.state.selectedResourceName = res.name;
            this.onResourceSelect();
          } else {
            this.elements.resourceSection.style.display = 'block';
          }
        } else {
          this.elements.resourceSection.style.display = 'block';
        }

        this.updateSteps(2);
        this.showLoading(false);
      } catch (error) {
        this.showError('リソースの取得に失敗しました: ' + error.message);
      }
    }

    onResourceSelect() {
      if (!this.state.selectedResourceId) {
        this.elements.calendarSection.style.display = 'none';
        return;
      }

      this.elements.calendarSection.style.display = 'block';
      this.renderCalendar();
      this.updateSteps(3);
    }

    async onDateSelect(date) {
      this.state.selectedDate = date;
      this.elements.selectedDateDisplay.textContent = this.formatDisplayDate(date);
      
      this.showLoading(true);
      
      try {
        await this.fetchAvailability(date);
        this.elements.slotsSection.style.display = 'block';
        this.renderCalendar(); // 選択状態を更新
        this.showLoading(false);
      } catch (error) {
        this.showError('空き状況の取得に失敗しました: ' + error.message);
      }
    }

    onSlotSelect(slot) {
      this.state.selectedSlot = slot;
      
      // 隠しフィールドに値をセット
      this.elements.bookingStart.value = slot.startTimeUTC;
      this.elements.bookingEnd.value = slot.endTimeUTC;
      this.elements.resourceId.value = this.state.selectedResourceId;
      this.elements.resourceName.value = this.state.selectedResourceName;
      this.elements.locationId.value = this.state.selectedLocationId;
      this.elements.locationName.value = this.state.selectedLocationName;
      
      // 表示用日時
      const displayDatetime = `${this.formatDisplayDate(this.state.selectedDate)} ${slot.startTime}〜${slot.endTime}`;
      this.elements.displayDatetime.value = displayDatetime;

      // サマリー更新
      this.elements.summaryLocation.textContent = this.state.selectedLocationName;
      this.elements.summaryResource.textContent = this.state.selectedResourceName;
      this.elements.summaryDatetime.textContent = displayDatetime;
      this.elements.summary.style.display = 'block';

      // スロット選択状態を更新
      this.renderSlots();

      // カートボタンを有効化（親フォームにイベントを発火）
      this.container.dispatchEvent(new CustomEvent('booking:selected', {
        bubbles: true,
        detail: {
          locationId: this.state.selectedLocationId,
          locationName: this.state.selectedLocationName,
          resourceId: this.state.selectedResourceId,
          resourceName: this.state.selectedResourceName,
          date: this.formatDate(this.state.selectedDate),
          startTime: slot.startTime,
          endTime: slot.endTime,
          startTimeUTC: slot.startTimeUTC,
          endTimeUTC: slot.endTimeUTC,
        }
      }));
    }

    // === レンダリング ===

    renderLocations() {
      const select = this.elements.locationSelect;
      select.innerHTML = '<option value="">店舗を選択してください</option>';
      
      this.state.locations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc.id;
        option.textContent = loc.name;
        if (loc.city) {
          option.textContent += ` (${loc.city})`;
        }
        select.appendChild(option);
      });
    }

    renderResources() {
      const list = this.elements.resourceList;
      list.innerHTML = '';

      if (this.state.resources.length === 0) {
        list.innerHTML = '<p class="booking-widget__empty">選択可能な担当者がいません</p>';
        return;
      }

      this.state.resources.forEach(resource => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'booking-widget__resource-btn';
        if (resource.id === this.state.selectedResourceId) {
          button.classList.add('booking-widget__resource-btn--selected');
        }
        
        button.innerHTML = `
          <span class="booking-widget__resource-name">${this.escapeHtml(resource.name)}</span>
          <span class="booking-widget__resource-type">${this.getTypeLabel(resource.type)}</span>
        `;
        
        button.addEventListener('click', () => {
          this.state.selectedResourceId = resource.id;
          this.state.selectedResourceName = resource.name;
          this.renderResources();
          this.onResourceSelect();
        });

        list.appendChild(button);
      });
    }

    renderCalendar() {
      const container = this.elements.calendarDays;
      const current = this.state.currentMonth;
      
      // 月表示を更新
      this.elements.monthYear.textContent = this.formatMonthYear(current);

      // カレンダーの日付を生成
      const year = current.getFullYear();
      const month = current.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startOffset = firstDay.getDay();
      const daysInMonth = lastDay.getDate();

      container.innerHTML = '';

      // 空白を追加
      for (let i = 0; i < startOffset; i++) {
        const empty = document.createElement('span');
        empty.className = 'booking-widget__day booking-widget__day--empty';
        container.appendChild(empty);
      }

      // 日付を追加
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dayEl = document.createElement('button');
        dayEl.type = 'button';
        dayEl.className = 'booking-widget__day';
        dayEl.textContent = day.toString();

        // 過去の日付は無効化
        if (date < today) {
          dayEl.classList.add('booking-widget__day--disabled');
          dayEl.disabled = true;
        } else {
          // 選択状態
          if (this.state.selectedDate && 
              this.formatDate(date) === this.formatDate(this.state.selectedDate)) {
            dayEl.classList.add('booking-widget__day--selected');
          }

          // 今日
          if (this.formatDate(date) === this.formatDate(today)) {
            dayEl.classList.add('booking-widget__day--today');
          }

          dayEl.addEventListener('click', () => this.onDateSelect(date));
        }

        container.appendChild(dayEl);
      }
    }

    renderSlots() {
      const container = this.elements.slotList;
      container.innerHTML = '';

      if (this.state.slots.length === 0) {
        container.innerHTML = '<p class="booking-widget__empty">この日は空きがありません</p>';
        return;
      }

      this.state.slots.forEach(slot => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'booking-widget__slot';
        
        if (this.state.selectedSlot?.startTimeUTC === slot.startTimeUTC) {
          button.classList.add('booking-widget__slot--selected');
        }

        button.innerHTML = `
          <span class="booking-widget__slot-time">${slot.startTime}</span>
          <span class="booking-widget__slot-divider">〜</span>
          <span class="booking-widget__slot-time">${slot.endTime}</span>
        `;

        button.addEventListener('click', () => this.onSlotSelect(slot));
        container.appendChild(button);
      });
    }

    // === ユーティリティ ===

    changeMonth(delta) {
      const current = this.state.currentMonth;
      this.state.currentMonth = new Date(current.getFullYear(), current.getMonth() + delta, 1);
      this.renderCalendar();
    }

    reset() {
      this.state.selectedDate = null;
      this.state.selectedSlot = null;
      this.state.slots = [];

      // 隠しフィールドをクリア
      this.elements.bookingStart.value = '';
      this.elements.bookingEnd.value = '';
      this.elements.displayDatetime.value = '';

      // UIをリセット
      this.elements.slotsSection.style.display = 'none';
      this.elements.summary.style.display = 'none';
      this.renderCalendar();

      // イベント発火
      this.container.dispatchEvent(new CustomEvent('booking:reset', { bubbles: true }));
    }

    updateSteps(activeStep) {
      this.elements.steps.forEach(step => {
        const stepNum = parseInt(step.dataset.step, 10);
        step.classList.remove('booking-widget__step--active', 'booking-widget__step--completed');
        
        if (stepNum < activeStep) {
          step.classList.add('booking-widget__step--completed');
        } else if (stepNum === activeStep) {
          step.classList.add('booking-widget__step--active');
        }
      });
    }

    showLoading(show) {
      this.state.loading = show;
      this.elements.loading.style.display = show ? 'flex' : 'none';
      this.elements.content.style.display = show ? 'none' : 'block';
    }

    showError(message) {
      this.state.error = message;
      this.elements.errorMessage.textContent = message;
      this.elements.error.style.display = 'block';
      this.elements.loading.style.display = 'none';
      this.elements.content.style.display = 'block';

      // 3秒後に非表示
      setTimeout(() => {
        this.elements.error.style.display = 'none';
      }, 5000);
    }

    formatDate(date) {
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    formatDisplayDate(date) {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
      const weekday = weekdays[date.getDay()];
      return `${year}年${month}月${day}日(${weekday})`;
    }

    formatMonthYear(date) {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      return `${year}年${month}月`;
    }

    getTypeLabel(type) {
      const labels = {
        STAFF: 'スタッフ',
        ROOM: '部屋',
        EQUIPMENT: '機材',
      };
      return labels[type] || type;
    }

    escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  }

  // 初期化
  function initBookingWidgets() {
    const widgets = document.querySelectorAll('.booking-widget');
    widgets.forEach(container => {
      if (!container.dataset.initialized) {
        container.dataset.initialized = 'true';
        new BookingWidget(container);
      }
    });
  }

  // DOM Ready時に初期化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBookingWidgets);
  } else {
    initBookingWidgets();
  }

  // Shopify Section Renderingに対応
  document.addEventListener('shopify:section:load', initBookingWidgets);
  document.addEventListener('shopify:block:select', initBookingWidgets);

})();

