/**
 * Booking Validation - テスト
 */

import { run } from './run.js';

describe('Booking Validation Function', () => {
  // 現在時刻をモック
  const realDate = Date;
  const mockNow = new Date('2025-01-15T10:00:00.000Z');

  beforeAll(() => {
    global.Date = class extends realDate {
      constructor(...args) {
        if (args.length === 0) {
          return mockNow;
        }
        return new realDate(...args);
      }
      static now() {
        return mockNow.getTime();
      }
    };
  });

  afterAll(() => {
    global.Date = realDate;
  });

  describe('正常系', () => {
    test('予約情報がない商品はエラーなし', () => {
      const input = {
        cart: {
          lines: [
            {
              id: 'line-1',
              quantity: 1,
              merchandise: {
                id: 'variant-1',
                product: { id: 'product-1', title: 'カット' }
              },
              attribute: null
            }
          ]
        }
      };

      const result = run(input);
      expect(result.errors).toHaveLength(0);
    });

    test('有効な未来の予約日時はエラーなし', () => {
      const input = {
        cart: {
          lines: [
            {
              id: 'line-1',
              quantity: 1,
              merchandise: {
                id: 'variant-1',
                product: { id: 'product-1', title: 'カット' }
              },
              attribute: {
                key: '_BookingStart',
                value: '2025-01-15T14:00:00.000Z' // 4時間後
              }
            }
          ]
        }
      };

      const result = run(input);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('異常系', () => {
    test('過去の予約日時はエラー', () => {
      const input = {
        cart: {
          lines: [
            {
              id: 'line-1',
              quantity: 1,
              merchandise: {
                id: 'variant-1',
                product: { id: 'product-1', title: 'カット' }
              },
              attribute: {
                key: '_BookingStart',
                value: '2025-01-15T08:00:00.000Z' // 2時間前
              }
            }
          ]
        }
      };

      const result = run(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].localizedMessage).toContain('過去');
    });

    test('1時間以内の予約はエラー', () => {
      const input = {
        cart: {
          lines: [
            {
              id: 'line-1',
              quantity: 1,
              merchandise: {
                id: 'variant-1',
                product: { id: 'product-1', title: 'カット' }
              },
              attribute: {
                key: '_BookingStart',
                value: '2025-01-15T10:30:00.000Z' // 30分後
              }
            }
          ]
        }
      };

      const result = run(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].localizedMessage).toContain('1時間以上先');
    });

    test('90日以上先の予約はエラー', () => {
      const input = {
        cart: {
          lines: [
            {
              id: 'line-1',
              quantity: 1,
              merchandise: {
                id: 'variant-1',
                product: { id: 'product-1', title: 'カット' }
              },
              attribute: {
                key: '_BookingStart',
                value: '2025-06-01T10:00:00.000Z' // 約4.5ヶ月後
              }
            }
          ]
        }
      };

      const result = run(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].localizedMessage).toContain('90日以内');
    });

    test('不正な日時形式はエラー', () => {
      const input = {
        cart: {
          lines: [
            {
              id: 'line-1',
              quantity: 1,
              merchandise: {
                id: 'variant-1',
                product: { id: 'product-1', title: 'カット' }
              },
              attribute: {
                key: '_BookingStart',
                value: 'invalid-date'
              }
            }
          ]
        }
      };

      const result = run(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].localizedMessage).toContain('形式');
    });
  });

  describe('エッジケース', () => {
    test('カートが空の場合はエラーなし', () => {
      const input = {
        cart: {
          lines: []
        }
      };

      const result = run(input);
      expect(result.errors).toHaveLength(0);
    });

    test('カートがnullの場合はエラーなし', () => {
      const input = {
        cart: null
      };

      const result = run(input);
      expect(result.errors).toHaveLength(0);
    });

    test('複数商品で1つがエラーの場合', () => {
      const input = {
        cart: {
          lines: [
            {
              id: 'line-1',
              quantity: 1,
              merchandise: {
                id: 'variant-1',
                product: { id: 'product-1', title: 'カット' }
              },
              attribute: {
                key: '_BookingStart',
                value: '2025-01-15T14:00:00.000Z' // 有効
              }
            },
            {
              id: 'line-2',
              quantity: 1,
              merchandise: {
                id: 'variant-2',
                product: { id: 'product-2', title: 'カラー' }
              },
              attribute: {
                key: '_BookingStart',
                value: '2025-01-15T08:00:00.000Z' // 過去
              }
            }
          ]
        }
      };

      const result = run(input);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].localizedMessage).toContain('カラー');
    });
  });
});

