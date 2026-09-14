
import { api } from '/api.js';
import { t, formatDate, formatDateInput, parseDateInput, isDateInputValid } from '/i18n.js';
import { esc } from '/utils/html.js';
import { openModal as openSharedModal, closeModal as closeSharedModal, advancedSection, wireBlurValidation, reportFieldError } from '/components/modal.js';
import { DEFAULT_CATEGORY_NAME } from '/utils/shopping-categories.js';
import { renderKitchenTabsBar } from '/utils/kitchen-tabs.js';
import { resolveShoppingTarget, announceTransfer } from '/utils/kitchen-transfer.js';
import { popoverMenuHtml, installPopoverMenus } from '/utils/popover-menu.js';
import { ingredientRowHTML } from '/utils/ingredient-row.js';
import { scheduleUndoableDelete } from '/utils/ux.js';
import { normalizeRecipeMealTypes, RECIPE_MEAL_TYPE_KEYS } from '/utils/recipe-meal-types.js';
import { mealPayloadFromRecipe } from '/utils/recipe-to-meal.js';
import { todayKey } from '/utils/date.js';
import '/components/datepicker.js';
import { renderSkeletonList } from '/utils/skeleton.js';
import { mountEmptyState, mountLoadError } from '/utils/empty-state.js';
import { renderPageSearch, wirePageSearch } from '/utils/page-search.js';
import { mealTypeList, ensureMealTypeNames } from '/utils/meal-types.js';
import { recipeThumbEl } from '/utils/recipe-thumb.js';

let _container = null;
let _search = null;

const state = {
  recipes: [],
  categories: [],

  lists: [],
  query: '',
  /** Gefangener Fehler des letzten Rezept-Ladevorgangs, sonst null. */
  loadError: null,

  // sichtbar, sobald mindestens ein gespiegeltes Rezept existiert (siehe
  // renderSourceFilter).
  sourceFilter: 'all',

  plannedRecipeIds: new Set(),
};



function filteredRecipes() {
  const q = state.query.toLowerCase();
  return state.recipes.filter((r) => {
    if (state.sourceFilter !== 'all' && r.source !== state.sourceFilter) return false;
    if (!q) return true;
    return r.title?.toLowerCase().includes(q)
      || r.notes?.toLowerCase().includes(q)
      || (r.ingredients ?? []).some((i) => i.name?.toLowerCase().includes(q));
  });
}

function mealCategories() {
  return state.categories.filter((c) => c.name !== 'Haushalt' && c.name !== 'Drogerie');
}



// unterscheiden.
function sourceBadge(recipe) {
  const badge = document.createElement('span');
  badge.className = `source-badge source-badge--${recipe.source}`;
  badge.textContent = t(`recipes.source${recipe.source[0].toUpperCase()}${recipe.source.slice(1)}`);
  if (recipe.provider_account_name) badge.title = recipe.provider_account_name;
  return badge;
}





function recipeThumb(recipe) {
  return recipeThumbEl({
    recipeId: recipe.id,
    hasImage: recipe.provider_has_image,
    hasOwnImage: recipe.has_own_image,
    className: 'recipe-row__thumb',
  });
}

function mealTypeOptions() {
  return mealTypeList().map(({ key, label }) => ({ key, label }));
}

async function loadRecipes() {
  try {
    const res = await api.get('/recipes');
    state.recipes = res.data ?? [];
    state.loadError = null;
  } catch (err) {
    console.error('[Recipes] loadRecipes Fehler:', err);
    state.recipes = [];
    state.loadError = err;
  }
}

async function loadCategories() {
  try {
    const res = await api.get('/shopping/categories');
    state.categories = res.data;
  } catch {
    state.categories = [];
  }
}



async function loadShoppingLists() {
  if (window.aashiyana?.isModuleDisabled?.('shopping')) {
    state.lists = [];
    return;
  }
  try {
    const res = await api.get('/shopping');
    state.lists = res.data ?? [];
  } catch {
    state.lists = [];
  }
}







async function loadPlannedRecipes() {
  if (window.aashiyana?.isModuleDisabled?.('meals')) {
    state.plannedRecipeIds = new Set();
    return;
  }
  try {
    const res = await api.get('/meals');
    state.plannedRecipeIds = new Set((res.data ?? []).map((m) => m.recipe_id).filter(Boolean));
  } catch {
    state.plannedRecipeIds = new Set();
  }
}

function openRecipeFromQuery() {
  const raw = new URLSearchParams(window.location.search).get('open');
  const id = Number.parseInt(raw ?? '', 10);
  if (!Number.isInteger(id)) return;

  const row = _container?.querySelector(`.recipe-row-item[data-id="${id}"]`);
  if (!row) return;

  const toggle = row.querySelector('[data-action="toggle-detail"]');
  const panel = _container.querySelector(`#recipe-detail-${id}`);
  if (toggle && panel) {
    toggle.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
  }
  row.scrollIntoView({ block: 'nearest' });
}

export async function render(container) {
  _container = container;







  if (new URLSearchParams(window.location.search).has('open')) {
    state.query = '';
    state.sourceFilter = 'all';
  }

  const page = document.createElement('div');
  page.className = 'recipes-page app-page app-page--reading page-measure--narrow';
  page.dataset.composition = 'reading';;



  // Create-Affordanz (kein redundanter sichtbarer Kopf-Titel mehr).
  const title = document.createElement('h1');
  title.className = 'sr-only';
  title.textContent = t('nav.recipes');


  // durchsuchbar (Audit A1-21).






  const toolbar = document.createElement('div');


  toolbar.className = 'page-toolbar page-toolbar--in-group page-toolbar--narrow';
  const center = document.createElement('div');
  center.className = 'page-toolbar__center';
  // Geteilter Baustein (utils/page-search.js) statt eines eigenen Inputs. Er



  center.insertAdjacentHTML('beforeend', renderPageSearch({
    id: 'recipes-search',


    label: t('recipes.searchPlaceholder'),
    placeholder: t('recipes.searchPlaceholder'),
    value: state.query,
    clearLabel: t('common.searchClear'),
    className: 'recipes-search',
  }));
  toolbar.appendChild(center);







  // dem Laden).
  const actions = document.createElement('div');
  actions.className = 'page-toolbar__actions';
  actions.id = 'recipes-source-filter';
  actions.hidden = true;
  toolbar.appendChild(actions);

  const list = document.createElement('div');
  list.className = 'list-scroller page-scrollport recipes-list';
  list.id = 'recipes-list';


  list.setAttribute('aria-busy', 'true');
  list.insertAdjacentHTML('beforeend', renderSkeletonList({ rows: 5, lines: 2 }));




  const fab = document.createElement('button');
  fab.className = 'page-fab';
  fab.type = 'button';
  fab.id = 'fab-new-recipe';
  fab.setAttribute('aria-label', t('recipes.addRecipe'));
  fab.dataset.dockLabel = t('newLabel.recipes');
  const fabIcon = document.createElement('i');
  fabIcon.dataset.lucide = 'plus';
  fabIcon.setAttribute('aria-hidden', 'true');
  fab.appendChild(fabIcon);

  page.append(title, toolbar, list, fab);
  container.replaceChildren(page);
  renderKitchenTabsBar(container, '/recipes');


  installPopoverMenus(page);

  if (window.lucide) window.lucide.createIcons({ el: container });

  await Promise.all([loadRecipes(), loadCategories(), loadShoppingLists(), loadPlannedRecipes(), ensureMealTypeNames()]);
  renderSourceFilter();
  renderRecipeList();



  // jedes Modul seinen eigenen Parameter erfindet.
  //




  openRecipeFromQuery();

  fab.addEventListener('click', () => openRecipeModal('create'));




  _search = wirePageSearch(toolbar, {
    id: 'recipes-search',
    onQuery: (value) => {
      state.query = value.trim();
      renderRecipeList();
    },
  });

  list.addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;


    // (hidden). `hidden` statt max-height-Transition, weil ein per Transition


    // Sichtbarkeit an eine Animation binden.
    if (actionBtn.dataset.action === 'toggle-detail') {
      const panel = _container?.querySelector(`#recipe-detail-${actionBtn.dataset.id}`);
      if (!panel) return;
      const open = actionBtn.getAttribute('aria-expanded') === 'true';
      actionBtn.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
      return;
    }

    const recipeId = Number(actionBtn.dataset.id);
    const recipe = state.recipes.find((r) => r.id === recipeId);
    if (!recipe) return;

    if (actionBtn.dataset.action === 'edit') {
      openRecipeModal('edit', recipe);
      return;
    }

    if (actionBtn.dataset.action === 'delete') {
      await removeRecipe(recipe);
      return;
    }

    if (actionBtn.dataset.action === 'duplicate') {
      await duplicateRecipe(recipe);
      return;
    }

    if (actionBtn.dataset.action === 'to-shopping') {
      await transferRecipe(recipe, actionBtn);
      return;
    }

    if (actionBtn.dataset.action === 'add-to-meals') {
      await planRecipe(recipe, actionBtn);
    }
  });




  // Bedienelementen darin war.
}





// Kopf-Zeile kostete. Bleibt versteckt, solange kein Provider-Account

function renderSourceFilter() {
  const el = _container.querySelector('#recipes-source-filter');
  if (!el) return;

  const hasMirrored = state.recipes.some((r) => r.source !== 'native');
  if (!hasMirrored) {
    el.hidden = true;
    state.sourceFilter = 'all';
    return;
  }

  el.hidden = false;
  const options = [
    { value: 'all', label: t('recipes.sourceAll') },
    { value: 'native', label: t('recipes.sourceNative') },
    ...[...new Set(state.recipes.map((r) => r.source).filter((s) => s !== 'native'))].sort().map((s) => ({
      value: s, label: t(`recipes.source${s[0].toUpperCase()}${s.slice(1)}`),
    })),
  ];
  const activeLabel = options.find((o) => o.value === state.sourceFilter)?.label ?? '';

  el.replaceChildren();
  el.insertAdjacentHTML('beforeend', `
    <button type="button" class="btn btn--ghost btn--icon popover-menu__trigger"
            popovertarget="recipes-source-filter-menu" aria-haspopup="menu" aria-expanded="false"
            aria-label="${esc(t('recipes.sourceFilterLabel'))}: ${esc(activeLabel)}"
            title="${esc(t('recipes.sourceFilterLabel'))}: ${esc(activeLabel)}">
      <i data-lucide="filter" class="icon-md" aria-hidden="true"></i>
    </button>
    <div class="popover-menu recipes-source-filter-menu" id="recipes-source-filter-menu" popover role="menu"
         aria-label="${esc(t('recipes.sourceFilterLabel'))}">
      ${options.map((opt) => {
        const active = state.sourceFilter === opt.value;
        return `
          <button type="button" role="menuitemradio" aria-checked="${active}"
                  class="popover-menu__item" data-source-value="${esc(opt.value)}">
            <i data-lucide="check" class="icon-md popover-menu__item-check${active ? '' : ' popover-menu__item-check--hidden'}" aria-hidden="true"></i>
            <span>${esc(opt.label)}</span>
          </button>`;
      }).join('')}
    </div>`);

  for (const btn of el.querySelectorAll('[data-source-value]')) {
    btn.addEventListener('click', () => {
      const value = btn.dataset.sourceValue;
      if (state.sourceFilter === value) return;
      state.sourceFilter = value;
      renderSourceFilter();
      renderRecipeList();
    });
  }
  if (window.lucide) window.lucide.createIcons({ el });
}

function renderRecipeList() {
  const list = _container.querySelector('#recipes-list');
  if (!list) return;
  list.removeAttribute('aria-busy');

  list.replaceChildren();



  // „nicht geladen".
  if (state.loadError) {
    mountLoadError(list, {
      title: t('recipes.loadError'),
      description: t('common.loadErrorDescription'),
      error: state.loadError,
      retryLabel: t('common.retry'),
      onRetry: async () => {
        list.setAttribute('aria-busy', 'true');
        await loadRecipes();
        renderRecipeList();
      },
    });
    return;
  }

  if (!state.recipes.length) {
    // Geteilter Renderer (utils/empty-state.js): erzwingt Reihenfolge und

    mountEmptyState(list, {
      icon: 'book-text',
      title: t('recipes.emptyTitle'),
      description: t('recipes.emptyDescription'),
      hint: t('emptyHint.recipes'),
      action: {
        label: t('recipes.emptyAction'),
        icon: 'plus',
        onClick: () => document.querySelector('.page-fab')?.click(),
      },
    });
    return;
  }

  const visible = filteredRecipes();
  if (!visible.length) {





    mountEmptyState(list, {
      variant: 'no-results',
      title: t('recipes.noResultsTitle'),
      description: t('recipes.searchNoResults'),
      hint: state.query ? `„${state.query}"` : undefined,
      action: {




        label: t('common.searchClear'),
        onClick: () => {
          state.query = '';


          _search?.clear();
          renderRecipeList();
          _search?.input.focus();
        },
      },
    });
    return;
  }





  const rows = document.createElement('ul');
  rows.className = 'list-rows';

  for (const recipe of visible) {


    const isMirrored = recipe.source !== 'native';
    const ingredients = recipe.ingredients ?? [];
    const detailId = `recipe-detail-${recipe.id}`;
    const hasDetail = Boolean(ingredients.length || recipe.notes || recipe.recipe_url);

    const li = document.createElement('li');
    li.className = 'recipe-row-item';
    li.dataset.id = String(recipe.id);

    const row = document.createElement('div');
    row.className = 'list-row recipe-row';





    const heading = document.createElement('h2');
    heading.className = 'list-row__main recipe-row__heading';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'list-row__main--interactive recipe-row__toggle';
    toggle.dataset.action = 'toggle-detail';
    toggle.dataset.id = String(recipe.id);




    // danach.
    if (isMirrored) toggle.appendChild(recipeThumb(recipe));

    const name = document.createElement('span');
    name.className = 'list-row__name';
    name.textContent = recipe.title;
    toggle.appendChild(name);

    if (isMirrored) {






      // ihrer Inhaltsbreite treu.
      const badgeSlot = document.createElement('span');
      badgeSlot.className = 'recipe-row__badge-slot';
      badgeSlot.appendChild(sourceBadge(recipe));
      toggle.appendChild(badgeSlot);
    }





    // dessen, was das Aufklappen zeigt.
    //





    const meta = document.createElement('span');
    meta.className = 'list-row__meta';
    meta.textContent = t('meals.ingredientCount', { count: ingredients.length });
    toggle.appendChild(meta);


    // (Hausform, Vorrat): neutraler Sekundaertext, keine Flaeche - der

    if (state.plannedRecipeIds.has(recipe.id)) {
      const planned = document.createElement('span');
      planned.className = 'recipe-row__planned';
      planned.textContent = t('recipes.plannedThisWeek');
      toggle.appendChild(planned);
    }

    if (hasDetail) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', detailId);
      toggle.insertAdjacentHTML('beforeend',
        '<i data-lucide="chevron-down" class="icon-sm recipe-row__chevron" aria-hidden="true"></i>');
    } else if (!isMirrored) {


      toggle.dataset.action = 'edit';
    } else {







      delete toggle.dataset.action;
      toggle.classList.remove('list-row__main--interactive');
      toggle.tabIndex = -1;




      toggle.insertAdjacentHTML('beforeend',
        '<i data-lucide="chevron-down" class="icon-sm recipe-row__chevron recipe-row__chevron--placeholder" aria-hidden="true"></i>');
    }

    heading.appendChild(toggle);
    row.appendChild(heading);



    // frei bearbeitbare Kopie an (duplicateRecipe() postet immer als natives


    // beide Fassungen nie auseinanderlaufen.
    const ROW_ACTIONS = [
      !isMirrored && { action: 'edit',      icon: 'pencil',  label: t('common.edit') },
      { action: 'duplicate', icon: 'copy',    label: t('recipes.duplicate') },
      !isMirrored && { action: 'delete',    icon: 'trash-2', label: t('common.delete'), danger: true },
    ].filter(Boolean);

    const actions = document.createElement('div');
    actions.className = 'list-row__actions';




    // (Critique 2026-07-30, P0).
    //





    const inline = document.createElement('div');
    inline.className = 'recipe-row__inline-actions';
    for (const a of ROW_ACTIONS) {
      const btn = document.createElement('button');
      btn.className = `row-action${a.danger ? ' row-action--danger' : ''}`;
      btn.type = 'button';
      btn.dataset.action = a.action;
      btn.dataset.id = String(recipe.id);
      btn.setAttribute('aria-label', `${a.label}: ${recipe.title}`);
      btn.title = a.label;
      btn.insertAdjacentHTML('beforeend',
        `<i data-lucide="${a.icon}" class="icon-md" aria-hidden="true"></i>`);
      inline.appendChild(btn);
    }
    actions.appendChild(inline);

    const more = document.createElement('div');
    more.className = 'recipe-row__more';
    more.insertAdjacentHTML('beforeend', popoverMenuHtml({
      id: `recipe-menu-${recipe.id}`,
      label: t('common.moreActions'),
      triggerClass: 'row-action',
      items: ROW_ACTIONS.map((a) => ({ ...a, id: recipe.id })),
    }));
    actions.appendChild(more);

    row.appendChild(actions);
    li.appendChild(row);

    if (hasDetail) {
      const detail = document.createElement('div');
      detail.className = 'recipe-detail';
      detail.id = detailId;
      detail.hidden = true;

      const mealTypes = normalizeRecipeMealTypes(recipe.meal_types);




      const showMealTypeBadges = mealTypes.length && mealTypes.length < mealTypeOptions().length;
      if (showMealTypeBadges) {
        const badges = document.createElement('div');
        badges.className = 'recipe-card__meal-types';
        badges.append(...mealTypeOptions()
          .filter((option) => mealTypes.includes(option.key))
          .map((option) => {
            const badge = document.createElement('span');
            badge.className = `meal-type-badge meal-type-badge--${option.key}`;
            badge.textContent = option.label;
            return badge;
          }));
        detail.appendChild(badges);
      } else if (!mealTypes.length) {




        const none = document.createElement('div');
        none.className = 'recipe-card__meal-types';
        const badge = document.createElement('span');
        badge.className = 'meal-type-badge meal-type-badge--none';
        badge.textContent = t('recipes.mealTypeNone');
        none.appendChild(badge);
        detail.appendChild(none);
      }



      // keinen Grund, etwas zu verschweigen.
      if (ingredients.length) {
        const ul = document.createElement('ul');
        ul.className = 'recipe-detail__ingredients';
        for (const ing of ingredients) {
          const item = document.createElement('li');
          item.className = 'recipe-detail__ingredient';
          item.textContent = ing.quantity ? `${ing.quantity} · ${ing.name}` : ing.name;
          ul.appendChild(item);
        }
        detail.appendChild(ul);
      }

      if (recipe.notes) {
        const notes = document.createElement('p');
        notes.className = 'recipe-detail__notes';
        notes.textContent = recipe.notes;
        detail.appendChild(notes);
      }








      const detailActions = document.createElement('div');
      detailActions.className = 'recipe-detail__actions';

      const addToMeals = document.createElement('button');
      addToMeals.className = 'btn btn--primary';
      addToMeals.type = 'button';
      addToMeals.dataset.action = 'add-to-meals';
      addToMeals.dataset.id = String(recipe.id);
      addToMeals.textContent = t('recipes.addToMeals');
      detailActions.appendChild(addToMeals);

      if (state.lists.length && ingredients.length) {
        const addToShopping = document.createElement('button');
        addToShopping.className = 'btn btn--secondary';
        addToShopping.type = 'button';
        addToShopping.dataset.action = 'to-shopping';
        addToShopping.dataset.id = String(recipe.id);
        addToShopping.textContent = t('common.toShoppingList');
        detailActions.appendChild(addToShopping);
      }

      if (recipe.recipe_url) {
        const link = document.createElement('a');
        link.className = 'btn btn--ghost';
        link.href = recipe.recipe_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.insertAdjacentHTML('beforeend',
          '<i data-lucide="external-link" class="icon-sm" aria-hidden="true"></i>');
        const linkLabel = document.createElement('span');
        linkLabel.textContent = t('recipes.openLink');
        link.appendChild(linkLabel);
        detailActions.appendChild(link);
      }

      detail.appendChild(detailActions);
      li.appendChild(detail);
    }

    rows.appendChild(li);
  }

  list.appendChild(rows);

  if (window.lucide) window.lucide.createIcons({ el: list });
}


function openRecipeModal(mode, recipe = null) {
  const isEdit = mode === 'edit';

  openSharedModal({
    title: isEdit ? t('recipes.editRecipe') : t('recipes.addRecipe'),
    size: 'md',
    content: `
      <div class="form-group">
        <label class="form-label" for="recipe-title">${t('common.nameLabel')}</label>
        <input id="recipe-title" class="form-input" type="text" required placeholder="${t('recipes.titlePlaceholder')}">
      </div>
      <div class="form-group">
        <label class="form-label">${t('meals.mealTypeLabel')}</label>
        <div class="recipe-meal-types" id="recipe-meal-types">
          ${mealTypeOptions().map((option) => `
            <label class="form-check recipe-meal-types__option">
              <input type="checkbox" value="${option.key}" checked>
              <span class="meal-type-badge meal-type-badge--${option.key}">${option.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">${t('recipes.ingredientsLabel')}</label>
        <div class="recipe-ingredient-list" id="recipe-ingredient-list"></div>
        <button class="btn btn--secondary recipe-add-ingredient" type="button" id="recipe-add-ingredient">${t('meals.addIngredient')}</button>
      </div>
      ${advancedSection(`
        <div class="form-group">
          <label class="form-label" for="recipe-notes">${t('recipes.notesLabel')}</label>
          <textarea id="recipe-notes" class="form-input" rows="3" placeholder="${t('recipes.notesPlaceholder')}"></textarea>
        </div>
        ${/* Ein eigenes Bild (#1059, Schritt 2) - fuer gespiegelte Rezepte
            * ausgeblendet: die sind hier ohnehin schreibgeschuetzt, ihr Inhalt
            * gehoert dem Provider. */ ''}
        <div class="form-group" id="recipe-image-group"${isEdit && recipe?.source !== 'native' ? ' hidden' : ''}>
          <label class="form-label">${t('recipes.imageLabel')}</label>
          <div class="recipe-image-editor">
            <button type="button" class="recipe-image-preview" id="recipe-image-preview"
                    aria-label="${esc(t('recipes.imageLabel'))}"></button>
            <input class="sr-only" id="recipe-image" type="file" accept="image/png,image/jpeg,image/webp">
            <button type="button" class="btn btn--secondary btn--sm" id="recipe-image-pick">${t('recipes.imageChoose')}</button>
            <button type="button" class="btn btn--ghost btn--sm" id="recipe-image-remove">${t('recipes.imageRemove')}</button>
          </div>
          <p class="form-hint">${t('recipes.imageHint')}</p>
        </div>
        <div class="form-group">
          <label class="form-label" for="recipe-url">${t('recipes.urlLabel')}</label>
          <input id="recipe-url" class="form-input" type="url" placeholder="${t('recipes.urlPlaceholder')}">
        </div>`,
        { open: isEdit && (!!recipe.notes || !!recipe.recipe_url) })}
      <div class="modal-panel__footer modal-panel__footer--plain">
        <button class="btn btn--secondary" id="recipe-cancel">${t('common.cancel')}</button>
        <button class="btn btn--primary" id="recipe-save">${isEdit ? t('common.save') : t('common.add')}</button>
      </div>
    `,
    onSave(panel) {
      panel.querySelector('#recipe-title').value = isEdit ? recipe.title : '';
      panel.querySelector('#recipe-notes').value = isEdit && recipe.notes ? recipe.notes : '';
      panel.querySelector('#recipe-url').value = isEdit && recipe.recipe_url ? recipe.recipe_url : '';

      let bildStand;
      const bildVorschau = panel.querySelector('#recipe-image-preview');
      const bildInput = panel.querySelector('#recipe-image');
      const zeigeBild = () => {
        if (!bildVorschau) return;
        bildVorschau.replaceChildren();


        const quelle = bildStand !== undefined
          ? bildStand
          : (isEdit && recipe?.has_own_image ? `/api/v1/recipes/${recipe.id}/image` : null);
        if (quelle) {
          const img = document.createElement('img');
          img.className = 'recipe-image-preview__img';
          img.src = quelle;
          img.alt = '';
          bildVorschau.appendChild(img);
        } else {
          bildVorschau.insertAdjacentHTML('beforeend', '<i data-lucide="image-plus" class="icon-md" aria-hidden="true"></i>');
          if (window.lucide) window.lucide.createIcons({ el: bildVorschau });
        }
      };
      zeigeBild();
      bildVorschau?.addEventListener('click', () => bildInput?.click());
      panel.querySelector('#recipe-image-pick')?.addEventListener('click', () => bildInput?.click());
      bildInput?.addEventListener('change', async (e) => {
        const datei = e.target.files?.[0];

        // abgebrochenen Zuschnitt kein zweites `change`.
        e.target.value = '';
        try {
          const { pickCroppedImage } = await import('/utils/avatar-crop.js');
          const zugeschnitten = await pickCroppedImage(datei, {
            messageKeys: { dataTooLarge: 'recipes.imageTooLarge' },
          });
          if (zugeschnitten === undefined) return; // abgebrochen
          bildStand = zugeschnitten;
          zeigeBild();
        } catch (err) {
          window.aashiyana?.showToast(err.message, 'danger');
        }
      });
      panel.querySelector('#recipe-image-remove')?.addEventListener('click', () => {
        bildStand = null;
        zeigeBild();
      });
      panel.dataset.bildGesetzt = '';
      panel._bildStand = () => bildStand;
      const selectedMealTypes = normalizeRecipeMealTypes(isEdit ? recipe.meal_types : RECIPE_MEAL_TYPE_KEYS);
      panel.querySelectorAll('#recipe-meal-types input[type="checkbox"]').forEach((input) => {
        input.checked = selectedMealTypes.includes(input.value);
      });

      const ingList = panel.querySelector('#recipe-ingredient-list');
      if (isEdit && recipe.ingredients?.length) {
        ingList.insertAdjacentHTML('beforeend', recipe.ingredients.map((i) => ingredientRowHTML({
          name: i.name,
          quantity: i.quantity ?? '',
          category: i.category ?? DEFAULT_CATEGORY_NAME,
          categories: mealCategories(),
        })).join(''));
      }

      panel.querySelector('#recipe-add-ingredient')?.addEventListener('click', () => {
        ingList.insertAdjacentHTML('beforeend', ingredientRowHTML({ categories: mealCategories() }));
        if (window.lucide) window.lucide.createIcons({ el: ingList });
      });

      ingList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action="remove-ingredient"]');
        if (!btn) return;
        btn.closest('.ingredient-row')?.remove();
      });

      panel.querySelector('#recipe-cancel')?.addEventListener('click', closeModal);
      panel.querySelector('#recipe-save')?.addEventListener('click', () => saveRecipe(panel, mode, recipe));

      wireBlurValidation(panel);

      if (window.lucide) window.lucide.createIcons({ el: panel });
    },
  });
}

function closeModal({ force = false } = {}) {
  closeSharedModal({ force });
}

async function saveRecipe(panel, mode, recipe) {
  const saveBtn = panel.querySelector('#recipe-save');
  const title = panel.querySelector('#recipe-title')?.value.trim() || '';
  const notes = panel.querySelector('#recipe-notes')?.value.trim() || null;
  const recipe_url = panel.querySelector('#recipe-url')?.value.trim() || null;
  const meal_types = [...panel.querySelectorAll('#recipe-meal-types input[type="checkbox"]:checked')].map((input) => input.value);

  if (!title) {
    // Fehler am Feld statt als ortloser Toast (geteiltes Muster, Critique P1).
    reportFieldError(panel.querySelector('#recipe-title'), t('common.nameRequired'));
    return;
  }

  const ingredients = [];
  panel.querySelectorAll('.ingredient-row').forEach((row) => {
    const name = row.querySelector('.ingredient-row__name')?.value.trim() || '';
    const quantity = row.querySelector('.ingredient-row__qty')?.value.trim() || null;
    const category = row.querySelector('.ingredient-row__cat')?.value || DEFAULT_CATEGORY_NAME;
    if (name) ingredients.push({ name, quantity, category });
  });


  // laesst das gespeicherte stehen (#1059).
  const bildStand = panel._bildStand?.();
  const bildFeld = bildStand === undefined ? {} : { image_data: bildStand };

  saveBtn.disabled = true;

  try {
    if (mode === 'create') {
      const res = await api.post('/recipes', { title, notes, recipe_url, meal_types, ingredients, ...bildFeld });
      state.recipes.push(res.data);
    } else {
      const res = await api.put(`/recipes/${recipe.id}`, { title, notes, recipe_url, meal_types, ingredients, ...bildFeld });
      const idx = state.recipes.findIndex((r) => r.id === recipe.id);
      if (idx >= 0) state.recipes[idx] = res.data;
    }

    closeModal({ force: true });
    renderRecipeList();
    window.aashiyana?.showToast(mode === 'create' ? t('recipes.created') : t('recipes.updated'), 'success');
  } catch (err) {
    saveBtn.disabled = false;
    window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  }
}

// --------------------------------------------------------
// Zutaten → Einkaufsliste
// --------------------------------------------------------

async function planRecipe(recipe, btn) {
  const declared = normalizeRecipeMealTypes(recipe.meal_types);




  const types = declared.length ? declared : RECIPE_MEAL_TYPE_KEYS.slice();






  const vorauswahl = types.length === 1 ? types[0] : (types.includes('dinner') ? 'dinner' : types[0]);
  const typeOpts = mealTypeOptions()
    .filter(({ key }) => types.includes(key))
    .map(({ key, label }) =>
      `<option value="${key}"${key === vorauswahl ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');

  const today = todayKey();

  openSharedModal({
    title: t('recipes.planTitle', { name: recipe.title }),
    size: 'sm',
    content: `
      <div class="form-group">
        <label class="form-label" for="plan-date">${t('meals.dateLabel')}</label>
        <aashiyana-datepicker type="date" id="plan-date" value="${esc(formatDateInput(today))}"></aashiyana-datepicker>
      </div>
      <div class="form-group">
        <label class="form-label" for="plan-type">${t('meals.mealTypeLabel')}</label>
        <select class="form-input" id="plan-type">${typeOpts}</select>
      </div>
      <div class="modal-panel__footer modal-panel__footer--plain">
        <button type="button" class="btn btn--secondary" data-action="close-modal">${esc(t('common.cancel'))}</button>
        <!-- „Übernehmen", nicht die Wiederholung des Auslöser-Labels: die drei
             anderen Transfer-Dialoge bestätigen genauso, und der Dialogtitel
             nennt Rezept und Ziel bereits (Critique 2026-07-30). -->
        <button type="button" class="btn btn--primary" id="plan-confirm">${esc(t('common.apply'))}</button>
      </div>`,
    onSave(panel) {
      panel.querySelector('#plan-confirm').addEventListener('click', async (e) => {
        const confirmBtn = e.currentTarget;
        const dateField = panel.querySelector('#plan-date');
        if (!isDateInputValid(dateField.value)) {
          reportFieldError(dateField, t('calendar.invalidDate'));
          return;
        }
        const date = parseDateInput(dateField.value);
        const mealType = panel.querySelector('#plan-type').value;

        confirmBtn.disabled = true;
        try {
          await api.post('/meals', mealPayloadFromRecipe(recipe, date, mealType));
          closeSharedModal({ force: true });
          window.aashiyana?.showToast(
            t('recipes.planSuccess', { name: recipe.title, date: formatDate(date) }),
            'success',
          );
        } catch (err) {
          window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
          confirmBtn.disabled = false;
        }
      });
    },
  });

  if (btn) btn.blur();
}

async function transferRecipe(recipe, btn) {




  const target = await resolveShoppingTarget(state.lists);
  if (!target) return;

  if (btn) btn.disabled = true;
  try {
    const res = await api.post(`/recipes/${recipe.id}/to-shopping-list`, { listId: target.id });
    const added = res.data?.transferred ?? 0;
    const skipped = res.data?.skipped ?? 0;

    if (added > 0) {


      // Listen (Critique 2026-07-30, P1).
      //


      // gerade nicht ansieht (Audit 2026-07-30, P1-B).
      announceTransfer({
        message: t('recipes.toShoppingSuccess', { count: added, list: target.name }),
        addedIds: res.data?.added_ids ?? [],
      });
    } else if (skipped > 0) {
      window.aashiyana?.showToast(t('recipes.toShoppingAllPresent'), 'info');
    } else {
      window.aashiyana?.showToast(t('recipes.toShoppingNoIngredients'), 'info');
    }
  } catch (err) {
    window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function removeRecipe(recipe) {
  const itemEl = _container.querySelector(`.recipe-row-item[data-id="${recipe.id}"]`);
  if (itemEl) itemEl.style.display = 'none';

  scheduleUndoableDelete({
    message: t('recipes.deleted'),
    commit: async ({ keepalive }) => {
      await api.delete(`/recipes/${recipe.id}`, { keepalive });
      if (keepalive) return; // Seite verschwindet — kein UI-Refresh mehr
      state.recipes = state.recipes.filter((r) => r.id !== recipe.id);
      renderRecipeList();
    },
    restore: (err) => {
      if (itemEl) itemEl.style.display = '';
      if (err) window.aashiyana?.showToast(err.data?.error ?? t('common.unknownError'), 'danger');
    },
  });
}

async function duplicateRecipe(recipe) {
  const copySuffix = t('recipes.copySuffix');
  const title = `${recipe.title} (${copySuffix})`;
  const notes = recipe.notes || null;
  const recipe_url = recipe.recipe_url || null;
  const ingredients = (recipe.ingredients || []).map((ing) => ({
    name: ing.name,
    quantity: ing.quantity || null,
    category: ing.category || DEFAULT_CATEGORY_NAME,
  }));

  try {
    const res = await api.post('/recipes', { title, notes, recipe_url, ingredients });
    state.recipes.push(res.data);
    renderRecipeList();
    window.aashiyana?.showToast(t('recipes.duplicated'), 'success');
  } catch (err) {
    window.aashiyana?.showToast(err.data?.error ?? t('common.errorGeneric'), 'danger');
  }
}
