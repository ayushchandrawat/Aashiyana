(() => {
  const lucide = window.lucide;
  if (!lucide?.createIcons || !lucide.createElement || !lucide.icons) return;

  const orig = lucide.createIcons;


  const toPascal = (name) => String(name)
    .replace(/(\w)(\w*)(_|-|\s*)/g, (_all, head, tail) => head.toUpperCase() + tail.toLowerCase());

  const replaceScoped = (node) => {
    const name = node.getAttribute('data-lucide');
    if (name == null) return;
    const icon = lucide.icons[toPascal(name)];
    if (!icon) {
      console.warn(`${node.outerHTML} icon name was not found in the provided icons object.`);
      return;
    }
    const svg = lucide.createElement(icon);
    for (const attr of node.attributes) {
      if (attr.name === 'class') continue;
      svg.setAttribute(attr.name, attr.value);
    }
    svg.setAttribute('data-lucide', name);
    const classes = ['lucide', `lucide-${name}`, ...node.classList];
    svg.setAttribute('class', [...new Set(classes)].join(' '));
    node.replaceWith(svg);
  };

  lucide.createIcons = (opts = {}) => {
    const { el, ...rest } = opts;
    const canScope = el && typeof el.querySelectorAll === 'function';
    if (!canScope) return orig(rest);
    if (typeof el.getAttribute === 'function' && el.getAttribute('data-lucide') != null) replaceScoped(el);
    for (const node of el.querySelectorAll('[data-lucide]')) replaceScoped(node);
  };
})();
