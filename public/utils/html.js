/**
 * Modul: HTML Utilities
 * Zweck: XSS-Schutz fuer innerHTML-basiertes Rendering
 * Abhaengigkeiten: /utils/markdown-checklist.js
 */

import { matchChecklistLine } from './markdown-checklist.js';
import { esc } from './html-escape.js';




// samt Notiz-Renderer. Eine Funktion, zwei Adressen - keine zweite Fassung.
export { esc };

function inlineMarkdown(segment) {
  let out = esc(segment);

  out = out.replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>');

  out = out.replace(/`([^`]+?)`/g, '<code class="note-md-code">$1</code>');

  out = out.replace(/\[([^\]]+?)\]\(([^)\s]+?)\)/g, (whole, label, url) => {
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return whole;
    return `<a class="note-md-link" href="${url}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`;
  });
  // Emphase: fett vor kursiv (verbraucht **), durchgestrichen beliebig
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/~~(.+?)~~/g, '<s>$1</s>');
  out = out.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  return out;
}

function stripInlineMarkdown(segment) {
  return String(segment ?? '')
    .replace(/<\/?u>/g, '')
    .replace(/`([^`]+?)`/g, '$1')
    .replace(/\[([^\]]+?)\]\(([^)\s]+?)\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\*([^*]+?)\*/g, '$1')
    .trim();
}

export function renderMarkdownLight(text, options = {}) {
  if (!text) return '';

  const liveChecklist = options.checklist?.interactive === true;
  const toggleLabel   = options.checklist?.toggleLabel ?? '';

  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let list = null;      // { tag: 'ul' | 'ol', checklist: boolean }
  let para = [];

  const flushPara = () => {
    if (para.length) { html.push(`<p class="note-md-p">${para.join('<br>')}</p>`); para = []; }
  };
  const closeList = () => {
    if (list) { html.push(`</${list.tag}>`); list = null; }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    // Trennlinie
    if (/^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara(); closeList(); html.push('<hr class="note-md-hr">'); continue;
    }

    let m = line.match(/^ {0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (m) {
      flushPara(); closeList();
      html.push(`<div class="note-md-h${m[1].length}">${inlineMarkdown(m[2])}</div>`);
      continue;
    }
    // Zitat
    m = line.match(/^ {0,3}>\s?(.*)$/);
    if (m) {
      flushPara(); closeList();
      html.push(`<blockquote class="note-md-quote">${inlineMarkdown(m[1])}</blockquote>`);
      continue;
    }

    const item = matchChecklistLine(line);
    if (item) {
      flushPara();
      if (!list || list.tag !== 'ul' || !list.checklist) {
        closeList(); html.push('<ul class="note-md-ul note-md-checklist">'); list = { tag: 'ul', checklist: true };
      }




      const box = liveChecklist
        ? `<button type="button" class="note-md-box" role="checkbox" aria-checked="${item.checked}"`
          + ` data-md-line="${index}" data-md-checked="${item.checked ? '1' : '0'}"`
          + ` aria-label="${esc(stripInlineMarkdown(item.text) || toggleLabel)}"></button>`
        : '<span class="note-md-box" aria-hidden="true"></span>';
      html.push(`<li class="note-md-check${item.checked ? ' is-checked' : ''}">${box}<span>${inlineMarkdown(item.text)}</span></li>`);
      continue;
    }
    // Ungeordnete Liste
    m = line.match(/^ {0,3}[-*+]\s+(.*)$/);
    if (m) {
      flushPara();
      if (!list || list.tag !== 'ul' || list.checklist) {
        closeList(); html.push('<ul class="note-md-ul">'); list = { tag: 'ul', checklist: false };
      }
      html.push(`<li>${inlineMarkdown(m[1])}</li>`);
      continue;
    }
    // Geordnete Liste
    m = line.match(/^ {0,3}\d+[.)]\s+(.*)$/);
    if (m) {
      flushPara();
      if (!list || list.tag !== 'ol') {
        closeList(); html.push('<ol class="note-md-ol">'); list = { tag: 'ol' };
      }
      html.push(`<li>${inlineMarkdown(m[1])}</li>`);
      continue;
    }
    // Leerzeile → Absatz-Grenze
    if (line.trim() === '') { flushPara(); closeList(); continue; }

    closeList();
    para.push(inlineMarkdown(line));
  }
  flushPara();
  closeList();
  return html.join('');
}

export function fmtLocation(raw) {
  if (!raw) return '';
  return raw
    .replace(/\\[Nn]/g, '\n')   // \n / \N → newline
    .replace(/\\,/g,  ',')      // \, → ,
    .replace(/\\;/g,  ';')      // \; → ;
    .replace(/\\\\/g, '\\')     // \\ → \
    .replace(/[\n\r;]+/g, ', ') // newlines / semicolons → ", "
    .replace(/\s*,\s*/g, ', ')  // normalize spaces around commas
    .replace(/(?:,\s*){2,}/g, ', ') // collapse double commas
    .replace(/  +/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, ''); // trim leading/trailing commas
}
