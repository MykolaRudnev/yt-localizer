import { flagForLanguage } from '@shared/langs';
import languagesData from '../../../languages.json';
import type { StartTranslateResponse, VideoMetaResponse } from '../protocol';
import { engineLabel, escapeAttr, escapeHtml } from '../ui/html';
import { icon, SPINNER } from '../ui/icons';
import type { PickerActions } from './actions';
import { confirmAutoPublish, getSettings, sendMsg } from './api';
import { $req, bindModalChrome, ensureModalRoot, panelHeadHtml, removeModal } from './dom';
import { AUTO_APPROVE_HINT, AUTO_APPROVE_LABEL } from './labels';

type LangFile = {
  presets: Record<string, { label: string; codes: string[] }>;
  languages: { code: string; name: string }[];
};

const data = languagesData as LangFile;

/** Shown when the video belongs to a channel that is not connected yet. */
export function showConnectChannelModal(
  opts: { channelId?: string; channelTitle?: string; error?: string },
  actions: PickerActions & { reopenPicker(): void },
): void {
  removeModal();
  const root = ensureModalRoot('connect');
  const name = opts.channelTitle || opts.channelId || 'this channel';
  root.innerHTML = `
    <div class="vt-panel vt-panel--sm" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      ${panelHeadHtml({ title: 'Connect channel' })}
      <div class="vt-body">
        <div class="ytl-notice ytl-notice--warning" role="alert">
          ${icon('alert')}
          <div class="ytl-notice__body">
            <span>This video belongs to <strong>${escapeHtml(name)}</strong>. Connect that channel to translate and publish its localizations.</span>
            ${opts.error ? `<span class="ytl-notice__hint">${escapeHtml(opts.error)}</span>` : ''}
          </div>
        </div>
      </div>
      <footer class="vt-footer">
        <div class="vt-footer-summary"></div>
        <div class="vt-footer-actions">
          <button type="button" class="ytl-btn" id="vt-cancel">Cancel</button>
          <button type="button" class="ytl-btn ytl-btn--primary" id="vt-connect">Connect channel</button>
        </div>
      </footer>
    </div>`;

  bindModalChrome({ root, onClose: actions.close });
  $req(root, '#vt-x').addEventListener('click', actions.close);
  $req(root, '#vt-cancel').addEventListener('click', actions.close);
  const connectBtn = $req<HTMLButtonElement>(root, '#vt-connect');
  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.setAttribute('aria-busy', 'true');
    connectBtn.textContent = 'Connecting…';
    const res = await sendMsg<{ ok: boolean; error?: string }>({
      type: 'CONNECT_CHANNEL',
      expectedChannelId: opts.channelId,
    });
    if (!res?.ok) {
      alert(res?.error ?? 'Connect failed');
      connectBtn.disabled = false;
      connectBtn.removeAttribute('aria-busy');
      connectBtn.textContent = 'Connect channel';
      return;
    }
    removeModal();
    actions.reopenPicker();
  });
}

/** Language picker for a fresh translate job on `videoId`. */
export async function openPicker(videoId: string, actions: PickerActions): Promise<void> {
  removeModal();
  const root = ensureModalRoot('picker');
  root.innerHTML = `
    <div class="vt-panel vt-panel--md" role="dialog" aria-modal="true" aria-labelledby="vt-title" aria-busy="true">
      ${panelHeadHtml({ title: 'Auto Titles & Description' })}
      <div class="vt-body">
        <div class="vt-state" id="vt-picker-status" role="status">
          ${SPINNER}
          <span>Loading video localizations…</span>
        </div>
      </div>
    </div>`;

  bindModalChrome({ root, onClose: actions.close });
  root.querySelector('#vt-x')?.addEventListener('click', actions.close);

  try {
    const settings = await getSettings();
    const meta = await sendMsg<VideoMetaResponse>({ type: 'FETCH_VIDEO_META', videoId });

    if (meta?.needsConnect) {
      showConnectChannelModal(
        { channelId: meta.channelId, channelTitle: meta.channelTitle, error: meta.error },
        { ...actions, reopenPicker: () => void openPicker(videoId, actions) },
      );
      return;
    }
    if (!meta?.ok) throw new Error(meta?.error ?? 'Failed to load video');

    const existing = new Set(meta.existingCodes ?? []);
    const langSource = meta.channelSettings?.selectedLanguages?.length
      ? meta.channelSettings.selectedLanguages
      : settings.selectedLanguages;
    const lastUsedSource = meta.channelSettings?.lastUsedLanguages?.length
      ? meta.channelSettings.lastUsedLanguages
      : settings.lastUsedLanguages;
    const selected = new Set(langSource);
    let skipExisting = settings.skipExisting;
    let dryRun = settings.dryRun;
    let autoPublish = meta.channelSettings?.autoPublish === true;
    let autoApprove = settings.autoApproveReview === true;
    let searchQ = '';
    /** Preset chip shown as pressed until the selection is edited by hand. */
    let activePreset: string | null = null;

    const start = async () => {
      const langs = [...selected];
      if (!langs.length) return;
      await sendMsg({
        type: 'PATCH_SETTINGS',
        partial: { skipExisting, dryRun, autoApproveReview: autoApprove },
      });
      if (meta.channelId) {
        await sendMsg({
          type: 'PATCH_CHANNEL_SETTINGS',
          channelId: meta.channelId,
          partial: { selectedLanguages: langs, lastUsedLanguages: langs, autoPublish },
        });
      }
      const res = await sendMsg<StartTranslateResponse>({
        type: 'START_TRANSLATE',
        videoId,
        languages: langs,
        skipExisting,
      });
      if (!res?.ok) {
        alert(`YT Localizer: ${res?.error ?? 'Unknown error'}`);
        return;
      }
      if (res.skippedAll) {
        alert(
          'All selected languages already have localizations (Skip existing is on). Switch to Overwrite to re-translate.',
        );
        return;
      }
      actions.started(res.job ?? null);
    };

    const panel = $req(root, '.vt-panel');
    panel.removeAttribute('aria-busy');
    const engineShown = engineLabel(settings.engine, settings.geminiModel || undefined);
    const videoTitle = meta.title?.slice(0, 90) ?? videoId;
    const subtitle = meta.defaultLanguage
      ? `${videoTitle} · default language ${meta.defaultLanguage}`
      : videoTitle;
    const rpmHint = 'Estimate based on typical RPM markets';
    const preset = (key: string, label: string, hint?: string) =>
      `<button type="button" data-preset="${key}" class="ytl-chip" aria-pressed="false"${
        hint ? ` title="${escapeAttr(hint)}"` : ''
      }>${label}</button>`;
    panel.innerHTML = `
      ${panelHeadHtml({ title: 'Auto Titles & Description', subtitle })}
      <div class="vt-notices">
        <div class="ytl-notice ytl-notice--warning" id="vt-dry-banner" ${dryRun ? '' : 'hidden'}>
          ${icon('alert')}
          <span>Dry-run is on — preview only. Publish stays disabled until you turn it off.</span>
        </div>
        <div class="ytl-notice" id="vt-auto-banner" ${autoPublish && !dryRun ? '' : 'hidden'}>
          ${icon('info')}
          <span>Auto-publish is on — translations go live on YouTube as they finish.</span>
        </div>
      </div>
      <div class="vt-toolbar" role="toolbar" aria-label="Language selection">
        <div class="vt-toolbar-row">
          <label class="ytl-search">
            ${icon('search')}
            <span class="ytl-visually-hidden">Search languages</span>
            <input type="search" id="vt-lang-search" class="ytl-input" placeholder="Search by name or code…" autocomplete="off" />
          </label>
          <span class="ytl-badge ytl-badge--accent" id="vt-sel-badge"></span>
        </div>
        <div class="vt-chips" id="vt-presets" role="group" aria-label="Presets">
          ${preset('top10', 'Top 10')}
          ${preset('top20', 'Top 20')}
          ${preset('top10rpm', 'Top 10 RPM <span class="ytl-chip__hint">est.</span>', rpmHint)}
          ${preset('top20rpm', 'Top 20 RPM <span class="ytl-chip__hint">est.</span>', rpmHint)}
          ${preset('last', 'Last used')}
          ${preset('all', 'All')}
        </div>
      </div>
      <div class="vt-body">
        <div class="vt-lang-grid" id="vt-lang-grid" role="group" aria-label="Languages"></div>
        <div class="vt-state" id="vt-lang-empty" hidden>
          <span class="vt-state-title">No languages match</span>
          <span>Try a language name (e.g. “German”) or a code (e.g. “de”).</span>
        </div>
      </div>
      <div class="vt-run-options">
        <div class="vt-run-options-head">
          <div class="ytl-segmented" role="radiogroup" aria-label="Existing localizations">
            <label class="ytl-segmented__item" title="Leave languages that already have a localization untouched"><input type="radio" class="ytl-visually-hidden" name="vt-skip" value="skip" ${
              skipExisting ? 'checked' : ''
            }/>Skip existing</label>
            <label class="ytl-segmented__item" title="Re-translate and replace existing localizations"><input type="radio" class="ytl-visually-hidden" name="vt-skip" value="overwrite" ${
              !skipExisting ? 'checked' : ''
            }/>Overwrite</label>
          </div>
          <span class="vt-engine" id="vt-engine-row">Engine <span class="ytl-code">${escapeHtml(
            engineShown || settings.engine,
          )}</span></span>
        </div>
        <label class="ytl-toggle">
          <input type="checkbox" role="switch" class="ytl-switch" id="vt-dry" ${dryRun ? 'checked' : ''}/>
          <span class="ytl-toggle__text">Dry-run<span class="ytl-toggle__hint">Preview only, nothing is published</span></span>
        </label>
        <label class="ytl-toggle">
          <input type="checkbox" role="switch" class="ytl-switch" id="vt-auto" ${autoPublish ? 'checked' : ''}/>
          <span class="ytl-toggle__text">Auto-publish<span class="ytl-toggle__hint">Go live in batches as rows finish</span></span>
        </label>
        <label class="ytl-toggle" title="${escapeAttr(AUTO_APPROVE_HINT)}">
          <input type="checkbox" role="switch" class="ytl-switch" id="vt-autoapprove" ${autoApprove ? 'checked' : ''}/>
          <span class="ytl-toggle__text">${AUTO_APPROVE_LABEL}<span class="ytl-toggle__hint">No manual review for titles fitted to 100 chars</span></span>
        </label>
      </div>
      <footer class="vt-footer">
        <div class="vt-footer-summary" id="vt-sel-count" aria-live="polite"></div>
        <div class="vt-footer-actions">
          <button type="button" class="ytl-btn" id="vt-cancel">Cancel</button>
          <button type="button" class="ytl-btn ytl-btn--primary ytl-btn--lg" id="vt-go">Translate</button>
        </div>
      </footer>`;

    const grid = $req(panel, '#vt-lang-grid');

    const updateChrome = () => {
      const n = selected.size;
      const existingInSelection = [...selected].filter((c) => existing.has(c)).length;
      $req(panel, '#vt-sel-count').innerHTML = `<strong>${n}</strong> selected${
        existingInSelection ? ` · ${existingInSelection} already localized` : ''
      }`;
      $req(panel, '#vt-sel-badge').textContent = `${n} selected`;
      panel.querySelectorAll<HTMLElement>('[data-preset]').forEach((chip) => {
        chip.setAttribute('aria-pressed', String(chip.dataset.preset === activePreset));
      });
      const goBtn = $req<HTMLButtonElement>(panel, '#vt-go');
      goBtn.disabled = !n;
      goBtn.textContent = `Translate ${n} language${n === 1 ? '' : 's'}`;
    };

    const fillGrid = () => {
      grid.innerHTML = '';
      let shown = 0;
      for (const lang of data.languages) {
        if (
          searchQ &&
          !lang.name.toLowerCase().includes(searchQ) &&
          !lang.code.toLowerCase().includes(searchQ)
        ) {
          continue;
        }
        shown++;
        grid.append(languageItem(lang, selected.has(lang.code), existing.has(lang.code), (on) => {
          if (on) selected.add(lang.code);
          else selected.delete(lang.code);
          activePreset = null;
          updateChrome();
        }));
      }
      $req(panel, '#vt-lang-empty').hidden = shown > 0;
    };

    const syncAutoBanner = () => {
      $req(panel, '#vt-auto-banner').hidden = !(autoPublish && !dryRun);
    };

    fillGrid();
    updateChrome();

    bindModalChrome({ root, onClose: actions.close, onEnter: () => void start() });
    $req(panel, '#vt-x').addEventListener('click', actions.close);
    $req(panel, '#vt-cancel').addEventListener('click', actions.close);

    $req(panel, '#vt-lang-search').addEventListener('input', (e) => {
      searchQ = (e.target as HTMLInputElement).value.toLowerCase().trim();
      fillGrid();
    });

    panel.querySelectorAll<HTMLElement>('[data-preset]').forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.dataset.preset!;
        activePreset = key;
        selected.clear();
        if (key === 'all') data.languages.forEach((l) => selected.add(l.code));
        else if (key === 'last') {
          (lastUsedSource?.length ? lastUsedSource : langSource).forEach((c) => selected.add(c));
        } else {
          data.presets[key]?.codes.forEach((c) => selected.add(c));
        }
        fillGrid();
        updateChrome();
      });
    });

    panel.querySelectorAll('input[name="vt-skip"]').forEach((el) => {
      el.addEventListener('change', () => {
        skipExisting =
          $req<HTMLInputElement>(panel, 'input[name="vt-skip"]:checked').value === 'skip';
      });
    });

    $req(panel, '#vt-dry').addEventListener('change', async (e) => {
      dryRun = (e.target as HTMLInputElement).checked;
      await sendMsg({ type: 'PATCH_SETTINGS', partial: { dryRun } });
      $req(panel, '#vt-dry-banner').hidden = !dryRun;
      syncAutoBanner();
    });

    $req(panel, '#vt-auto').addEventListener('change', async (e) => {
      const cb = e.target as HTMLInputElement;
      if (cb.checked && !(await confirmAutoPublish())) {
        cb.checked = false;
        return;
      }
      autoPublish = cb.checked;
      if (meta.channelId) {
        await sendMsg({
          type: 'PATCH_CHANNEL_SETTINGS',
          channelId: meta.channelId,
          partial: { autoPublish },
        });
      }
      syncAutoBanner();
    });

    // Global option (same as Options page); snapshotted into the job at start.
    $req(panel, '#vt-autoapprove').addEventListener('change', async (e) => {
      autoApprove = (e.target as HTMLInputElement).checked;
      await sendMsg({ type: 'PATCH_SETTINGS', partial: { autoApproveReview: autoApprove } });
    });

    $req(panel, '#vt-go').addEventListener('click', () => void start());
  } catch (err) {
    actions.close();
    alert(`YT Localizer: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function languageItem(
  lang: { code: string; name: string },
  checked: boolean,
  exists: boolean,
  onToggle: (on: boolean) => void,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'vt-lang-item';
  label.title = `${lang.name} (${lang.code})`;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.className = 'ytl-checkbox';
  cb.value = lang.code;
  cb.checked = checked;
  cb.addEventListener('change', () => onToggle(cb.checked));
  const flag = document.createElement('span');
  flag.className = 'vt-flag';
  flag.setAttribute('aria-hidden', 'true');
  flag.textContent = flagForLanguage(lang.code);
  const name = document.createElement('span');
  name.className = 'vt-lang-name';
  name.textContent = lang.name;
  const code = document.createElement('span');
  code.className = 'vt-lang-code';
  code.textContent = lang.code;
  label.append(cb, flag, name, code);
  if (exists) {
    const badge = document.createElement('span');
    badge.className = 'ytl-badge';
    badge.textContent = 'exists';
    badge.title = 'Already has a localization on this video';
    label.append(badge);
  }
  return label;
}
