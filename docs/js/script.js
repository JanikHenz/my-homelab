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
  let mermaidIndex = 0;

  marked.use({
    renderer: {
      code({ text, lang }) {
        if (lang === 'mermaid') {
          const id = 'mermaid-' + mermaidIndex++;
          return `<div class="mermaid-wrapper"><div class="mermaid" id="${id}">${text}</div></div>`;
        }
        return `<pre><code class="language-${lang || ''}">${text}</code></pre>`;
      }
    }
  });

  // Fetch README from GitHub
  loadReadme().then(async md => {
    document.getElementById('content').innerHTML = marked.parse(md);
    await mermaid.run({ querySelector: '.mermaid' });

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