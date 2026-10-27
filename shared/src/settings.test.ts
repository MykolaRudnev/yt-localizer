import { describe, expect, it } from 'vitest';
import { normalizeAppSettings, trimSettingsKeys } from './settings.js';

describe('trimSettingsKeys / normalizeAppSettings', () => {
  it('trims whitespace and newlines from API keys', () => {
    const trimmed = trimSettingsKeys({
      geminiApiKey: '  gem-key\n',
      deeplApiKey: '\tabc:fx\r\n',
      libreTranslateApiKey: ' lt ',
      libreTranslateUrl: ' http://localhost:5000/ ',
      oauthClientId: ' cid ',
      geminiModel: ' gemini-2.5-flash ',
    });
    expect(trimmed.geminiApiKey).toBe('gem-key');
    expect(trimmed.deeplApiKey).toBe('abc:fx');
    expect(trimmed.libreTranslateApiKey).toBe('lt');
    expect(trimmed.libreTranslateUrl).toBe('http://localhost:5000/');
    expect(trimmed.oauthClientId).toBe('cid');
    expect(trimmed.geminiModel).toBe('gemini-2.5-flash');
  });

  it('preserves engine when normalizing a DeepL save payload', () => {
    const saved = normalizeAppSettings({
      engine: 'deepl',
      deeplApiKey: ' my-key:fx\n',
      geminiApiKey: ' unused ',
    });
    expect(saved.engine).toBe('deepl');
    expect(saved.deeplApiKey).toBe('my-key:fx');
    expect(saved.geminiApiKey).toBe('unused');
  });

  it('auto-approve review items defaults OFF; settings saved before v1.2 keep working', () => {
    expect(normalizeAppSettings({}).autoApproveReview).toBe(false);
    expect(normalizeAppSettings({ engine: 'deepl' }).autoApproveReview).toBe(false);
    expect(normalizeAppSettings({ autoApproveReview: true }).autoApproveReview).toBe(true);
  });
});
