
import { t, formatDate, formatDateInput, parseDateInput, isDateInputValid } from '/i18n.js';

const FREQ_OPTIONS = () => [
  { value: '',        label: t('rrule.freqNone') },
  { value: 'DAILY',   label: t('rrule.freqDaily') },
  { value: 'WEEKLY',  label: t('rrule.freqWeekly') },
  { value: 'MONTHLY', label: t('rrule.freqMonthly') },
  { value: 'YEARLY',  label: t('rrule.freqYearly') },
];

const WEEKDAYS = () => [
  { value: 'MO', label: t('rrule.dayMo') },
  { value: 'TU', label: t('rrule.dayTu') },
  { value: 'WE', label: t('rrule.dayWe') },
  { value: 'TH', label: t('rrule.dayTh') },
  { value: 'FR', label: t('rrule.dayFr') },
  { value: 'SA', label: t('rrule.daySa') },
  { value: 'SU', label: t('rrule.daySu') },
];

export function parseRRule(rule) {
  const result = { freq: '', interval: 1, byday: [], until: '', count: null, lastDay: false };
  if (!rule) return result;

  for (const segment of String(rule).replace(/^RRULE:/i, '').split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) continue;
    const key = segment.slice(0, eq).toUpperCase();
    const val = segment.slice(eq + 1);

    if (key === 'FREQ')     result.freq     = val;
    if (key === 'INTERVAL') result.interval  = parseInt(val, 10) || 1;
    if (key === 'BYDAY')    result.byday     = val.split(',').map(d => d.trim());
    if (key === 'UNTIL') {
      // YYYYMMDD → YYYY-MM-DD
      const c = val.replace(/[TZ]/g, '');
      result.until = `${c.slice(0, 4)}-${c.slice(4, 6)}-${c.slice(6, 8)}`;
    }
    if (key === 'COUNT') {
      const n = parseInt(val, 10);
      if (Number.isInteger(n) && n > 0) result.count = n;
    }




    // gesetzt hat.
    if (key === 'BYMONTHDAY' && val.trim() === '-1') result.lastDay = true;
  }
  return result;
}

export function buildRRule({ freq, interval, byday, until, count = null, lastDay = false }) {
  if (!freq) return null;

  const parts = [`FREQ=${freq}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (freq === 'WEEKLY' && byday.length > 0) {
    parts.push(`BYDAY=${byday.join(',')}`);
  }


  if (freq === 'MONTHLY' && lastDay) parts.push('BYMONTHDAY=-1');
  if (count && count > 0) {
    parts.push(`COUNT=${count}`);
  } else if (until) {
    parts.push(`UNTIL=${until.replace(/-/g, '')}T235959Z`);
  }
  return parts.join(';');
}

function canShowConcreteMonthEnd(rule, firstDate) {
  if (!rule) return true;


  // BYDAY-Filter macht aus "Monatsletzter" z.B. "Monatsletzter, falls Montag";


  // alles ausser dem vom Formular selbst schreibbaren Subset bewusst allgemein.
  const allowed = new Set(['FREQ', 'INTERVAL', 'BYMONTHDAY', 'UNTIL', 'COUNT']);
  let until = null;
  for (const segment of String(rule).replace(/^RRULE:/i, '').split(';')) {
    const eq = segment.indexOf('=');
    if (eq === -1) return false;
    const key = segment.slice(0, eq).toUpperCase();
    const value = segment.slice(eq + 1);
    if (!allowed.has(key)) return false;
    if (key === 'UNTIL') {
      const match = /^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/.exec(value);
      if (!match) return false;
      until = `${match[1]}-${match[2]}-${match[3]}`;
    }
  }
  return !until || until >= firstDate;
}

export function monthEndHintText(startDate, { expandsFromStart = false, rule = null } = {}) {
  if (!expandsFromStart) return t('rrule.lastDayOfMonthHintNext');





  // anzeigen.
  const dateKey = parseDateInput(startDate);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return t('rrule.lastDayOfMonthHint');

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year
      || candidate.getUTCMonth() !== month - 1
      || candidate.getUTCDate() !== day) {
    return t('rrule.lastDayOfMonthHint');
  }

  const monthEnd = new Date(Date.UTC(year, month, 0));
  const firstDate = [
    monthEnd.getUTCFullYear(),
    String(monthEnd.getUTCMonth() + 1).padStart(2, '0'),
    String(monthEnd.getUTCDate()).padStart(2, '0'),
  ].join('-');

  if (!canShowConcreteMonthEnd(rule, firstDate)) {
    return t('rrule.lastDayOfMonthHint');
  }

  if (dateKey === firstDate) {
    return t('rrule.lastDayOfMonthHintSame', { date: formatDate(dateKey) });
  }
  return t('rrule.lastDayOfMonthHintOverride', {
    startDate: formatDate(dateKey),
    firstDate: formatDate(firstDate),
  });
}

export function renderRRuleFields(prefix, existingRule, opts = {}) {
  const allowCount = !!opts.allowCount;

  // Sie beantworten verschiedene Fragen: `allowCount` fragt, ob "endet nach N




  const expandsFromStart = !!opts.expandsFromStart;
  const allowFromCompletion = !!opts.allowFromCompletion;
  const fromCompletion = !!opts.fromCompletion;
  const parsed = parseRRule(existingRule);








  const hintRef = parsed.freq ? '' : ` aria-describedby="${prefix}-rrule-hint"`;

  const freqOpts = FREQ_OPTIONS().map(o =>
    `<option value="${o.value}" ${parsed.freq === o.value ? 'selected' : ''}>${o.label}</option>`
  ).join('');

  const dayBtns = WEEKDAYS().map(d =>
    `<button type="button" class="rrule-day ${parsed.byday.includes(d.value) ? 'rrule-day--active' : ''}"
             data-day="${d.value}" aria-label="${d.label}" aria-pressed="${parsed.byday.includes(d.value)}">${d.label}</button>`
  ).join('');




  // "kein Ende" behandelt (Aufgaben-Engine kennt COUNT ohnehin nicht).
  const endType = (allowCount && parsed.count) ? 'count' : (parsed.until ? 'until' : 'never');
  const endOpts = [
    { value: 'never', label: t('rrule.endNever') },
    { value: 'until', label: t('rrule.endOnDate') },
    ...(allowCount ? [{ value: 'count', label: t('rrule.endAfter') }] : []),
  ].map(o => `<option value="${o.value}" ${endType === o.value ? 'selected' : ''}>${o.label}</option>`).join('');






  const sourceRule = existingRule
    ? `<input type="hidden" id="${prefix}-rrule-source" value="${String(existingRule).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}">`
    : '';

  return `
    <div class="rrule-fields" id="${prefix}-rrule-fields">
      ${sourceRule}
      <div class="form-group">
        <label class="label form-label" for="${prefix}-rrule-freq">${t('rrule.labelRepeat')}</label>
        <select class="input form-input" id="${prefix}-rrule-freq"${hintRef}>
          ${freqOpts}
        </select>
        <p class="rrule-hint" id="${prefix}-rrule-hint" ${parsed.freq ? 'hidden' : ''}>${t('rrule.intervalHint')}</p>
      </div>

      <div class="rrule-details" id="${prefix}-rrule-details" ${parsed.freq ? '' : 'hidden'}>
        <div class="rrule-row">
          <div class="form-group" style="margin-bottom:0">
            <label class="label form-label" for="${prefix}-rrule-interval">${t('rrule.labelEvery')}</label>
            <div class="rrule-interval-wrap">
              <input class="input form-input" type="number" id="${prefix}-rrule-interval"
                     min="1" max="99" value="${parsed.interval}" inputmode="numeric" style="width:64px;text-align:center">
              <span class="rrule-interval-unit" id="${prefix}-rrule-unit">${intervalUnitLabel(parsed.freq, parsed.interval)}</span>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label class="label form-label" for="${prefix}-rrule-end">${t('rrule.labelEnds')}</label>
            <select class="input form-input" id="${prefix}-rrule-end">
              ${endOpts}
            </select>
          </div>
        </div>

        <div class="rrule-row rrule-end-inputs">
          <div class="form-group rrule-until-field" id="${prefix}-rrule-until-wrap" ${endType === 'until' ? '' : 'hidden'} style="margin-bottom:0">
            <label class="label form-label" for="${prefix}-rrule-until">${t('rrule.labelUntil')}</label>
            <aashiyana-datepicker type="date" id="${prefix}-rrule-until"
                   value="${formatDateInput(parsed.until)}"></aashiyana-datepicker>
          </div>
          ${allowCount ? `<div class="form-group rrule-count-field" id="${prefix}-rrule-count-wrap" ${endType === 'count' ? '' : 'hidden'} style="margin-bottom:0">
            <label class="label form-label" for="${prefix}-rrule-count">${t('rrule.labelCount')}</label>
            <div class="rrule-interval-wrap">
              <input class="input form-input" type="number" id="${prefix}-rrule-count"
                     min="1" max="999" value="${parsed.count || 10}" inputmode="numeric" style="width:64px;text-align:center">
              <span class="rrule-interval-unit">${t('rrule.unitOccurrences')}</span>
            </div>
          </div>` : ''}
        </div>

        <div class="rrule-weekdays" id="${prefix}-rrule-weekdays" ${parsed.freq === 'WEEKLY' ? '' : 'hidden'}>
          <label class="label form-label">${t('rrule.labelOnDays')}</label>
          <div class="rrule-day-grid">${dayBtns}</div>
        </div>

        <!-- DIE EINE ANGABE, DIE SICH NICHT ALS DATUM SCHREIBEN LAESST (#960).
             "Am 15." braucht kein Feld - dafuer legt man die Serie am 15. an.
             "Am letzten Tag" dagegen meint in jedem Monat einen anderen und ist
             aus einem Startdatum allein nicht ableitbar: eine am 31. Januar
             begonnene Serie sah aus wie "letzter Tag" und verlor das im ersten
             kurzen Monat. Nur bei MONTHLY sichtbar, aus demselben Grund, aus
             dem buildRRule sie nur dort schreibt. -->
        <div class="rrule-monthday" id="${prefix}-rrule-monthday" ${parsed.freq === 'MONTHLY' ? '' : 'hidden'}>
          <label class="toggle" style="margin:0">
            <input type="checkbox" id="${prefix}-rrule-last-day" ${parsed.lastDay ? 'checked' : ''}${
              parsed.lastDay ? ` aria-describedby="${prefix}-rrule-monthday-hint"` : ''
            }>
            <span class="toggle__track"></span>
            <span>${t('rrule.lastDayOfMonth')}</span>
          </label>
          <!-- DAS EINGETRAGENE DATUM BLEIBT STEHEN (#960) - was daraus folgt,
               ist aber in den beiden Modulen VERSCHIEDEN, und ein Hinweis, der
               das Gegenteil verspricht, ist schlimmer als keiner.
               Der Kalender rechnet die Regel vom Startdatum aus aus: wer den
               15. eintraegt und ankreuzt, sieht als ersten Termin den 31.
               Die Aufgabe tut das nicht. Sie ist eine Zeile mit einem
               Faelligkeitsdatum, das Liste, Ueberfaelligkeit und Countdown
               direkt lesen - sie bleibt am 15. faellig, und erst der Durchlauf
               NACH dem Abhaken faellt auf den Monatsletzten.
               Der Kalender liefert sein aktives Startdatum deshalb über die
               Komponenten-Schnittstelle. Der Baustein greift nie selbst nach
               einem Startdatum-Feld: Kalender und Aufgaben benennen es anders,
               und im Kalender wechselt es zusätzlich mit „ganztägig". -->
          <p class="rrule-anchor__hint" id="${prefix}-rrule-monthday-hint"${parsed.lastDay ? '' : ' hidden'}>${
            monthEndHintText(opts.startDate, { expandsFromStart, rule: existingRule })
          }</p>
        </div>

        ${allowFromCompletion ? `
        <div class="rrule-anchor">
          <label class="toggle" style="margin:0">
            <input type="checkbox" id="${prefix}-rrule-from-completion" ${fromCompletion ? 'checked' : ''}>
            <span class="toggle__track"></span>
            <span>${t('rrule.fromCompletionLabel')}</span>
          </label>
          <p class="rrule-anchor__hint">${t('rrule.fromCompletionHint')}</p>
        </div>` : ''}

      </div>
    </div>
  `;
}

export function intervalUnitLabel(unit, count = 1) {
  const n = count > 1;
  switch (String(unit || '').toUpperCase()) {
    case 'DAILY':   return n ? t('rrule.unitDays')   : t('rrule.unitDay');
    case 'WEEKLY':  return n ? t('rrule.unitWeeks')  : t('rrule.unitWeek');
    case 'MONTHLY': return n ? t('rrule.unitMonths') : t('rrule.unitMonth');
    case 'YEARLY':  return n ? t('rrule.unitYears')  : t('rrule.unitYear');
    default:        return '';
  }
}


export function describeRRule(rule, opts = {}) {
  const p = parseRRule(rule);
  if (!p.freq) return '';



  // an zwei Stellen zu pflegen.
  const parts = [
    p.interval > 1
      ? `${t('rrule.labelEvery')} ${p.interval} ${intervalUnitLabel(p.freq, p.interval)}`
      : (FREQ_OPTIONS().find((o) => o.value === p.freq)?.label ?? t('rrule.freqDaily')),
  ];



  if (p.freq === 'WEEKLY' && p.byday.length) {
    const weekdays = WEEKDAYS();
    const days = p.byday.map((d) => weekdays.find((w) => w.value === d)?.label).filter(Boolean);
    if (days.length) parts.push(`(${days.join(', ')})`);
  }





  // beantworten dieselbe Frage.
  if (p.freq === 'MONTHLY' && p.lastDay) parts.push(`(${t('rrule.lastDayOfMonth')})`);



  let rhythm = parts.join(' ');
  if (opts.fromCompletion) rhythm += ` · ${t('rrule.summaryFromCompletion')}`;
  if (p.count) return `${rhythm} · ${t('rrule.summaryCount', { count: p.count })}`;
  if (p.until) return `${rhythm} · ${t('rrule.summaryUntil', { date: formatDate(p.until) })}`;
  return rhythm;
}

export function recurrenceRow(rule, opts = {}) {
  return { icon: 'repeat', label: t('rrule.labelRepeat'), value: describeRRule(rule, opts) };
}

export function bindRRuleEvents(root, prefix, opts = {}) {
  const freqSelect  = root.querySelector(`#${prefix}-rrule-freq`);
  const details     = root.querySelector(`#${prefix}-rrule-details`);
  const weekdays    = root.querySelector(`#${prefix}-rrule-weekdays`);
  const monthday    = root.querySelector(`#${prefix}-rrule-monthday`);
  const unitEl      = root.querySelector(`#${prefix}-rrule-unit`);
  const intervalEl  = root.querySelector(`#${prefix}-rrule-interval`);
  const endSelect   = root.querySelector(`#${prefix}-rrule-end`);
  const untilWrap   = root.querySelector(`#${prefix}-rrule-until-wrap`);
  const countWrap   = root.querySelector(`#${prefix}-rrule-count-wrap`);
  const untilInput  = root.querySelector(`#${prefix}-rrule-until`);
  const countInput  = root.querySelector(`#${prefix}-rrule-count`);
  const hint        = root.querySelector(`#${prefix}-rrule-hint`);
  const monthdayHint = root.querySelector(`#${prefix}-rrule-monthday-hint`);
  const lastDayInput = root.querySelector(`#${prefix}-rrule-last-day`);

  const refreshMonthdayHint = () => {
    if (!monthdayHint || typeof opts.getStartDate !== 'function') return;
    const current = getRRuleValues(root, prefix);
    monthdayHint.textContent = monthEndHintText(opts.getStartDate(), {
      expandsFromStart: !!opts.expandsFromStart,


      // Platzhalter erzwingt deshalb denselben sicheren generischen Rueckfall

      rule: current.valid_until ? current.recurrence_rule : 'INVALID',
    });
  };

  const syncMonthdayHintVisibility = () => {
    if (!monthdayHint || !lastDayInput) return;
    monthdayHint.hidden = !lastDayInput.checked;
    if (lastDayInput.checked) {
      lastDayInput.setAttribute('aria-describedby', monthdayHint.id || `${prefix}-rrule-monthday-hint`);
    } else {
      lastDayInput.removeAttribute('aria-describedby');
    }
  };

  if (!freqSelect) return { refreshMonthdayHint };

  freqSelect.addEventListener('change', () => {
    const freq = freqSelect.value;
    if (details)  details.hidden  = !freq;
    if (weekdays) weekdays.hidden = freq !== 'WEEKLY';
    if (monthday) monthday.hidden = freq !== 'MONTHLY';







    if (hint) {
      hint.hidden = !!freq;
      if (freq) freqSelect.removeAttribute('aria-describedby');
      else      freqSelect.setAttribute('aria-describedby', hint.id || `${prefix}-rrule-hint`);
    }
    refreshMonthdayHint();
    updateUnit();
  });

  endSelect?.addEventListener('change', () => {
    const mode = endSelect.value;
    if (untilWrap) untilWrap.hidden = mode !== 'until';
    if (countWrap) countWrap.hidden = mode !== 'count';
    refreshMonthdayHint();
  });

  intervalEl?.addEventListener('input', updateUnit);
  untilInput?.addEventListener('change', refreshMonthdayHint);
  countInput?.addEventListener('input', refreshMonthdayHint);
  lastDayInput?.addEventListener('change', () => {
    refreshMonthdayHint();
    syncMonthdayHintVisibility();
  });

  // Day-Toggle
  root.querySelectorAll(`#${prefix}-rrule-weekdays .rrule-day`).forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('rrule-day--active');
      btn.setAttribute('aria-pressed', btn.classList.contains('rrule-day--active'));
    });
  });

  function updateUnit() {
    if (!unitEl) return;
    const interval = parseInt(intervalEl?.value, 10) || 1;
    unitEl.textContent = intervalUnitLabel(freqSelect.value, interval);
  }

  refreshMonthdayHint();
  syncMonthdayHintVisibility();
  return { refreshMonthdayHint };
}

export function getRRuleValues(root, prefix) {
  const freq     = root.querySelector(`#${prefix}-rrule-freq`)?.value || '';
  const interval = parseInt(root.querySelector(`#${prefix}-rrule-interval`)?.value, 10) || 1;
  const endMode  = root.querySelector(`#${prefix}-rrule-end`)?.value || 'never';
  const untilInput = root.querySelector(`#${prefix}-rrule-until`);
  const untilRaw = endMode === 'until' ? (untilInput?.value || '') : '';
  const until = parseDateInput(untilRaw);
  const count = endMode === 'count'
    ? (parseInt(root.querySelector(`#${prefix}-rrule-count`)?.value, 10) || null)
    : null;

  const byday = [];
  root.querySelectorAll(`#${prefix}-rrule-weekdays .rrule-day--active`).forEach(btn => {
    byday.push(btn.dataset.day);
  });

  const lastDay = !!root.querySelector(`#${prefix}-rrule-last-day`)?.checked;

  const built = buildRRule({ freq, interval, byday, until, count, lastDay });











  const source = root.querySelector(`#${prefix}-rrule-source`)?.value || '';
  const rule = (built && source && buildRRule(parseRRule(source)) === built) ? source : built;




  const fromCompletion = !!rule
    && !!root.querySelector(`#${prefix}-rrule-from-completion`)?.checked;
  return {
    is_recurring:    !!rule,
    recurrence_rule: rule,
    recurrence_from_completion: fromCompletion,

    valid_until:     endMode !== 'until' || isDateInputValid(untilRaw),
  };
}
