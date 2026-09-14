export function buildHelpRows({ coarsePointer, shortcuts, t }) {
  if (coarsePointer) {
    return [
      { icon: 'navigation',  desc: t('help.mobileNavigate') },
      { icon: 'plus-circle', desc: t('help.mobileCreate') },
      { icon: 'search',      desc: t('help.mobileSearch') },

      { icon: 'layout-grid', desc: t('nav.moreCatalogHint') },
      { icon: 'settings',    desc: t('help.mobileSettings') },
    ];
  }
  return shortcuts.map((s) => ({ key: s.key, desc: s.description() }));
}
