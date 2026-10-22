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

  /* ---------- AI chat demo typewriter ---------- */
  var drafts = [
    "I'm sorry about the wait, Maya — I've located order #4821 and it's arriving by Wednesday. Want me to email you a tracking link now?",
    "Thanks for your patience, Maya. I found order #4821 — it just left our warehouse and should land by Wednesday. Shall I send the tracking details to your inbox?",
    "Hi Maya, I checked order #4821 for you. It's on its way and due to arrive this Wednesday. I'm happy to forward a live tracking link if that helps."
  ];
  var thread = document.getElementById('demoThread');
  var draftBtn = document.getElementById('draftBtn');
  var approveRow = document.getElementById('approveRow');
  var approveBtn = document.getElementById('approveBtn');
  var regenerateBtn = document.getElementById('regenerateBtn');
  var draftIndex = 0;
  var typingTimer = null;

  function existingDraftBubble() {
    return thread.querySelector('.bubble.draft-bubble');
  }

  function typeBubble(bubble, text, done) {
    var span = bubble.querySelector('span');
    var i = 0;
    bubble.classList.add('typing-cursor');
    (function step() {
      i++;
      span.textContent = text.slice(0, i);
      if (i < text.length) {
        typingTimer = setTimeout(step, 18);
      } else {
        bubble.classList.remove('typing-cursor');
        done && done();
      }
    })();
  }

  function startDraft() {
    clearTimeout(typingTimer);
    var old = existingDraftBubble();
    if (old) old.closest('.bubble-row').remove();

    var row = document.createElement('div');
    row.className = 'bubble-row right';
    row.innerHTML =
      '<div class="avatar ai"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="10" r="1.6" fill="#fff"/><circle cx="15" cy="10" r="1.6" fill="#fff"/><path d="M8 14q4 4 8 0" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg></div>' +
      '<div class="bubble ai-b draft-bubble"><span></span><div class="meta">Draft · not sent yet</div></div>';
    thread.appendChild(row);
    var bubble = row.querySelector('.bubble');
    draftBtn.disabled = true;
    draftBtn.textContent = 'Drafting…';
    typeBubble(bubble, drafts[draftIndex % drafts.length], function () {
      draftBtn.disabled = false;
      draftBtn.textContent = 'See how AI drafts a reply';
      approveRow.hidden = false;
      bubble.classList.remove('approved');
    });
  }

  draftBtn.addEventListener('click', startDraft);

  regenerateBtn.addEventListener('click', function () {
    draftIndex++;
    startDraft();
  });

  approveBtn.addEventListener('click', function () {
    var b = existingDraftBubble();
    if (!b) return;
    b.classList.add('approved');
    b.querySelector('.meta').textContent = 'Approved · ready to send';
    approveBtn.innerHTML = 'Approved <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-2px;"><path d="M5 13l4 4L19 7"/></svg>';
    setTimeout(function () { approveBtn.textContent = 'Approve'; }, 1600);
  });
})();
