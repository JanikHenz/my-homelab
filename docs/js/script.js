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

  // Configure mermaid
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    themeVariables: {
      background: '#161b22',
      primaryColor: '#1f6feb',
      primaryTextColor: '#e6edf3',
      primaryBorderColor: '#30363d',
      lineColor: '#8b949e',
      secondaryColor: '#21262d',
      tertiaryColor: '#0d1117',
    }
  });

  // Configure marked to handle mermaid blocks
  const renderer = new marked.Renderer();
  const originalCode = renderer.code.bind(renderer);
  let mermaidIndex = 0;

  renderer.code = function(code, language) {
    if (language === 'mermaid') {
      const id = 'mermaid-' + mermaidIndex++;
      return `<div class="mermaid-wrapper"><div class="mermaid" id="${id}">${code}</div></div>`;
    }
    return originalCode(code, language);
  };

  marked.setOptions({ renderer });

  // Fetch README from GitHub
  loadReadme().then(md => {
    document.getElementById('content').innerHTML = marked.parse(md);
    mermaid.run({ querySelector: '.mermaid' });

    // Active nav highlight on scroll
    const headings = document.querySelectorAll('h2, h3');
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
  });