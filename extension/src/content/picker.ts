import { flagForLanguage } from '@shared/langs';
import languagesData from '../../../languages.json';
import type { StartTranslateResponse, VideoMetaResponse } from '../protocol';
import { engineLabel, escapeAttr, escapeHtml } from '../ui/html';
import type { PickerActions } from './actions';
import { confirmAutoPublish, getSettings, sendMsg } from './api';
import { $req, bindModalChrome, ensureModalRoot, removeModal } from './dom';
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
    <div class="vt-panel vt-picker" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      <div class="vt-panel-head">
        <h2 id="vt-title">Connect channel</h2>
        <button type="button" class="vt-icon-btn" id="vt-x" aria-label="Close">×</button>
      </div>
      <div class="vt-banner vt-banner-err">
        This video belongs to <strong>${escapeHtml(name)}</strong>, connect it.
      </div>
      <div class="vt-meta">${escapeHtml(opts.error ?? '')}</div>
      <div class="vt-footer">
        <button type="button" id="vt-cancel">Cancel</button>
        <button type="button" class="primary" id="vt-connect">Connect</button>
      </div>
    </div>`;

  bindModalChrome({ root, onClose: actions.close });
  $req(root, '#vt-x').addEventListener('click', actions.close);
  $req(root, '#vt-cancel').addEventListener('click', actions.close);
  const connectBtn = $req<HTMLButtonElement>(root, '#vt-connect');
  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting…';
    const res = await sendMsg<{ ok: boolean; error?: string }>({
      type: 'CONNECT_CHANNEL',
      expectedChannelId: opts.channelId,
    });
    if (!res?.ok) {
      alert(res?.error ?? 'Connect failed');
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect';
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
    <div class="vt-panel vt-picker" role="dialog" aria-modal="true" aria-labelledby="vt-title">
      <div class="vt-panel-head">
        <h2 id="vt-title">Auto Titles &amp; Description</h2>
        <button type="button" class="vt-icon-btn" id="vt-x" aria-label="Close">×</button>
      </div>
      <div class="vt-meta" id="vt-picker-status">Loading video localizations…</div>
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
    const engineShown = engineLabel(settings.engine, settings.geminiModel || undefined);
    panel.innerHTML = `
      <div class="vt-panel-head">
        <div>
          <span class="vt-brand-mark">YT Localizer</span>
          <h2 id="vt-title">Auto Titles &amp; Description</h2>
        </div>
        <button type="button" class="vt-icon-btn" id="vt-x" aria-label="Close">×</button>
      </div>
      <div class="vt-section vt-video-info" id="vt-video-info">
        <div class="vt-section-label vt-section-label-inset">Video</div>
        <div class="vt-video-title">${escapeHtml(meta.title?.slice(0, 90) ?? videoId)}</div>
        <div class="vt-meta vt-meta-tight">
          ${meta.defaultLanguage ? `Default language: ${escapeHtml(meta.defaultLanguage)}` : escapeHtml(videoId)}
        </div>
      </div>
      <div class="vt-banner vt-banner-dry" id="vt-dry-banner" style="display:${dryRun ? 'block' : 'none'}">
        Dry-run ON — preview only; Publish will stay disabled until you turn this off.
      </div>
      <div class="vt-banner vt-banner-live" id="vt-auto-banner" style="display:${
        autoPublish && !dryRun ? 'block' : 'none'
      }">
        Auto-publish ON — translations go live as they finish
      </div>
      <div class="vt-section">
        <div class="vt-section-label">Languages</div>
        <div class="vt-chips" id="vt-presets">
          <button type="button" data-preset="top10" class="vt-chip">Top 10</button>
          <button type="button" data-preset="top20" class="vt-chip">Top 20</button>
          <button type="button" data-preset="top10rpm" class="vt-chip" title="Estimate based on typical RPM markets">Top 10 RPM (estimate)</button>
          <button type="button" data-preset="top20rpm" class="vt-chip" title="Estimate based on typical RPM markets">Top 20 RPM (estimate)</button>
          <button type="button" data-preset="all" class="vt-chip">All</button>
          <button type="button" data-preset="last" class="vt-chip">Last used</button>
        </div>
        <input type="search" id="vt-lang-search" class="vt-search" placeholder="Search languages…" aria-label="Search languages" />
        <div class="vt-lang-grid" id="vt-lang-grid"></div>
      </div>
      <div class="vt-picker-footer">
        <span class="vt-count" id="vt-sel-count"></span>
        <div class="vt-mode-row">
          <label class="vt-radio"><input type="radio" name="vt-skip" value="skip" ${
            skipExisting ? 'checked' : ''
          }/> Skip existing</label>
          <label class="vt-radio"><input type="radio" name="vt-skip" value="overwrite" ${
            !skipExisting ? 'checked' : ''
          }/> Overwrite</label>
        </div>
        <label class="vt-check"><input type="checkbox" id="vt-dry" ${
          dryRun ? 'checked' : ''
        }/> Dry-run</label>
        <label class="vt-check"><input type="checkbox" id="vt-auto" ${
          autoPublish ? 'checked' : ''
        }/> Auto-publish</label>
        <label class="vt-check" title="${escapeAttr(AUTO_APPROVE_HINT)}"><input type="checkbox" id="vt-autoapprove" ${
          autoApprove ? 'checked' : ''
        }/> ${AUTO_APPROVE_LABEL}</label>
      </div>
      <div class="vt-engine-row" id="vt-engine-row">
        <span class="vt-engine-label">Engine</span>
        <span class="vt-engine-value">${escapeHtml(engineShown || settings.engine)}</span>
      </div>
      <div class="vt-footer">
        <button type="button" id="vt-cancel">Cancel</button>
        <button type="button" class="primary" id="vt-go">Translate</button>
      </div>`;

    const grid = $req(panel, '#vt-lang-grid');

    const updateChrome = () => {
      const n = selected.size;
      const existingInSelection = [...selected].filter((c) => existing.has(c)).length;
      $req(panel, '#vt-sel-count').textContent = `${n} selected${
        existingInSelection ? ` · ${existingInSelection} already localized` : ''
      }`;
      const goBtn = $req<HTMLButtonElement>(panel, '#vt-go');
      goBtn.disabled = !n;
      goBtn.textContent = `Translate ${n} language${n === 1 ? '' : 's'}`;
    };

    const fillGrid = () => {
      grid.innerHTML = '';
      for (const lang of data.languages) {
        if (
          searchQ &&
          !lang.name.toLowerCase().includes(searchQ) &&
          !lang.code.toLowerCase().includes(searchQ)
        ) {
          continue;
        }
        grid.append(languageItem(lang, selected.has(lang.code), existing.has(lang.code), (on) => {
          if (on) selected.add(lang.code);
          else selected.delete(lang.code);
          updateChrome();
        }));
      }
    };

    const syncAutoBanner = () => {
      $req(panel, '#vt-auto-banner').style.display = autoPublish && !dryRun ? 'block' : 'none';
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
      $req(panel, '#vt-dry-banner').style.display = dryRun ? 'block' : 'none';
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
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = lang.code;
  cb.checked = checked;
  cb.addEventListener('change', () => onToggle(cb.checked));
  const flag = document.createElement('span');
  flag.className = 'vt-flag';
  flag.textContent = flagForLanguage(lang.code);
  const name = document.createElement('span');
  name.className = 'vt-lang-name';
  name.textContent = `${lang.name} (${lang.code})`;
  label.append(cb, flag, name);
  if (exists) {
    const badge = document.createElement('span');
    badge.className = 'vt-badge';
    badge.textContent = 'exists';
    badge.title = 'Already has a localization on this video';
    label.append(badge);
  }
  return label;
}
