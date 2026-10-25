/* NudgeSo marketing site — main.js (vanilla JS) */
(function () {
  'use strict';

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

  function renderBilling() {
    sw.classList.toggle('yearly', yearly);
    sw.setAttribute('aria-checked', String(yearly));
    optM.classList.toggle('active', !yearly);
    optY.classList.toggle('active', yearly);
    saveNote.hidden = !yearly;
    proPrice.textContent = yearly ? '15' : '19';
    proBilling.textContent = yearly
      ? '$15 / month · billed annually'
      : '$19 / month · billed monthly';
    if (bizPrice) bizPrice.textContent = yearly ? '39' : '49';
    if (bizBilling) bizBilling.textContent = yearly
      ? '$39 / month · billed annually'
      : '$49 / month · billed monthly';
  }
  sw.addEventListener('click', function () { yearly = !yearly; renderBilling(); });
  renderBilling();

  /* ---------- FAQ accordion ---------- */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    var btn = item.querySelector('.faq-q');
    var panel = item.querySelector('.faq-a');
    btn.addEventListener('click', function () {
      var open = item.getAttribute('aria-expanded') === 'true';
      item.setAttribute('aria-expanded', String(!open));
      btn.setAttribute('aria-expanded', String(!open));
      panel.style.maxHeight = open ? null : panel.scrollHeight + 'px';
    });
  });

  /* ---------- AI chat demo carousel ---------- */
  var demoLocales = window.NS_DEMO_LOCALES || {};
  var localeCodes = Object.keys(demoLocales);
  var localeLookup = {};
  localeCodes.forEach(function (code) { localeLookup[code.toLowerCase()] = code; });
  var demoWrap = document.getElementById('demoCarousel');
  var demoThread = document.getElementById('demoThread');
  var demoScenarios = document.getElementById('demoScenarios');
  var demoLocale = document.getElementById('demoLocale');
  var demoTitle = document.getElementById('demoTitle');
  var demoSubtitle = document.getElementById('demoSubtitle');
  var demoLocaleLabel = document.getElementById('demoLocaleLabel');
  var demoStatus = document.getElementById('demoStatus');
  var demoPrev = document.getElementById('demoPrev');
  var demoNext = document.getElementById('demoNext');
  var demoPlayPause = document.getElementById('demoPlayPause');
  var draftBtn = document.getElementById('draftBtn');
  var approveRow = document.getElementById('approveRow');
  var approveBtn = document.getElementById('approveBtn');
  var regenerateBtn = document.getElementById('regenerateBtn');
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var playing = !reduceMotion;
  var pausedByUser = false;
  var hovering = false;
  var demoVisible = true;
  var scenarioIndex = 0;
  var autoTimer = null;
  var typingTimer = null;
  var activeDraft = null;
  var currentDemo = null;
  var currentLocale = 'en';
  var rtlLocales = ['ar', 'he', 'fa', 'ur'];

  if (!demoWrap || !demoThread || !demoScenarios || !demoLocale || !localeCodes.length) return;

  function pickLocale(value) {
    var code = String(value || '').toLowerCase().replace('_', '-');
    if (localeLookup[code]) return localeLookup[code];
    var base = code.split('-')[0];
    if (localeLookup[base]) return localeLookup[base];
    return demoLocales.en ? 'en' : localeCodes[0];
  }

  function clearTimers() {
    clearTimeout(autoTimer);
    clearTimeout(typingTimer);
    autoTimer = null;
    typingTimer = null;
  }

  function setText(node, value) {
    if (node && value) node.textContent = value;
  }

  function setPlayUi() {
    demoWrap.dataset.autoplay = (!reduceMotion && playing && !pausedByUser) ? 'on' : 'off';
    demoPlayPause.setAttribute('aria-pressed', String(!reduceMotion && playing && !pausedByUser));
    demoPlayPause.setAttribute('aria-label', playing ? currentDemo.controls.pause : currentDemo.controls.play);
    demoPlayPause.textContent = playing ? 'Ⅱ' : '▶';
  }

  function scheduleNext() {
    clearTimeout(autoTimer);
    autoTimer = null;
    if (reduceMotion || !playing || pausedByUser || hovering || !demoVisible || document.hidden) return;
    var scenario = currentDemo.scenarios[scenarioIndex];
    if (!scenario) return;
    autoTimer = setTimeout(function () {
      autoTimer = null;
      if (!playing || pausedByUser || hovering || !demoVisible || document.hidden) return;
      renderScenario((scenarioIndex + 1) % currentDemo.scenarios.length);
    }, 4200);
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
      if (i < text.length) typingTimer = setTimeout(step, 16);
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
    var replyMeta = currentDemo.controls.draftMeta;
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
    var customerText = demoThread.querySelector('.demo-customer-text');
    var customerMeta = demoThread.querySelector('.demo-customer-meta');
    var replyText = demoThread.querySelector('.demo-reply-text');
    var replyMetaNode = demoThread.querySelector('.demo-reply-meta');
    setText(customerText, scenario.customer);
    setText(customerMeta, scenario.customerMeta);
    setText(replyMetaNode, replyMeta);
    activeDraft = demoThread.querySelector('#demoReply');
    draftBtn.disabled = false;
    setText(draftBtn, currentDemo.controls.draft);
    setText(approveBtn, currentDemo.controls.approve);
    setText(regenerateBtn, currentDemo.controls.regenerate);
    approveRow.hidden = true;
    setPlayUi();
    if (reduceMotion) {
      setText(replyText, scenario.reply);
      setText(replyMetaNode, scenario.replyMeta);
      approveRow.hidden = false;
      return;
    }
    typeReply(replyText, scenario.reply, function () {
      setText(replyMetaNode, scenario.replyMeta);
      approveRow.hidden = false;
      scheduleNext();
    });
  }

  function applyLocale(locale) {
    currentLocale = locale;
    currentDemo = demoLocales[locale] || demoLocales.en;
    demoWrap.dataset.locale = locale;
    demoWrap.dir = rtlLocales.indexOf(locale.split('-')[0]) >= 0 ? 'rtl' : 'ltr';
    demoLocale.value = locale;
    setText(demoTitle, currentDemo.title);
    setText(demoSubtitle, currentDemo.subtitle);
    setText(demoLocaleLabel, currentDemo.localeLabel);
    demoLocale.setAttribute('aria-label', currentDemo.localeLabel);
    demoScenarios.setAttribute('aria-label', currentDemo.scenarioLabel);
    updateScenarioTabs();
    renderScenario(0);
  }

  Object.keys(demoLocales).forEach(function (code) {
    var option = document.createElement('option');
    option.value = code;
    option.textContent = code.toUpperCase();
    demoLocale.appendChild(option);
  });

  var queryLang = new URLSearchParams(window.location.search).get('demoLang');
  var savedLang = '';
  try { savedLang = localStorage.getItem('nudgeso_demo_locale') || ''; } catch (e) {}
  currentLocale = pickLocale(queryLang || savedLang || 'en');
  applyLocale(currentLocale);

  demoLocale.addEventListener('change', function () {
    var next = pickLocale(demoLocale.value);
    try { localStorage.setItem('nudgeso_demo_locale', next); } catch (e) {}
    applyLocale(next);
  });

  demoScenarios.addEventListener('click', function (event) {
    var button = event.target.closest('.demo-scenario');
    if (!button) return;
    renderScenario(Number(button.dataset.index) || 0);
  });

  demoPrev.addEventListener('click', function () {
    renderScenario(scenarioIndex - 1);
  });

  demoNext.addEventListener('click', function () {
    renderScenario(scenarioIndex + 1);
  });

  demoPlayPause.addEventListener('click', function () {
    if (reduceMotion) return;
    playing = !playing;
    pausedByUser = !playing;
    setPlayUi();
    if (playing) scheduleNext();
    else clearTimeout(autoTimer);
  });

  draftBtn.addEventListener('click', function () {
    renderScenario(scenarioIndex);
  });

  regenerateBtn.addEventListener('click', function () {
    renderScenario(scenarioIndex);
  });

  approveBtn.addEventListener('click', function () {
    if (!activeDraft) return;
    activeDraft.classList.add('approved');
    var scenario = currentDemo.scenarios[scenarioIndex];
    setText(activeDraft.querySelector('.demo-reply-meta'), scenario.approvedMeta);
    setText(demoStatus, scenario.approvedMeta);
    approveBtn.classList.add('approved');
    setTimeout(function () { approveBtn.classList.remove('approved'); }, 1200);
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
    var observer = new IntersectionObserver(function (entries) {
      demoVisible = entries.some(function (entry) { return entry.isIntersecting; });
      if (demoVisible) scheduleNext();
      else clearTimeout(autoTimer);
    }, { threshold: 0.2 });
    observer.observe(demoWrap);
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
