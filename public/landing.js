/* NudgeSo marketing site — vanilla JS */
(function () {
  'use strict';

  var landingLocales = window.NS_LANDING_LOCALES || {};
  var demoLocales = window.NS_DEMO_LOCALES || {};
  var localeCodes = Object.keys(landingLocales);
  var localeLookup = {};
  localeCodes.forEach(function (code) { localeLookup[code.toLowerCase()] = code; });
  var rtlLocales = ['ar', 'he', 'fa', 'ur'];
  var currentLocale = 'en';
  var currentCopy = landingLocales.en || {};

  /* ---------- Navbar scroll state ---------- */
  var navbar = document.getElementById('navbar');
  function onScroll() {
    if (window.scrollY > 12) navbar.classList.add('scrolled');
    else navbar.classList.remove('scrolled');
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Billing toggle ---------- */
  var sw = document.getElementById('billingSwitch');
  var optM = document.getElementById('optMonthly');
  var optY = document.getElementById('optYearly');
  var saveNote = document.getElementById('saveNote');
  var proPrice = document.getElementById('proPrice');
  var proBilling = document.getElementById('proBilling');
  var bizPrice = document.getElementById('bizPrice');
  var bizBilling = document.getElementById('bizBilling');
  var yearly = false;
  var TYPE_INTERVAL_MS = 23;
  var AUTO_ADVANCE_MS = 5880;

  function renderBilling() {
    var pro = currentCopy.proPlan || {};
    var business = currentCopy.businessPlan || {};
    sw.classList.toggle('yearly', yearly);
    sw.setAttribute('aria-checked', String(yearly));
    optM.classList.toggle('active', !yearly);
    optY.classList.toggle('active', yearly);
    saveNote.hidden = !yearly;
    proPrice.textContent = yearly ? '15' : '19';
    proBilling.textContent = yearly ? pro.billingYearly : pro.billingMonthly;
    if (bizPrice) bizPrice.textContent = yearly ? '39' : '49';
    if (bizBilling) bizBilling.textContent = yearly ? business.billingYearly : business.billingMonthly;
  }
  sw.addEventListener('click', function () { yearly = !yearly; renderBilling(); });

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    var btn = item.querySelector('.faq-q');
    var panel = item.querySelector('.faq-a');
    btn.addEventListener('click', function () {
      var open = item.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      panel.style.maxHeight = open ? null : panel.scrollHeight + 'px';
    });
  });

  /* ---------- Landing copy helpers ---------- */
  function root(selector) { return document.querySelector(selector); }
  function roots(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function setText(selector, value) {
    var node = typeof selector === 'string' ? root(selector) : selector;
    if (node && value) node.textContent = value;
  }
  function setList(selector, values) {
    roots(selector).forEach(function (node, index) {
      if (values && values[index]) node.textContent = values[index];
    });
  }
  function setLeadingText(node, value) {
    if (!node || !value) return;
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 3) node.removeChild(child);
    });
    node.appendChild(document.createTextNode(value));
  }
  function setPlanCard(card, plan) {
    if (!card || !plan) return;
    setText(card.querySelector('h3'), plan.name);
    setText(card.querySelector('.billing'), plan.billing);
    setText(card.querySelector('.badge'), plan.badge);
    setText(card.querySelector('a.btn'), plan.cta);
    var items = card.querySelectorAll('ul li');
    (plan.features || []).forEach(function (feature, index) {
      if (items[index]) setLeadingText(items[index], feature);
    });
  }
  function applyPageLocale(locale) {
    currentLocale = locale;
    currentCopy = landingLocales[locale] || landingLocales.en || {};
    var copy = currentCopy;
    document.documentElement.lang = locale;
    document.documentElement.dir = rtlLocales.indexOf(locale.split('-')[0]) >= 0 ? 'rtl' : 'ltr';
    if (copy.metaTitle) document.title = copy.metaTitle;
    var description = root('meta[name="description"]');
    if (description && copy.metaDescription) description.setAttribute('content', copy.metaDescription);
    setList('.nav-links a', copy.nav);
    setList('.foot-links a', copy.nav);
    setList('.legal-links a', [copy.privacy, copy.terms]);
    setText('.nav-actions .signin', copy.signIn);
    setText('.nav-actions > .btn-primary', copy.startFree);
    setText('.hero .eyebrow', copy.heroEyebrow);
    setText('.hero h1', copy.heroTitle);
    setText('.hero .sub', copy.heroSub);
    setText('.cta-row .btn-primary', copy.startFree);
    setText('.cta-row .btn-outline', copy.signIn);
    setText('#product .section-head h2', copy.featuresTitle);
    setText('#product .section-head p', copy.featuresSub);
    roots('.features-grid .feature-card').forEach(function (card, index) {
      var feature = (copy.features || [])[index] || {};
      setText(card.querySelector('h3'), feature.title);
      setText(card.querySelector('p'), feature.body);
    });
    setText('#how .section-head h2', copy.howTitle);
    setText('#how .section-head p', copy.howSub);
    roots('.how-step').forEach(function (step, index) {
      var item = (copy.howSteps || [])[index] || {};
      setText(step.querySelector('h3'), item.title);
      setText(step.querySelector('p'), item.body);
    });
    setText('#pricing .section-head h2', copy.pricingTitle);
    setText('#pricing .section-head p', copy.pricingSub);
    setText('#optMonthly', copy.monthly);
    setText('#optYearly', copy.yearly);
    setText('#saveNote', copy.saveNote);
    var cards = roots('.pricing-grid .price-card');
    setPlanCard(cards[0], copy.freePlan);
    setPlanCard(cards[1], copy.proPlan);
    setPlanCard(cards[2], copy.businessPlan);
    setText('.pricing-note', copy.pricingNote);
    setText('#faq .section-head h2', copy.faqTitle);
    roots('.faq-item').forEach(function (item, index) {
      var faq = (copy.faqs || [])[index] || {};
      var question = item.querySelector('.faq-q');
      if (question && faq.q) {
        Array.prototype.slice.call(question.childNodes).forEach(function (child) {
          if (child.nodeType === 3) question.removeChild(child);
        });
        question.insertBefore(document.createTextNode(faq.q + ' '), question.firstChild);
      }
      setText(item.querySelector('.faq-a p'), faq.a);
    });
    setText('.final-cta h2', copy.finalTitle);
    setText('.final-cta p', copy.finalSub);
    setText('.final-cta a.btn', copy.finalCta);
    setText('.foot-url', copy.footerTag);
    renderBilling();
    var siteLang = root('#siteLang');
    if (siteLang) siteLang.value = locale;
  }

  /* ---------- AI chat demo carousel ---------- */
  var demoWrap = document.getElementById('demoCarousel');
  var demoThread = document.getElementById('demoThread');
  var demoScenarios = document.getElementById('demoScenarios');
  var demoTitle = document.getElementById('demoTitle');
  var demoSubtitle = document.getElementById('demoSubtitle');
  var demoStatus = document.getElementById('demoStatus');
  var demoPrev = document.getElementById('demoPrev');
  var demoNext = document.getElementById('demoNext');
  var demoPlayPause = document.getElementById('demoPlayPause');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var playing = !reduceMotion;
  var pausedByUser = false;
  var hovering = false;
  var demoVisible = true;
  var scenarioIndex = 0;
  var autoTimer = null;
  var typingTimer = null;
  var currentDemo = demoLocales.en;
  var demoLocaleCodes = Object.keys(demoLocales);

  if (!demoWrap || !demoThread || !demoScenarios || !demoLocaleCodes.length) return;

  function pickLocale(value) {
    var code = String(value || '').toLowerCase().replace('_', '-');
    if (localeLookup[code]) return localeLookup[code];
    var base = code.split('-')[0];
    if (localeLookup[base]) return localeLookup[base];
    return landingLocales.en ? 'en' : localeCodes[0];
  }

  function clearTimers() {
    clearTimeout(autoTimer);
    clearTimeout(typingTimer);
    autoTimer = null;
    typingTimer = null;
  }

  function setPlayUi() {
    demoWrap.dataset.autoplay = (!reduceMotion && playing && !pausedByUser) ? 'on' : 'off';
    demoPlayPause.setAttribute('aria-pressed', String(!reduceMotion && playing && !pausedByUser));
    demoPlayPause.setAttribute('aria-label', playing ? currentDemo.controls.pause : currentDemo.controls.play);
    demoPlayPause.innerHTML = playing
      ? '<span class="pause-bars" aria-hidden="true"><span></span><span></span></span>'
      : '<span class="play-triangle" aria-hidden="true"></span>';
  }

  function scheduleNext() {
    clearTimeout(autoTimer);
    autoTimer = null;
    if (reduceMotion || !playing || pausedByUser || hovering || !demoVisible || document.hidden) return;
    if (!currentDemo.scenarios[scenarioIndex]) return;
    autoTimer = setTimeout(function () {
      autoTimer = null;
      if (!playing || pausedByUser || hovering || !demoVisible || document.hidden) return;
      renderScenario((scenarioIndex + 1) % currentDemo.scenarios.length);
    }, AUTO_ADVANCE_MS);
  }

  function updateScenarioTabs() {
    demoScenarios.querySelectorAll('.demo-scenario').forEach(function (button, index) {
      var active = index === scenarioIndex;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      setText(button, currentDemo.scenarios[index].tab);
    });
  }

  function typeReply(node, text, onDone) {
    var i = 0;
    node.textContent = '';
    (function step() {
      i = Math.min(text.length, i + 2);
      node.textContent = text.slice(0, i);
      if (i < text.length) typingTimer = setTimeout(step, TYPE_INTERVAL_MS);
      else {
        typingTimer = null;
        if (onDone) onDone();
      }
    })();
  }

  function renderScenario(index) {
    clearTimers();
    scenarioIndex = ((index % currentDemo.scenarios.length) + currentDemo.scenarios.length) % currentDemo.scenarios.length;
    var scenario = currentDemo.scenarios[scenarioIndex];
    updateScenarioTabs();
    demoStatus.textContent = scenario.tab;
    demoThread.innerHTML =
      '<div class="bubble-row demo-enter">' +
        '<div class="avatar cust">M</div>' +
        '<div class="bubble cust"><span class="demo-customer-text"></span><div class="meta demo-customer-meta"></div></div>' +
      '</div>' +
      '<div class="bubble-row right demo-enter">' +
        '<div class="avatar ai"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="10" r="1.6" fill="#fff"/><circle cx="15" cy="10" r="1.6" fill="#fff"/><path d="M8 14q4 4 8 0" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg></div>' +
        '<div class="bubble ai-b" id="demoReply"><span class="demo-reply-text"></span><div class="meta demo-reply-meta"></div></div>' +
      '</div>';
    var replyText = demoThread.querySelector('.demo-reply-text');
    var replyMetaNode = demoThread.querySelector('.demo-reply-meta');
    setText(demoThread.querySelector('.demo-customer-text'), scenario.customer);
    setText(demoThread.querySelector('.demo-customer-meta'), scenario.customerMeta);
    setText(replyMetaNode, currentDemo.controls.draftMeta);
    setPlayUi();
    if (reduceMotion) {
      setText(replyText, scenario.reply);
      setText(replyMetaNode, scenario.replyMeta);
      return;
    }
    typeReply(replyText, scenario.reply, function () {
      setText(replyMetaNode, scenario.replyMeta);
      scheduleNext();
    });
  }

  function applyDemoLocale(locale) {
    currentDemo = demoLocales[locale] || demoLocales.en;
    demoWrap.dataset.locale = locale;
    demoWrap.dir = rtlLocales.indexOf(locale.split('-')[0]) >= 0 ? 'rtl' : 'ltr';
    setText(demoTitle, currentDemo.title);
    setText(demoSubtitle, currentDemo.subtitle);
    if (siteLang) siteLang.setAttribute('aria-label', 'Language');
    demoScenarios.setAttribute('aria-label', currentDemo.scenarioLabel);
    demoPrev.textContent = demoWrap.dir === 'rtl' ? '→' : '←';
    demoNext.textContent = demoWrap.dir === 'rtl' ? '←' : '→';
    updateScenarioTabs();
    renderScenario(0);
  }

  function syncInternalLocaleLinks(locale) {
    var linked = roots('a[href^="/onboarding.html"], a[href^="/login.html"]');
    linked.forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href) return;
      var url = new URL(href, window.location.origin);
      url.searchParams.set('lang', locale);
      link.setAttribute('href', url.pathname + url.search + url.hash);
    });
  }

  function applySiteLocale(locale) {
    applyPageLocale(locale);
    applyDemoLocale(locale);
    try {
      localStorage.setItem('nudgeso_site_locale', locale);
      localStorage.setItem('relaydesk_locale', locale);
    } catch (e) {}
    syncInternalLocaleLinks(locale);
  }

  /* ---------- Site language selector ---------- */
  var siteLang = document.getElementById('siteLang');
  if (!siteLang) return;
  localeCodes.forEach(function (code) {
    var option = document.createElement('option');
    option.value = code;
    option.textContent = code.toUpperCase();
    siteLang.appendChild(option);
  });
  var queryLang = new URLSearchParams(window.location.search).get('lang');
  var savedLang = '';
  var savedAppLang = '';
  try {
    savedLang = localStorage.getItem('nudgeso_site_locale') || '';
    savedAppLang = localStorage.getItem('relaydesk_locale') || '';
  } catch (e) {}
  currentLocale = pickLocale(queryLang || savedAppLang || savedLang || 'en');
  applySiteLocale(currentLocale);
  siteLang.addEventListener('change', function () {
    applySiteLocale(pickLocale(siteLang.value));
  });

  demoScenarios.addEventListener('click', function (event) {
    var button = event.target.closest('.demo-scenario');
    if (!button) return;
    renderScenario(Number(button.dataset.index) || 0);
  });
  demoPrev.addEventListener('click', function () { renderScenario(scenarioIndex - 1); });
  demoNext.addEventListener('click', function () { renderScenario(scenarioIndex + 1); });
  demoPlayPause.addEventListener('click', function () {
    if (reduceMotion) return;
    playing = !playing;
    pausedByUser = !playing;
    setPlayUi();
    if (playing) scheduleNext();
    else clearTimeout(autoTimer);
  });

  demoWrap.addEventListener('pointerenter', function () {
    hovering = true;
    clearTimeout(autoTimer);
  });
  demoWrap.addEventListener('pointerleave', function () {
    hovering = false;
    scheduleNext();
  });
  demoWrap.addEventListener('focusin', function () {
    hovering = true;
    clearTimeout(autoTimer);
  });
  demoWrap.addEventListener('focusout', function (event) {
    if (!demoWrap.contains(event.relatedTarget)) {
      hovering = false;
      scheduleNext();
    }
  });
  document.addEventListener('visibilitychange', function () {
    demoVisible = !document.hidden;
    if (demoVisible) scheduleNext();
    else clearTimeout(autoTimer);
  });
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      demoVisible = entries.some(function (entry) { return entry.isIntersecting; });
      if (demoVisible) scheduleNext();
      else clearTimeout(autoTimer);
    }, { threshold: 0.2 }).observe(demoWrap);
  }
  if (window.matchMedia) {
    var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener('change', function (event) {
        reduceMotion = event.matches;
        if (reduceMotion) {
          playing = false;
          pausedByUser = true;
          clearTimers();
          renderScenario(scenarioIndex);
        } else {
          playing = true;
          pausedByUser = false;
          setPlayUi();
        }
      });
    }
  }
})();
