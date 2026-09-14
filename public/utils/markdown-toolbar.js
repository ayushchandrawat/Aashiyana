
import { t } from '/i18n.js';
import { esc } from '/utils/html.js';

// Reihenfolge = Anzeige-Reihenfolge; null trennt zwei Gruppen.
const FORMAT_ACTIONS = () => [
  { format: 'bold',          icon: 'bold',          label: t('markdown.bold') },
  { format: 'italic',        icon: 'italic',        label: t('markdown.italic') },
  { format: 'underline',     icon: 'underline',     label: t('markdown.underline') },
  { format: 'strikethrough', icon: 'strikethrough', label: t('markdown.strikethrough') },
  null,
  { format: 'heading',       icon: 'heading',       label: t('markdown.heading') },
  { format: 'list',          icon: 'list',          label: t('markdown.list') },
  { format: 'ordered-list',  icon: 'list-ordered',  label: t('markdown.orderedList') },
  { format: 'checklist',     icon: 'list-checks',   label: t('markdown.checklist') },
  null,
  { format: 'link',          icon: 'link',          label: t('markdown.link') },
  { format: 'code',          icon: 'code',          label: t('markdown.code') },
  { format: 'quote',         icon: 'quote',         label: t('markdown.quote') },
  { format: 'divider',       icon: 'minus',         label: t('markdown.divider') },
];

export function renderMarkdownToolbar() {
  const items = FORMAT_ACTIONS().map((a) => a === null
    ? '<span class="md-toolbar__sep" role="separator" aria-orientation="vertical"></span>'
    : `<button type="button" class="md-toolbar__btn" data-format="${a.format}"
               title="${esc(a.label)}" aria-label="${esc(a.label)}">
         <i data-lucide="${a.icon}" class="icon-md" aria-hidden="true"></i>
       </button>`
  ).join('');

  return `<div class="md-toolbar" role="toolbar" aria-label="${t('markdown.toolbarLabel')}">${items}</div>`;
}

export function wireMarkdownToolbar(root, textarea) {
  root.querySelectorAll('.md-toolbar__btn[data-format]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyFormat(textarea, btn.dataset.format);
      textarea.focus();
    });
  });

  textarea.addEventListener('keydown', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.key === 'b') { e.preventDefault(); applyFormat(textarea, 'bold'); }
    if (e.key === 'i') { e.preventDefault(); applyFormat(textarea, 'italic'); }
    if (e.key === 'u') { e.preventDefault(); applyFormat(textarea, 'underline'); }
  });
}

export function applyFormat(textarea, format) {
  const start = textarea.selectionStart;
  const end   = textarea.selectionEnd;
  const text  = textarea.value;
  const sel   = text.slice(start, end);


  const lineHead = () => text.lastIndexOf('\n', start - 1) + 1;


  const prefixLine = (marker) => {
    const head = lineHead();
    const onEmptyLine = text.slice(head, start).trim() === '';
    textarea.setRangeText(onEmptyLine ? marker : `\n${marker}`, start, start, 'end');
  };

  const prefixSelection = (marker, alreadySet) => {
    const lines = sel.split('\n').map((l, i) => alreadySet(l, i) ? l : `${marker(i)}${l}`);
    textarea.setRangeText(lines.join('\n'), start, end, 'end');
  };

  let before, after, insert;
  switch (format) {
    case 'bold':
      before = '**'; after = '**';
      insert = sel || t('markdown.placeholderText');
      break;
    case 'italic':
      before = '*'; after = '*';
      insert = sel || t('markdown.placeholderText');
      break;
    case 'underline':
      before = '<u>'; after = '</u>';
      insert = sel || t('markdown.placeholderText');
      break;
    case 'strikethrough':
      before = '~~'; after = '~~';
      insert = sel || t('markdown.placeholderText');
      break;
    case 'code':
      before = '`'; after = '`';
      insert = sel || t('markdown.placeholderCode');
      break;
    case 'link': {
      const url = t('markdown.placeholderUrl');
      if (sel) {
        textarea.setRangeText(`[${sel}](${url})`, start, end, 'select');

        textarea.selectionStart = start + sel.length + 3;
        textarea.selectionEnd   = textarea.selectionStart + url.length;
      } else {
        const label = t('markdown.placeholderLinkText');
        textarea.setRangeText(`[${label}](${url})`, start, end, 'select');
        textarea.selectionStart = start + 1;
        textarea.selectionEnd   = start + 1 + label.length;
      }
      return;
    }
    case 'heading': {

      const head    = lineHead();
      const lineEnd = text.indexOf('\n', start);
      const stop    = lineEnd === -1 ? text.length : lineEnd;
      const line    = text.slice(head, stop);
      const match   = line.match(/^(#{1,3})\s/);
      if (match && match[1].length < 3)       textarea.setRangeText('#' + line, head, stop, 'end');
      else if (match)                          textarea.setRangeText(line.replace(/^#{1,3}\s/, ''), head, stop, 'end');
      else                                     textarea.setRangeText('## ' + line, head, stop, 'end');
      return;
    }
    case 'list':
      if (sel) prefixSelection(() => '- ', (l) => l.startsWith('- '));
      else prefixLine('- ');
      return;
    case 'ordered-list':

      // Auswahl bekaeme sonst "1. 3. Text".
      if (sel) {
        const lines = sel.split('\n').map((l, i) => `${i + 1}. ${l.replace(/^\d+\.\s/, '')}`);
        textarea.setRangeText(lines.join('\n'), start, end, 'end');
      } else prefixLine('1. ');
      return;
    case 'checklist':
      if (sel) prefixSelection(() => '- [ ] ', (l) => l.startsWith('- [ ] '));
      else prefixLine('- [ ] ');
      return;
    case 'quote':
      if (sel) prefixSelection(() => '> ', (l) => l.startsWith('> '));
      else prefixLine('> ');
      return;
    case 'divider':
      textarea.setRangeText('\n\n---\n\n', start, end, 'end');
      return;
    default: return;
  }

  textarea.setRangeText(`${before}${insert}${after}`, start, end, 'select');

  textarea.selectionStart = start + before.length;
  textarea.selectionEnd   = start + before.length + insert.length;
}
