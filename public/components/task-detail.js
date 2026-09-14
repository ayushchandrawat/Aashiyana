
import { api } from '/api.js';
import { t, formatDate, formatTime } from '/i18n.js';
import { openDetailView, closeDetailView, visibilityRow, assignedRow } from '/components/detail-view.js';
import { closeModal, promptModal, btnLoading, refocusAfterRender } from '/components/modal.js';
import { recurrenceRow } from '/rrule-ui.js';
import { scheduleUndoableDelete } from '/utils/ux.js';
import { renderMarkdownLight } from '/utils/html.js';
import { splitKeepingLineEndings } from '/utils/markdown-checklist.js';
import { splitMentions, applyMention } from '/utils/mentions.js';
import { refresh as refreshReminders } from '/reminders.js';
import { parseRemindAtAsUtc } from '/utils/reminder-offset.js';
import { isNavModuleReadOnly } from '/permissions.js';
import { zonedDateKey } from '/utils/timezone.js';
import { historyDayLabel } from '/utils/day-label.js';
import {
  FALLBACK_CATEGORY, PRIORITY_LABELS, STATUS_LABELS,
  isArchived, canEditTaskDefinition, catLabel, normalizeTagList,
  docMime, docHref, docIcon, formatDueDate,
} from '/utils/task-fields.js';

// --------------------------------------------------------

// --------------------------------------------------------

export async function toggleSubtaskStatus(id, currentStatus) {
  const next = currentStatus === 'done' ? 'open' : 'done';
  await api.patch(`/tasks/${id}/status`, { status: next });
}

export async function setTaskArchived(id, archived) {
  await api.patch(`/tasks/${id}/archive`, { archived });
}

function taskRowsIn(container, id) {
  if (!container) return [];
  const hits = [...container.querySelectorAll(
    `[data-task-id="${id}"], [data-object-kind="task"][data-object-id="${id}"]`,
  )];
  return hits.filter((el) => !hits.some((other) => other !== el && other.contains(el)));
}

export async function deleteTaskWithUndo(id, { container = null, onChanged = () => {} } = {}) {
  closeModal({ force: true });
  const rows = taskRowsIn(container, id);
  for (const el of rows) el.style.display = 'none';

  scheduleUndoableDelete({
    message: t('tasks.deletedToast'),
    commit: async ({ keepalive }) => {
      await api.delete(`/tasks/${id}`, { keepalive });

      api.delete(`/reminders?entity_type=task&entity_id=${id}`, { keepalive }).catch(() => {});
      if (keepalive) return; // Seite verschwindet — kein UI-Refresh mehr
      refreshReminders();
      await onChanged();
    },
    restore: (err) => {
      for (const el of rows) el.style.display = '';
      if (err) window.aashiyana.showToast(err.message ?? t('common.unknownError'), 'danger');
    },
  });
}

export async function addSubtask(parentId, { onChanged = () => {} } = {}) {
  const title = await promptModal(t('tasks.subtaskPrompt'));
  if (!title) return null;
  try {
    const res = await api.post('/tasks', { title, parent_task_id: parentId });

    // Elternkarte, aber sie muss nichts davon zeigen.
    await onChanged();
    refocusAfterRender();
    return res.data ?? null;
  } catch (err) {
    window.aashiyana.showToast(err.message, 'danger');
    return null;
  }
}

// --------------------------------------------------------
// Bausteine der Leseansicht
// --------------------------------------------------------




const NEXT_STATUS = {
  open:        { status: 'in_progress', labelKey: 'tasks.detailStart',  icon: 'circle-dot' },
  in_progress: { status: 'done',        labelKey: 'tasks.detailFinish', icon: 'check' },
  done:        { status: 'open',        labelKey: 'tasks.detailReopen', icon: 'rotate-ccw' },
};

function priorityNode(priority) {
  if (!priority || priority === 'none') return null;
  const badge = document.createElement('span');
  badge.className = 'priority-badge';
  const dot = document.createElement('span');
  dot.className = `priority-dot priority-dot--${priority}`;
  badge.append(dot, document.createTextNode(PRIORITY_LABELS()[priority] ?? priority));
  return badge;
}

function chipListNode(items, toLabel) {
  if (!items.length) return null;
  const wrap = document.createElement('div');
  wrap.className = 'detail-chips';
  items.forEach((item) => {
    const chip = document.createElement('span');
    chip.className = 'task-tag';
    chip.textContent = toLabel(item);
    wrap.appendChild(chip);
  });
  return wrap;
}

function tagChipsNode(tags) {
  return chipListNode(normalizeTagList(tags), (tag) => tag);
}

function subtaskListNode(task, ctx) {
  const mayAdd = canEditTaskDefinition(task, null, ctx) && !isArchived(task) && !task.parent_task_id;
  if (!task.subtasks?.length && !mayAdd) return null;
  const wrap = document.createElement('div');
  wrap.className = 'detail-subtasks';

  const paint = (row, status, title) => {
    row.className = status === 'done' ? 'detail-subtask detail-subtask--done' : 'detail-subtask';
    row.dataset.status = status;
    row.setAttribute('aria-pressed', String(status === 'done'));
    row.setAttribute('aria-label', t('tasks.subtaskMarkDone', { title }));
    const icon = document.createElement('i');
    icon.dataset.lucide = status === 'done' ? 'check-circle-2' : 'circle';
    icon.className = 'icon-sm';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = title;
    row.replaceChildren(icon, label);
    if (window.lucide) window.lucide.createIcons({ el: row });
  };

  const appendRow = (s) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.dataset.subtaskId = String(s.id);
    paint(row, s.status, s.title);

    row.addEventListener('click', async () => {
      const previous = row.dataset.status;
      row.disabled = true;


      paint(row, previous === 'done' ? 'open' : 'done', s.title);
      try {
        await toggleSubtaskStatus(s.id, previous);


        await ctx.onChanged();
      } catch (err) {
        paint(row, previous, s.title);
        window.aashiyana.showToast(err.message, 'danger');
      } finally {
        row.disabled = false;
      }
    });

    wrap.appendChild(row);
    return row;
  };

  (task.subtasks ?? []).forEach(appendRow);

  if (mayAdd) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'detail-subtask detail-subtask--add';
    const icon = document.createElement('i');
    icon.dataset.lucide = 'plus';
    icon.className = 'icon-sm';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = t('tasks.subtaskAdd');
    add.replaceChildren(icon, label);
    if (window.lucide) window.lucide.createIcons({ el: add });

    add.addEventListener('click', async () => {
      add.disabled = true;
      try {




        const created = await addSubtask(task.id, ctx);
        if (!created) return;
        task.subtasks = [...(task.subtasks ?? []), created];
        wrap.insertBefore(appendRow(created), add);
      } finally {
        add.disabled = false;
      }
    });

    wrap.appendChild(add);
  }
  return wrap;
}

function documentListNode(docs) {
  const list = Array.isArray(docs) ? docs : [];
  if (!list.length) return null;

  const images = list.filter((doc) => docMime(doc).startsWith('image/'));
  const rest = list.filter((doc) => !docMime(doc).startsWith('image/'));

  const wrap = document.createElement('div');
  wrap.className = 'task-detail__docs';

  if (images.length) {
    const grid = document.createElement('div');
    grid.className = 'task-detail__doc-previews';
    for (const doc of images) {
      const link = document.createElement('a');
      link.className = 'task-detail__doc-preview';
      link.href = docHref(doc);
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = doc.name || '';
      const img = document.createElement('img');
      img.src = `/api/v1/documents/${doc.id}/preview`;
      img.alt = doc.name || '';
      img.loading = 'lazy';
      link.appendChild(img);
      grid.appendChild(link);
    }
    wrap.appendChild(grid);
  }

  for (const doc of rest) {
    const chip = document.createElement('a');
    chip.className = 'task-doc-chip';
    chip.href = docHref(doc);
    chip.target = '_blank';
    chip.rel = 'noopener';
    const icon = document.createElement('i');
    icon.dataset.lucide = docIcon(doc);
    icon.className = 'task-doc-chip__icon icon-sm';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'task-doc-chip__name';
    label.textContent = doc.name || doc.original_name || String(doc.id);
    chip.append(icon, label);
    wrap.appendChild(chip);
  }

  if (window.lucide) window.lucide.createIcons({ el: wrap });
  return wrap;
}

// --------------------------------------------------------
// Kommentare an einer Aufgabe (#734)
//



// ganzen Ansicht.
// --------------------------------------------------------

function commentTextNode(text, ctx) {
  const box = document.createElement('div');
  box.className = 'task-comment__text';
  for (const segment of splitMentions(text, ctx.users)) {
    if (segment.type !== 'mention') {
      box.appendChild(document.createTextNode(segment.text));
      continue;
    }
    const chip = document.createElement('span');


    chip.className = segment.user.id === ctx.currentUserId
      ? 'task-comment__mention task-comment__mention--me'
      : 'task-comment__mention';
    chip.textContent = segment.text;
    box.appendChild(chip);
  }
  return box;
}

function commentRowNode(comment, { onChanged, ctx }) {
  const row = document.createElement('article');
  row.className = 'task-comment';

  const head = document.createElement('div');
  head.className = 'task-comment__head';

  const author = document.createElement('span');
  author.className = 'task-comment__author';
  author.textContent = comment.author_name || t('tasks.commentUnknownAuthor');

  const when = document.createElement('span');
  when.className = 'task-comment__when';
  const at = new Date(comment.updated_at || comment.created_at);
  when.textContent = comment.updated_at
    ? t('tasks.commentEditedAt', { date: formatDate(at), time: formatTime(at) })
    : `${formatDate(at)} ${formatTime(at)}`;

  head.append(author, when);

  const mine = comment.user_id === ctx.currentUserId;
  if ((mine || ctx.isAdmin) && !isNavModuleReadOnly('tasks')) {
    const actions = document.createElement('div');
    actions.className = 'task-comment__actions';


    if (mine) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'task-comment__action';
      edit.setAttribute('aria-label', t('tasks.commentEdit'));
      edit.title = t('tasks.commentEdit');
      const editIcon = document.createElement('i');
      editIcon.dataset.lucide = 'pencil';
      editIcon.className = 'icon-sm';
      editIcon.setAttribute('aria-hidden', 'true');
      edit.appendChild(editIcon);
      edit.addEventListener('click', () => startCommentEdit(row, comment, { onChanged, ctx }));
      actions.appendChild(edit);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'task-comment__action task-comment__action--danger';
    del.setAttribute('aria-label', t('tasks.commentDelete'));
    del.title = t('tasks.commentDelete');
    const delIcon = document.createElement('i');
    delIcon.dataset.lucide = 'trash-2';
    delIcon.className = 'icon-sm';
    delIcon.setAttribute('aria-hidden', 'true');
    del.appendChild(delIcon);






    // als Vorher-Fragen.
    del.addEventListener('click', () => {
      row.hidden = true;
      scheduleUndoableDelete({
        message: t('tasks.commentDeletedToast'),
        commit: async ({ keepalive }) => {
          await api.delete(`/tasks/${comment.task_id}/comments/${comment.id}`, { keepalive });
          if (keepalive) return; // Seite verschwindet - kein Nachladen mehr
          await onChanged();
        },
        restore: (err) => {
          row.hidden = false;
          if (err) window.aashiyana.showToast(err.message ?? t('common.errorGeneric'), 'danger');
        },
      });
    });
    actions.appendChild(del);
    head.appendChild(actions);
  }

  row.append(head, commentTextNode(comment.comment, ctx));
  return row;
}

function startCommentEdit(row, comment, { onChanged, ctx }) {
  const form = document.createElement('form');
  form.className = 'task-comment__edit';

  const field = document.createElement('textarea');
  field.className = 'input task-comment__input';
  field.rows = 3;
  field.maxLength = 5000;
  field.value = comment.comment;

  const actions = document.createElement('div');
  actions.className = 'task-comment__edit-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn--ghost btn--sm';
  cancel.textContent = t('common.cancel');
  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'btn btn--primary btn--sm';
  save.textContent = t('common.save');
  actions.append(cancel, save);

  cancel.addEventListener('click', () => {



    const restored = commentRowNode(comment, { onChanged, ctx });
    row.replaceWith(restored);
    if (window.lucide) window.lucide.createIcons({ el: restored });
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = field.value.trim();
    if (!value) return;
    save.disabled = true;
    try {
      await api.patch(`/tasks/${comment.task_id}/comments/${comment.id}`, { comment: value });
      await onChanged();
    } catch (err) {
      save.disabled = false;
      window.aashiyana.showToast(err.message ?? t('common.errorGeneric'), 'danger');
    }
  });

  form.append(field, actions);
  row.replaceChildren(form);
  wireMentionSuggest(field, ctx);
  field.focus();
}

function wireMentionSuggest(field, ctx) {
  let box = null;
  let matches = [];
  let active = 0;

  const close = () => { box?.remove(); box = null; matches = []; };

  const currentQuery = () => {
    const upto = field.value.slice(0, field.selectionStart);
    const at = upto.lastIndexOf('@');
    if (at === -1) return null;
    if (at > 0 && /[\p{L}\p{N}_]/u.test(upto[at - 1])) return null;
    const typed = upto.slice(at + 1);


    if (/[\n\r]/.test(typed) || typed.length > 40) return null;
    return { at, typed };
  };

  const apply = (user) => {




    const next = applyMention(field.value, field.selectionStart, user.display_name);
    if (!next) { close(); return; }
    field.value = next.text;
    field.setSelectionRange(next.caret, next.caret);
    close();
    field.focus();
  };

  const render = () => {
    if (!box) {
      box = document.createElement('div');
      box.className = 'task-comment__suggest';
      box.setAttribute('role', 'listbox');
      field.parentElement.appendChild(box);
    }
    box.replaceChildren();
    matches.forEach((user, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = index === active
        ? 'task-comment__suggest-item is-active'
        : 'task-comment__suggest-item';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === active));
      option.textContent = user.display_name;


      option.addEventListener('mousedown', (e) => { e.preventDefault(); apply(user); });
      box.appendChild(option);
    });
  };

  /** Vorschlaege zur aktuellen Cursorposition neu bestimmen. */
  const sync = () => {
    const query = currentQuery();
    if (!query) { close(); return; }
    const needle = query.typed.toLowerCase();
    matches = ctx.users
      .filter((u) => u.display_name && u.display_name.toLowerCase().startsWith(needle))
      .slice(0, 6);
    active = 0;
    if (!matches.length) { close(); return; }
    render();
  };

  field.addEventListener('input', sync);






  field.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) sync();
  });
  field.addEventListener('click', sync);

  field.addEventListener('keydown', (e) => {
    if (!box || !matches.length) return;
    if (e.key === 'ArrowDown')      { e.preventDefault(); active = (active + 1) % matches.length; render(); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); active = (active - 1 + matches.length) % matches.length; render(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); apply(matches[active]); }
    else if (e.key === 'Escape')    { e.stopPropagation(); close(); }
  });

  field.addEventListener('blur', () => setTimeout(close, 0));
}

/** Der ganze Abschnitt: Liste, Eingabe, Nachladen. */
function commentsNode(task, ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'task-comments';

  const list = document.createElement('div');
  list.className = 'task-comments__list';
  const status = document.createElement('p');
  status.className = 'task-comments__status';
  status.textContent = t('common.loading');
  list.appendChild(status);

  const load = async () => {
    try {
      const res = await api.get(`/tasks/${task.id}/comments`);
      const comments = res.data ?? [];
      list.replaceChildren();
      if (!comments.length) {
        const empty = document.createElement('p');
        empty.className = 'task-comments__status';
        empty.textContent = t('tasks.commentsEmpty');
        list.appendChild(empty);
      } else {
        for (const comment of comments) list.appendChild(commentRowNode(comment, { onChanged: load, ctx }));
      }
      if (window.lucide) window.lucide.createIcons({ el: list });
    } catch {
      list.replaceChildren();
      const failed = document.createElement('p');
      failed.className = 'task-comments__status';
      failed.textContent = t('tasks.commentsLoadError');
      list.appendChild(failed);
    }
  };





  if (isNavModuleReadOnly('tasks')) {
    wrap.append(list);
    load();
    return wrap;
  }

  const form = document.createElement('form');
  form.className = 'task-comments__form';
  const field = document.createElement('textarea');
  field.className = 'input task-comment__input';
  field.rows = 2;
  field.maxLength = 5000;
  field.placeholder = t('tasks.commentPlaceholder');
  field.setAttribute('aria-label', t('tasks.commentsLabel'));
  const submit = document.createElement('button');
  submit.type = 'submit';



  submit.className = 'btn btn--secondary btn--sm task-comments__submit';
  submit.textContent = t('tasks.commentSubmit');
  const fieldBox = document.createElement('div');

  fieldBox.className = 'task-comments__field';
  fieldBox.appendChild(field);
  form.append(fieldBox, submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = field.value.trim();
    if (!value) return;
    submit.disabled = true;
    try {
      await api.post(`/tasks/${task.id}/comments`, { comment: value });
      field.value = '';
      await load();
    } catch (err) {
      window.aashiyana.showToast(err.message ?? t('common.errorGeneric'), 'danger');
    } finally {
      submit.disabled = false;
    }
  });

  wireMentionSuggest(field, ctx);
  wrap.append(list, form);
  load();
  return wrap;
}

function taskReminderSummary(reminders) {
  const list = Array.isArray(reminders) ? reminders : (reminders ? [reminders] : []);
  return list
    .map((r) => {
      if (!r?.remind_at) return '';
      const at = parseRemindAtAsUtc(r.remind_at);
      return `${formatDate(at)} ${formatTime(at)}`.trim();
    })
    .filter(Boolean)
    .join(', ');
}

function renderTaskDetail(task, reminders = [], ctx) {
  const due = formatDueDate(task.due_date, task.due_time, task.status === 'done' || isArchived(task));

  return [
    { icon: 'circle-dot', label: t('tasks.statusLabel'), value: STATUS_LABELS()[task.status] ?? task.status },


    { icon: 'archive', label: t('tasks.archivedLabel'), value: isArchived(task) ? formatDate(task.archived_at) : '' },
    { icon: 'flag', label: t('tasks.priorityLabel'), node: priorityNode(task.priority) },


    { icon: 'lock', label: t('tasks.lockedLabel'), value: task.locked ? t('tasks.lockedDetail') : '' },
    { icon: 'clock', label: t('tasks.dueDateLabel'), value: due?.label ?? '' },
    { icon: 'calendar-clock', label: t('tasks.startDateLabel'), value: task.start_date ? formatDate(task.start_date) : '' },
    recurrenceRow(task.recurrence_rule, { fromCompletion: !!task.recurrence_from_completion }),
    { icon: 'folder', label: t('tasks.categoryLabel'), value: task.category && task.category !== FALLBACK_CATEGORY ? catLabel(task.category, ctx.categories) : '' },
    assignedRow(task.assigned_users, t('tasks.assignedLabel')),
    { icon: 'award', label: t('tasks.pointsLabel'), value: task.points ? String(task.points) : '' },
    { icon: 'tag', label: t('tasks.tagsLabel'), node: tagChipsNode(task.tags) },
    { icon: 'list-checks', label: t('tasks.subtasksLabel'), node: subtaskListNode(task, ctx) },
    { icon: 'paperclip', label: t('tasks.documentsLabel'), node: documentListNode(task.documents) },
    { icon: 'bell', label: t('reminders.sectionTitle'), value: taskReminderSummary(reminders) },
    visibilityRow(task.visibility),


    //






    { icon: 'hourglass', label: t('dashboard.countdownTitle'), value: task.countdown && task.due_date ? t('tasks.countdownDetail') : '' },
    { icon: 'align-left', label: t('tasks.descriptionLabel'), node: descriptionNode(task), multiline: true },



    // wiederholte nur, was zwei Zeilen weiter oben steht.
    task.is_recurring
      ? { icon: 'history', label: t('tasks.historySeriesTitle'), node: seriesHistoryNode(task), multiline: true }
      : null,


    { icon: 'message-square', label: t('tasks.commentsLabel'), node: commentsNode(task, ctx), multiline: true },
  ];
}

function descriptionNode(task) {
  const text = (task.description ?? '').trim();
  if (!text) return null;
  const box = document.createElement('div');
  box.className = 'task-detail__note';




  box.insertAdjacentHTML('beforeend', renderMarkdownLight(text, {
    checklist: { interactive: true, toggleLabel: t('tasks.checklistToggle') },
  }));
  box.addEventListener('click', (e) => {
    const hit = e.target.closest('.note-md-box[data-md-line]');
    if (hit) toggleDescriptionCheck(task, hit);
  });
  return box;
}

async function toggleDescriptionCheck(task, box) {
  const line    = parseInt(box.dataset.mdLine, 10);
  const checked = box.dataset.mdChecked !== '1';
  const expect  = splitKeepingLineEndings(task.description)[line * 2];




  if (expect === undefined) {
    window.aashiyana?.showToast(t('tasks.checkConflict'), 'danger');
    return;
  }

  const paint = (on) => {
    box.setAttribute('aria-checked', String(on));
    box.dataset.mdChecked = on ? '1' : '0';
    box.closest('.note-md-check')?.classList.toggle('is-checked', on);
  };

  paint(checked);
  try {
    const res = await api.patch(`/tasks/${task.id}/check`, { line, checked, expect });
    task.description = res.data.description;
  } catch (err) {
    paint(!checked);
    window.aashiyana?.showToast(
      err.status === 409 ? t('tasks.checkConflict') : (err.data?.error ?? t('common.unknownError')),
      'danger',
    );
  }
}

export function openTaskDetail({
  task,
  reminder = null,
  users = [],
  currentUserId = null,
  isAdmin = false,
  categories = [],
  container = null,
  onChanged = () => {},
  edit = null,
}) {
  const ctx = { users, currentUserId, isAdmin, categories, container, onChanged };
  const archived = isArchived(task);
  const next = archived ? null : NEXT_STATUS[task.status];
  // Gesperrte Aufgabe (#830): der Weiterschalt-Knopf bleibt, Loeschen, Ablegen


  const canEdit = canEditTaskDefinition(task, null, ctx);

  const actions = canEdit ? [{
    id: 'task-detail-delete',
    label: t('common.delete'),
    variant: 'danger-ghost',
    icon: 'trash-2',
    align: 'start',


    // Overlay-Slot frei ist.
    onClick: async ({ close }) => {
      await close({ force: true });
      deleteTaskWithUndo(String(task.id), ctx);
    },
  }] : [];



  if (next) {
    actions.push({
      id: 'task-detail-advance',
      label: t(next.labelKey),
      variant: 'secondary',
      icon: next.icon,
      onClick: ({ button }) => advanceTaskStatus(task, next.status, button, ctx),
    });
  }


  // die Aufgabe gerade liegt.
  if (canEdit) {
    actions.push({
      id: 'task-detail-archive',
      label: archived ? t('tasks.unarchiveButton') : t('tasks.archiveButton'),
      variant: 'ghost',
      icon: archived ? 'archive-restore' : 'archive',
      onClick: ({ button }) => toggleTaskArchive(task, button, ctx),
    });
  }

  openDetailView({
    title: task.title,
    size: 'lg',
    sections: renderTaskDetail(task, reminder, ctx),
    actions,
    edit: canEdit && edit ? {
      label: t('common.edit'),
      title: t('tasks.editTask'),
      mount: (panel, pane) => edit.mount(panel, pane),
    } : undefined,
  });
}

async function advanceTaskStatus(task, status, button, ctx) {
  const previous = task.status;
  const stop = btnLoading(button);
  try {
    await api.patch(`/tasks/${task.id}/status`, { status });
    task.status = status;


    await closeDetailView({ force: true });
    await ctx.onChanged();
    refocusAfterRender();
  } catch (err) {
    task.status = previous;
    stop();


    window.aashiyana.showToast(err.message ?? t('common.errorGeneric'), 'danger');
  }
}

async function toggleTaskArchive(task, button, ctx) {
  const stop = btnLoading(button);
  const archived = isArchived(task);
  try {
    await setTaskArchived(task.id, !archived);
    task.archived_at = archived ? null : new Date().toISOString();
    await closeDetailView({ force: true });
    window.aashiyana.showToast(archived ? t('tasks.unarchivedToast') : t('tasks.archivedToast'), 'success');
    await ctx.onChanged();
    refocusAfterRender();
  } catch (err) {
    stop();
    window.aashiyana.showToast(err.message ?? t('common.errorGeneric'), 'danger');
  }
}

function seriesHistoryNode(task) {


  const list = document.createElement('div');
  list.className = 'detail-history';
  const placeholder = document.createElement('p');
  placeholder.className = 'detail-history__empty';
  placeholder.textContent = t('common.loading');
  list.appendChild(placeholder);

  api.get(`/tasks/${task.id}/completions?limit=10`).then((res) => {
    const entries = res.data ?? [];
    list.replaceChildren();
    if (!entries.length) {
      const none = document.createElement('p');
      none.className = 'detail-history__empty';
      none.textContent = t('tasks.historySeriesEmpty');
      list.appendChild(none);
      return;
    }
    for (const entry of entries) {
      const row = document.createElement('p');
      row.className = 'detail-history__row';
      const when = document.createElement('span');
      when.className = 'detail-history__when';
      when.textContent = `${historyDayLabel(zonedDateKey(entry.completed_at))}, ${formatTime(entry.completed_at)}`;
      const who = document.createElement('span');
      who.className = 'detail-history__who';
      who.textContent = entry.user_name || t('tasks.historyUnknownMember');
      row.append(when, who);
      list.appendChild(row);
    }
  }).catch(() => {
    list.replaceChildren();
    const failed = document.createElement('p');
    failed.className = 'detail-history__empty';
    failed.textContent = t('tasks.historySeriesLoadError');
    list.appendChild(failed);
  });

  return list;
}
