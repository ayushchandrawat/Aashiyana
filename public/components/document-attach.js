
import { api } from '/api.js';
import { t, formatDate } from '/i18n.js';
import { esc } from '/utils/html.js';
import { isPreviewable } from '/utils/document-preview.js';
import { maxUploadBytes, maxUploadMb } from '/utils/upload-limit.js';
import { attachOverlay } from '/utils/overlay-history.js';






const ACCEPT = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

const FIELD_CLASS = 'doc-attach';

export function renderDocumentAttachField({
  attachments = [],
  label = t('documentAttach.label'),
  hint = t('documentAttach.hint', { size: maxUploadMb() }),
  icon = 'paperclip',
  maxItems = 0,
} = {}) {


  const initial = attachments
    .filter((a) => a?.document_id)
    .map((a) => ({ id: a.document_id, name: a.name || a.original_name || '', mime: a.mime_type || '' }));

  return `
    <div class="form-group ${FIELD_CLASS}" data-doc-attach
         data-doc-attach-initial="${esc(JSON.stringify(initial))}"
         data-doc-attach-max="${Number(maxItems) || 0}">
      <span class="form-label" id="doc-attach-label">${esc(label)}</span>
      <div class="doc-attach__chips" data-doc-attach-chips role="list"
           aria-labelledby="doc-attach-label"></div>
      <p class="doc-attach__empty" data-doc-attach-empty hidden>
        <i data-lucide="${esc(icon)}" aria-hidden="true"></i>
        <span>${esc(t('documentAttach.emptyState'))}</span>
      </p>
      <div class="doc-attach__actions">
        <button class="btn btn--secondary doc-attach__action" type="button" data-doc-attach-upload>
          <i data-lucide="upload" aria-hidden="true"></i>
          <span>${esc(t('documentAttach.uploadAction'))}</span>
        </button>
        <button class="btn btn--secondary doc-attach__action" type="button" data-doc-attach-pick>
          <i data-lucide="folder-open" aria-hidden="true"></i>
          <span>${esc(t('documentAttach.pickAction'))}</span>
        </button>
      </div>
      <input class="sr-only" type="file" multiple accept="${ACCEPT}" data-doc-attach-input
             aria-labelledby="doc-attach-label">
      <p class="form-hint">${esc(hint)}</p>
    </div>`;
}

export function bindDocumentAttachField(panel, {
  category = 'other',
  folderKey = '',
  folderName = '',
  visibility = 'family',
  allowedMemberIds = null,
  documentName = null,
  maxFileSize = maxUploadBytes(),
} = {}) {
  const field = panel?.querySelector('[data-doc-attach]');
  if (!field) return null;

  const chipsEl = field.querySelector('[data-doc-attach-chips]');
  const emptyEl = field.querySelector('[data-doc-attach-empty]');
  const fileInput = field.querySelector('[data-doc-attach-input]');
  const initialIds = readInitialIds(field);



  const maxItems = Number(field.dataset.docAttachMax) || 0;
  if (maxItems === 1) fileInput.removeAttribute('multiple');



  //   { kind: 'document', id, name }  - existiert bereits serverseitig

  const items = initialIds.map((entry) => ({ kind: 'document', id: entry.id, name: entry.name, mime: entry.mime || '' }));

  const renderChips = () => {
    chipsEl.replaceChildren();
    for (const [index, item] of items.entries()) {





      // utils/document-preview.js.
      const href = `/api/v1/documents/${item.id}/${isPreviewable(item.mime) ? 'preview' : 'download'}`;
      const nameHtml = item.kind === 'file'
        ? `<span class="doc-attach__chip-name">${esc(item.name)}</span>`
        : `<a class="doc-attach__chip-name" href="${href}"
              target="_blank" rel="noopener noreferrer"
              title="${esc(t('documentAttach.openAction', { name: item.name }))}">${esc(item.name)}</a>`;
      chipsEl.insertAdjacentHTML('beforeend', `
        <span class="doc-attach__chip${item.kind === 'file' ? ' doc-attach__chip--pending' : ''}" role="listitem">
          <i data-lucide="${item.kind === 'file' ? 'upload-cloud' : 'file-text'}" aria-hidden="true"></i>
          ${nameHtml}
          <button class="doc-attach__chip-remove" type="button" data-doc-attach-remove="${index}"
                  aria-label="${esc(t('documentAttach.removeAction', { name: item.name }))}">
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
        </span>`);
    }
    emptyEl.hidden = items.length > 0;
    if (window.lucide) window.lucide.createIcons({ el: chipsEl });
  };

  const addItem = (item) => {
    if (maxItems === 1) items.length = 0;
    else if (maxItems && items.length >= maxItems) {
      window.aashiyana?.showToast(t('documentAttach.limitReached', { count: maxItems }), 'danger');
      return false;
    }
    items.push(item);
    return true;
  };

  chipsEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-doc-attach-remove]');
    if (!button) return;
    items.splice(Number(button.dataset.docAttachRemove), 1);
    renderChips();
  });

  field.querySelector('[data-doc-attach-upload]').addEventListener('click', () => fileInput.click());

  const acceptFiles = (files) => {
    for (const file of files || []) {
      if (file.size > maxFileSize) {
        window.aashiyana?.showToast(t('documents.fileTooLarge', { size: maxUploadMb() }), 'danger');
        continue;
      }
      if (!addItem({ kind: 'file', file, name: file.name })) break;
    }
    renderChips();
  };

  fileInput.addEventListener('change', () => {
    acceptFiles(fileInput.files);

    fileInput.value = '';
  });




  // woanders landen, gehen weiterhin ihren eigenen Weg.
  const setDragging = (on) => field.classList.toggle('doc-attach--dragging', on);
  field.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDragging(true);
  });
  field.addEventListener('dragleave', (event) => {


    if (field.contains(event.relatedTarget)) return;
    setDragging(false);
  });
  field.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    setDragging(false);
    acceptFiles(event.dataTransfer.files);
  });

  field.querySelector('[data-doc-attach-pick]').addEventListener('click', async () => {
    const alreadyLinked = new Set(items.filter((i) => i.kind === 'document').map((i) => i.id));
    const picked = await openDocumentPicker(panel, { excludeIds: alreadyLinked, single: maxItems === 1 });
    for (const doc of picked) {
      if (!addItem({ kind: 'document', id: doc.id, name: doc.name, mime: doc.mime_type || '' })) break;
    }
    if (picked.length) renderChips();
  });

  renderChips();

  return {
    documentIds: () => items.filter((i) => i.kind === 'document').map((i) => i.id),

    isDirty: () => items.some((i) => i.kind === 'file'),

    async commit() {
      for (const item of items) {
        if (item.kind !== 'file') continue;


        // Speichern noch umgestellt worden sein.
        const vis = typeof visibility === 'function' ? visibility() : visibility;
        const res = await api.post('/documents', {
          name: documentName ? documentName(item.file) : item.file.name,
          description: '',
          category: typeof category === 'function' ? category() : category,
          visibility: vis,
          status: 'active',
          allowed_member_ids: vis === 'restricted' && allowedMemberIds ? allowedMemberIds() : [],
          original_name: item.file.name,
          content_data: await readFileAsDataUrl(item.file),
          ...(folderKey ? { folder_key: folderKey } : {}),
          ...(folderName ? { folder_name: folderName } : {}),
        });
        item.kind = 'document';
        item.id = res.data?.id;
        item.name = res.data?.name || item.name;
        item.mime = res.data?.mime_type || item.file?.type || '';
        delete item.file;
      }
      return items.filter((i) => i.id).map((i) => i.id);
    },
  };
}

function readInitialIds(field) {
  try {
    return JSON.parse(field.dataset.docAttachInitial || '[]');
  } catch {
    return [];
  }
}

function openDocumentPicker(panel, { excludeIds = new Set(), single = false } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'doc-attach-picker';
    overlay.insertAdjacentHTML('afterbegin', `
      <div class="doc-attach-picker__panel" role="dialog" aria-modal="true"
           aria-label="${esc(t('documentAttach.pickerTitle'))}">
        <div class="doc-attach-picker__header">
          <strong>${esc(t('documentAttach.pickerTitle'))}</strong>
          <button class="btn btn--icon" type="button" data-picker-close
                  aria-label="${esc(t('common.cancel'))}">
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
        </div>
        <input class="form-input doc-attach-picker__search" type="search" data-picker-search
               placeholder="${esc(t('documentAttach.searchPlaceholder'))}"
               aria-label="${esc(t('documentAttach.searchPlaceholder'))}">
        <div class="doc-attach-picker__list" data-picker-list>
          <p class="doc-attach-picker__status">${esc(t('common.loading'))}</p>
        </div>
        <div class="doc-attach-picker__footer">
          <button class="btn btn--secondary" type="button" data-picker-close>${esc(t('common.cancel'))}</button>
          <button class="btn btn--primary" type="button" data-picker-confirm disabled>
            ${esc(t('documentAttach.confirmSelection'))}
          </button>
        </div>
      </div>`);
    panel.append(overlay);
    if (window.lucide) window.lucide.createIcons({ el: overlay });

    const listEl = overlay.querySelector('[data-picker-list]');
    const searchEl = overlay.querySelector('[data-picker-search]');
    const confirmEl = overlay.querySelector('[data-picker-confirm]');


    const opener = document.activeElement;
    const selected = new Set();
    let documents = [];

    const close = (result) => {
      overlay.remove();
      if (opener?.isConnected) opener.focus();
      resolve(result);
    };


    attachOverlay(overlay, () => close(null));

    const renderList = () => {
      const needle = searchEl.value.trim().toLowerCase();
      const visible = documents.filter((doc) => {
        if (excludeIds.has(doc.id)) return false;
        if (!needle) return true;
        return `${doc.name} ${doc.original_name || ''}`.toLowerCase().includes(needle);
      });

      listEl.replaceChildren();
      if (!visible.length) {
        listEl.insertAdjacentHTML('afterbegin',
          `<p class="doc-attach-picker__status">${esc(t('documentAttach.noDocuments'))}</p>`);
        return;
      }
      for (const doc of visible) {
        listEl.insertAdjacentHTML('beforeend', `
          <label class="doc-attach-picker__item">
            <input type="checkbox" value="${doc.id}" ${selected.has(doc.id) ? 'checked' : ''}>
            <span class="doc-attach-picker__item-body">
              <span class="doc-attach-picker__item-name">${esc(doc.name)}</span>
              <span class="doc-attach-picker__item-meta">${esc(pickerMeta(doc))}</span>
            </span>
          </label>`);
      }
    };

    listEl.addEventListener('change', (event) => {
      const box = event.target.closest('input[type="checkbox"]');
      if (!box) return;
      const id = Number(box.value);


      if (single && box.checked) {
        selected.clear();
        for (const other of listEl.querySelectorAll('input[type="checkbox"]')) {
          if (other !== box) other.checked = false;
        }
      }
      if (box.checked) selected.add(id); else selected.delete(id);
      confirmEl.disabled = selected.size === 0;
    });

    searchEl.addEventListener('input', renderList);
    overlay.querySelectorAll('[data-picker-close]').forEach((button) => {
      button.addEventListener('click', () => close([]));
    });
    confirmEl.addEventListener('click', () => {
      close(documents.filter((doc) => selected.has(doc.id)));
    });
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close([]);
    });


    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); close([]); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...overlay.querySelectorAll('button, input')].filter((el) => !el.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });

    searchEl.focus();

    api.get('/documents').then((res) => {
      documents = res.data || [];
      renderList();
    }).catch(() => {
      listEl.replaceChildren();
      listEl.insertAdjacentHTML('afterbegin',
        `<p class="doc-attach-picker__status">${esc(t('documentAttach.loadFailed'))}</p>`);
    });
  });
}

function pickerMeta(doc) {
  return [doc.folder_name, doc.created_at ? formatDate(doc.created_at) : '']
    .filter(Boolean)
    .join(' · ');
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(t('documents.fileReadError')));
    reader.readAsDataURL(file);
  });
}
