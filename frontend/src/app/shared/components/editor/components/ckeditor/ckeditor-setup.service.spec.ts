import {
  normalizeCKEditorLocale,
  removeUnavailableCKEditorToolbarItems,
} from './ckeditor-setup.service';

describe('CKEditor setup helpers', () => {
  describe('normalizeCKEditorLocale', () => {
    it('uses the lowercase locale names generated for CKEditor translations', () => {
      expect(normalizeCKEditorLocale('zh-CN')).toBe('zh-cn');
      expect(normalizeCKEditorLocale('pt-BR')).toBe('pt-br');
      expect(normalizeCKEditorLocale('en')).toBe('en');
    });
  });

  describe('removeUnavailableCKEditorToolbarItems', () => {
    it('removes unavailable entries and preserves valid toolbar items', () => {
      const bold = { isEnabled: true };
      const source = { isEnabled: false };
      const items = [bold, undefined, null, source];
      const editor = {
        ui: {
          view: {
            toolbar: {
              items: { _items: items },
            },
          },
        },
      };

      removeUnavailableCKEditorToolbarItems(editor);

      expect(items).toEqual([bold, source]);
    });

    it('does nothing when the toolbar has not been initialized', () => {
      expect(() => removeUnavailableCKEditorToolbarItems({})).not.toThrow();
    });
  });
});
