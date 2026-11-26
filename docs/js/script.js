const README_URL = 'https://raw.githubusercontent.com/JanikHenz/my-homelab/main/README.md';

async function loadReadme() {
  try {
    const res = await fetch(README_URL);
    if (!res.ok) throw new Error('Failed to fetch README');
    return await res.text();
  } catch (e) {
    return '# Fehler\n\nREADME konnte nicht geladen werden. Bitte direkt auf [GitHub](https://github.com/JanikHenz/my-homelab) nachschauen.';
  }
}

// Same anchor ids as GitHub, so the README's table of contents works here too.
function slugify(text) {
  return text.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function addHeadingIds(root) {
  root.querySelectorAll('h1, h2, h3').forEach(h => {
    if (!h.id) h.id = slugify(h.textContent);
  });
}

// The README references images as "docs/img/...". This page is served from docs/,
// so those paths have to drop the "docs/" prefix. Other relative links point to GitHub.
function fixPaths(root) {
  root.querySelectorAll('img[src^="docs/"]').forEach(img => {
    img.setAttribute('src', img.getAttribute('src').slice('docs/'.length));
  });
  root.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (!/^(https?:|#|mailto:)/.test(href)) {
      a.href = 'https://github.com/JanikHenz/my-homelab/tree/main/' + href;
      a.target = '_blank';
    }
  });
}

function wrapTables(root) {
  root.querySelectorAll('table').forEach(t => {
    if (t.parentElement.classList.contains('table-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    t.replaceWith(wrap);
    wrap.appendChild(t);
  });
}

// Navigation is built from the README headings (h2 + h3), so it never goes stale.
function buildNav(root) {
  const list = document.getElementById('toc');
  list.innerHTML = '';
  root.querySelectorAll('h2, h3').forEach(h => {
    if (h.textContent.trim() === 'Inhalt') return;
    const li = document.createElement('li');
    if (h.tagName === 'H3') li.className = 'sub';
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    list.appendChild(li);
  });
}

function highlightNavOnScroll(root) {
  const headings = root.querySelectorAll('h2, h3');
  const navLinks = document.querySelectorAll('nav a');
  window.addEventListener('scroll', () => {
    let current = '';
    headings.forEach(h => {
      if (window.scrollY >= h.offsetTop - 100) current = h.id;
    });
    navLinks.forEach(a => {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
  });
}

loadReadme().then(md => {
  const content = document.getElementById('content');
  content.innerHTML = marked.parse(md);
  addHeadingIds(content);
  fixPaths(content);
  wrapTables(content);
  buildNav(content);
  highlightNavOnScroll(content);
  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView();
  }
});
