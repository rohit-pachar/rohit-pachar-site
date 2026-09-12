/* Progressive enhancements only. Every section, story, and link works without JS. */
(() => {
  'use strict';

  const header = document.querySelector('[data-header]');
  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#site-nav');
  const mobileQuery = window.matchMedia('(max-width: 700px)');

  // The menu is only collapsed after its handlers are ready. No-JS gets normal links.
  if (header && menuButton && nav) {
    const label = menuButton.querySelector('[data-menu-label]');
    const setMenu = (open) => {
      header.classList.toggle('nav-is-open', open);
      menuButton.setAttribute('aria-expanded', String(open));
      if (label) label.textContent = open ? 'Close' : 'Menu';
    };
    menuButton.addEventListener('click', () => {
      setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', (event) => {
      if (!event.target.closest('a')) return;
      setMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        menuButton.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (!header.contains(event.target)) setMenu(false);
    });
    const onBreakpointChange = () => {
      const focusWouldHide = mobileQuery.matches && nav.contains(document.activeElement);
      setMenu(false);
      if (focusWouldHide) menuButton.focus();
    };
    if (mobileQuery.addEventListener) mobileQuery.addEventListener('change', onBreakpointChange);
    menuButton.hidden = false;
    header.classList.add('menu-ready');
  }

  // Current section and reading progress. One small update per animation frame.
  const progress = document.querySelector('[data-progress]');
  const navLinks = Array.from(document.querySelectorAll('[data-nav-link]'));
  const sections = navLinks.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  let scrollQueued = false;
  const syncScrollUI = () => {
    scrollQueued = false;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) {
      const value = maxScroll > 0 ? Math.min(1, Math.max(0, window.scrollY / maxScroll)) : 0;
      progress.style.transform = `scaleX(${value})`;
    }
    let activeId = '';
    const threshold = Math.min(240, window.innerHeight * 0.35);
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= threshold) activeId = section.id;
    }
    if (maxScroll > 0 && window.scrollY >= maxScroll - 3) activeId = sections.at(-1)?.id || activeId;
    for (const link of navLinks) {
      if (link.getAttribute('href') === `#${activeId}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  const queueScrollUI = () => {
    if (scrollQueued) return;
    scrollQueued = true;
    window.requestAnimationFrame(syncScrollUI);
  };
  window.addEventListener('scroll', queueScrollUI, { passive: true });
  window.addEventListener('resize', queueScrollUI, { passive: true });
  document.querySelectorAll('details').forEach((detail) => detail.addEventListener('toggle', queueScrollUI));
  window.addEventListener('load', queueScrollUI);
  syncScrollUI();

  // A gentle entrance only for below-the-fold elements; motion preferences win.
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -25px 0px' });
    const revealElements = Array.from(document.querySelectorAll('.reveal'));
    revealElements.forEach((element) => {
      if (element.getBoundingClientRect().top > window.innerHeight) {
        element.classList.add('will-reveal');
        observer.observe(element);
      }
    });
    if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', (event) => {
      if (event.matches) {
        observer.disconnect();
        revealElements.forEach((element) => element.classList.add('is-visible'));
      }
    });
  }

  // Native dialog supplies focus trapping and Escape. The image link is a fallback.
  const photoLink = document.querySelector('[data-photo-open]');
  const photoDialog = document.querySelector('[data-photo-dialog]');
  const closePhoto = document.querySelector('[data-photo-close]');
  if (photoLink && photoDialog && closePhoto && typeof photoDialog.showModal === 'function') {
    photoLink.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      photoDialog.showModal();
      document.body.classList.add('dialog-is-open');
    });
    closePhoto.addEventListener('click', () => photoDialog.close());
    photoDialog.addEventListener('click', (event) => {
      const box = photoDialog.getBoundingClientRect();
      if (event.target === photoDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) {
        photoDialog.close();
      }
    });
    photoDialog.addEventListener('close', () => {
      document.body.classList.remove('dialog-is-open');
      photoLink.focus({ preventScroll: true });
    });
  }

  // Clipboard is best-effort. Never claim success when permissions block copying.
  const copyButton = document.querySelector('[data-copy-profile]');
  const announcement = document.querySelector('[data-announcement]');
  if (copyButton && navigator.clipboard && window.isSecureContext) {
    copyButton.hidden = false;
    const label = copyButton.querySelector('[data-copy-label]');
    const icon = copyButton.querySelector('use');
    let resetTimer;
    copyButton.addEventListener('click', async () => {
      clearTimeout(resetTimer);
      try {
        await navigator.clipboard.writeText(copyButton.dataset.copyProfile);
        if (label) label.textContent = 'Link copied';
        if (icon) icon.setAttribute('href', '#i-check');
        if (announcement) announcement.textContent = 'LinkedIn profile link copied to your clipboard.';
      } catch {
        if (label) label.textContent = 'Use the LinkedIn link above';
        if (announcement) announcement.textContent = 'Copying was blocked. You can use the LinkedIn link above instead.';
      }
      resetTimer = window.setTimeout(() => {
        if (label) label.textContent = 'Copy profile link';
        if (icon) icon.setAttribute('href', '#i-copy');
        if (announcement) announcement.textContent = '';
      }, 4000);
    });
  }

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
})();
