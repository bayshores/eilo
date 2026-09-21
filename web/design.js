if (document.documentElement.dataset.source === 'live') {
  const isMacElectron =
    navigator.userAgent.includes('Electron') && navigator.userAgent.includes('Macintosh');
  if (isMacElectron) document.documentElement.dataset.nativeHost = 'macos';

  const { createHeroGradient } = await import('./hero-gradient.js');
  const background = document.createElement('div');
  background.className = 'hero-gradient';
  background.setAttribute('aria-hidden', 'true');
  document.body.prepend(background);
  const gradient = createHeroGradient(background);
  gradient.render();
  const aura = document.createElement('div');
  aura.className = 'home-aura';
  aura.setAttribute('aria-hidden', 'true');
  background.after(aura);
  const { mountHomeAura } = await import('./home/aura.js');
  const auraRenderer = mountHomeAura(aura);
  const brand = document.createElement('div');
  brand.className = 'scene-wordmark wordmark';
  brand.setAttribute('role', 'img');
  brand.setAttribute('aria-label', 'felis');
  brand.textContent = 'felis';
  document.querySelector('.workspace').prepend(brand);
  const { mountGlassWordmark } = await import('./brand/wordmark.js');
  await document.fonts.ready;
  const lettering = await mountGlassWordmark(brand);
  addEventListener('pagehide', (event) => {
    if (!event.persisted) {
      lettering?.destroy();
      auraRenderer?.destroy();
    }
  });
}
