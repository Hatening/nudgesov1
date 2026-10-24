(function () {
  const supported = ['zh', 'zh-CN', 'zh-TW', 'en', 'en-AU', 'ar', 'az', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'es', 'fa', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sv', 'sw', 'th', 'tr', 'uk', 'ur', 'vi'];
  const params = new URLSearchParams(window.location.search);
  const stored = window.localStorage.getItem('relaydesk_locale');
  const requested = String(params.get('lang') || stored || 'zh').toLowerCase().replace('_', '-');
  const exactLocale = supported.find((code) => code.toLowerCase() === requested);
  const baseLocale = requested.split('-')[0];
  const locale = exactLocale || (supported.includes(baseLocale) ? baseLocale : 'zh');
  const rtlLocales = new Set(['ar', 'he', 'fa', 'ur']);
  document.documentElement.lang = locale;
  document.documentElement.dir = rtlLocales.has(locale.split('-')[0]) ? 'rtl' : 'ltr';
  document.body.dataset.locale = locale;

  const copy = {
    en: {
      privacyTitle: 'Privacy notice',
      chatSubtitle: 'NudgeSo · Customer support',
      passwordHint: 'at least 6 characters',
      queueSubtitle: 'Escalation queue',
      privacyText: 'We process your message and basic session data to provide support. Please do not send passwords, card numbers, or government IDs.',
      consent: 'Agree and continue',
      privacyFoot: 'The conversation starts only after consent.',
      placeholder: 'Type a message…',
      send: 'Send',
      voice: 'Voice',
      upload: 'Upload .wav',
      hint: 'If speech is unavailable, use text or upload a .wav recording.',
      footer: 'NudgeSo · Text replies only',
      welcome: 'Hello, welcome. Tell me what you need and I will use the store knowledge to help. Refunds and complaints are handed to the merchant.',
      onboardingSubtitle: 'Merchant onboarding',
      back: 'Back to workspace',
      onboardingHeading: 'Launch your support site, from account to embed code.',
      onboardingLede: 'Create an account → add a site and industry template → upload and confirm knowledge → copy the embed code.',
      onboardingEyebrow: '4 steps · about 5 minutes',
      steps: ['Account', 'Site', 'Knowledge', 'Embed'],
      stepTags: ['Step 1 of 4', 'Step 2 of 4', 'Step 3 of 4', 'Step 4 of 4'],
      authTitle: 'Merchant sign in / register',
      authMuted: 'Register with email and password; an existing email switches to sign-in.',
      email: 'Email',
      password: 'Password',
      authSubmit: 'Register / Sign in',
      siteTitle: 'Create site',
      siteMuted: 'A merchant can create multiple sites; each has its own knowledge and embed code.',
      siteName: 'Site name',
      siteNamePlaceholder: 'e.g. Northstar Goods',
      templates: ['Restaurant', 'Retail shop', 'Clinic', 'Local service', 'Cross-border'],
      template: 'Industry template',
      createSite: 'Create site',
      finish: 'Go to workspace',
      working: 'Working…',
      requiredEmailPassword: 'Email and password are required.',
      requiredSiteName: 'Site name is required.',
      fileTooLarge: 'File must be 1 MB or smaller.',
      requestFailed: 'Request failed.',
      kbReady: 'Ready to check',
      kbConfirmed: 'Confirmed',
      copied: 'Copied',
      copyFailed: 'Copy failed; select the code manually.',
      kbTitle: 'Knowledge upload',
      kbMuted: 'Upload a text file up to 1 MB (.txt / .md). A draft is created and enters the knowledge base only after you confirm it.',
      kbFile: 'Knowledge file',
      kbDraft: 'Knowledge draft',
      kbConfirm: 'Confirm knowledge',
      embedTitle: 'Embed code',
      embedMuted: 'Place this code on your store page or use the standalone link.',
      copy: 'Copy code',
      standalone: 'Standalone page',
      queueHeading: 'Escalation queue',
      queueMuted: 'Complaints, refunds, legal issues, and low-confidence messages arrive here; risk and intent must be visible.',
      refresh: 'Refresh',
      empty: 'No escalations right now',
      emptyHint: 'Complaints and refund requests will appear here.',
      queueHeaders: ['Message', 'Site', 'Lang', 'Intent', 'Risk', 'Status', 'Time', 'Action'],
      labelCustomer: 'Customer message',
      labelSite: 'Site',
      labelLanguage: 'Language',
      labelIntent: 'What they asked',
      labelRisk: 'Priority',
      labelStatus: 'Status',
      labelTime: 'Time',
      labelAction: 'Action',
      riskHigh: 'High',
      riskMedium: 'Medium',
      riskLow: 'Low',
      statusPending: 'Waiting',
      statusInReview: 'In review',
      statusResolved: 'Resolved',
      financial: 'Financial',
      urgent: 'Urgent',
      resolve: 'Mark resolved',
      footnote: 'Data from GET /api/v1/escalations; only the current merchant tenant is shown.'
    },
    ar: {
      privacyTitle: 'إشعار الخصوصية',
      chatSubtitle: 'NudgeSo · دعم العملاء',
      passwordHint: '6 أحرف على الأقل',
      queueSubtitle: 'قائمة التصعيد',
      privacyText: 'نعالج رسالتك وبيانات الجلسة الأساسية لتقديم الدعم. لا ترسل كلمات المرور أو أرقام البطاقات أو أرقام الهوية.',
      consent: 'أوافق وأتابع',
      privacyFoot: 'لن تبدأ المحادثة إلا بعد الموافقة.',
      placeholder: 'اكتب رسالة…',
      send: 'إرسال',
      voice: 'صوت',
      upload: 'رفع .wav',
      hint: 'إذا تعذر التعرف على الصوت، استخدم النص أو ارفع تسجيلاً بصيغة .wav.',
      footer: 'NudgeSo · ردود نصية فقط',
      welcome: 'مرحباً بك. أخبرني بما تحتاجه وسأستخدم معرفة المتجر لمساعدتك. تُحوَّل طلبات الاسترداد والشكاوى إلى التاجر.',
      onboardingSubtitle: 'تأهيل التاجر',
      back: 'العودة إلى مساحة العمل',
      onboardingHeading: 'أطلق موقع الدعم، من الحساب إلى كود التضمين.',
      onboardingLede: 'أنشئ حساباً ← أضف موقعاً وقالب قطاع ← ارفع المعرفة وأكدها ← انسخ كود التضمين.',
      onboardingEyebrow: '4 خطوات · حوالي 5 دقائق',
      steps: ['الحساب', 'الموقع', 'المعرفة', 'التضمين'],
      stepTags: ['الخطوة 1 من 4', 'الخطوة 2 من 4', 'الخطوة 3 من 4', 'الخطوة 4 من 4'],
      authTitle: 'تسجيل دخول / تسجيل التاجر',
      authMuted: 'سجّل بالبريد وكلمة المرور؛ إذا كان البريد موجوداً فسيتم التبديل إلى تسجيل الدخول.',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      authSubmit: 'تسجيل / دخول',
      siteTitle: 'إنشاء موقع',
      siteMuted: 'يمكن للتاجر إنشاء عدة مواقع؛ لكل موقع معرفته وكود التضمين الخاص به.',
      siteName: 'اسم الموقع',
      siteNamePlaceholder: 'مثال: Northstar Goods',
      templates: ['مطعم', 'متجر بيع بالتجزئة', 'عيادة', 'خدمة محلية', 'بيع عبر الحدود'],
      template: 'قالب القطاع',
      createSite: 'إنشاء الموقع',
      finish: 'الانتقال إلى مساحة العمل',
      working: 'جارٍ العمل…',
      requiredEmailPassword: 'البريد الإلكتروني وكلمة المرور مطلوبان.',
      requiredSiteName: 'اسم الموقع مطلوب.',
      fileTooLarge: 'يجب ألا يتجاوز الملف 1 ميغابايت.',
      requestFailed: 'فشل الطلب.',
      kbReady: 'جاهز للمراجعة',
      kbConfirmed: 'تم التأكيد',
      copied: 'تم النسخ',
      copyFailed: 'فشل النسخ؛ حدّد الكود يدوياً.',
      kbTitle: 'رفع المعرفة',
      kbMuted: 'ارفع ملفاً نصياً حتى 1 ميغابايت (.txt / .md). ستُنشأ مسودة ولن تدخل قاعدة المعرفة إلا بعد التأكيد.',
      kbFile: 'ملف المعرفة',
      kbDraft: 'مسودة المعرفة',
      kbConfirm: 'تأكيد المعرفة',
      embedTitle: 'كود التضمين',
      embedMuted: 'ضع هذا الكود في صفحة متجرك أو استخدم الرابط المستقل.',
      copy: 'نسخ الكود',
      standalone: 'صفحة مستقلة',
      queueHeading: 'قائمة التصعيد',
      queueMuted: 'تصل هنا الشكاوى وطلبات الاسترداد والمسائل القانونية والرسائل منخفضة الثقة؛ يجب إظهار المخاطر والنية.',
      refresh: 'تحديث',
      empty: 'لا توجد عناصر تصعيد حالياً',
      emptyHint: 'ستظهر هنا الشكاوى وطلبات الاسترداد.',
      queueHeaders: ['الرسالة', 'الموقع', 'اللغة', 'النية', 'المخاطر', 'الحالة', 'الوقت', 'الإجراء'],
      labelCustomer: 'رسالة العميل',
      labelSite: 'الموقع',
      labelLanguage: 'اللغة',
      labelIntent: 'ما سأل عنه',
      labelRisk: 'الأولوية',
      labelStatus: 'الحالة',
      labelTime: 'الوقت',
      labelAction: 'الإجراء',
      riskHigh: 'مرتفع',
      riskMedium: 'متوسط',
      riskLow: 'منخفض',
      statusPending: 'قيد الانتظار',
      statusInReview: 'قيد المراجعة',
      statusResolved: 'تم الحل',
      financial: 'مالي',
      urgent: 'عاجل',
      resolve: 'تحديد كمعالج',
      footnote: 'البيانات من GET /api/v1/escalations؛ تُعرض فقط عناصر التصعيد الخاصة بالتاجر الحالي.'
    },
    ...(window.NS_UI_LOCALES || {})
  };

  function text(selector, value) {
    const node = document.querySelector(selector);
    if (node && value) node.textContent = value;
  }

  function placeholder(selector, value) {
    const node = document.querySelector(selector);
    if (node && value) node.setAttribute('placeholder', value);
  }

  function apply(locale) {
    const dict = copy[locale] || copy[locale.split('-')[0]];
    if (!dict) return;
    const page = document.body.dataset.page;
    if (page === 'chat') {
      text('.chat-brand small', dict.chatSubtitle);
      text('#privacyTitle', dict.privacyTitle);
      text('#privacyText', dict.privacyText);
      text('#consentButton', dict.consent);
      text('.privacy-foot', dict.privacyFoot);
      placeholder('#messageInput', dict.placeholder);
      text('#sendButton .lbl', dict.send);
      text('#voiceButton .lbl', dict.voice);
      text('#uploadVoiceButton .lbl', dict.upload);
      text('.composer-hint', dict.hint);
      text('.chat-footer', dict.footer);
      const welcome = document.querySelector('#messages .message[data-segment="welcome"]');
      if (welcome) {
        const meta = welcome.querySelector('.message-meta');
        welcome.firstChild.textContent = dict.welcome + ' ';
        if (meta) meta.textContent = 'NudgeSo · Auto greeting';
      }
      document.title = 'NudgeSo Support';
    } else if (page === 'onboarding') {
      text('.brand small', dict.onboardingSubtitle);
      text('.back-link', dict.back);
      text('.intro .eyebrow', dict.onboardingEyebrow);
      text('.intro h1', dict.onboardingHeading);
      text('.lede', dict.onboardingLede);
      if (dict.stepTags) {
        document.querySelectorAll('.step-tag').forEach((tag, index) => {
          if (dict.stepTags[index]) tag.textContent = dict.stepTags[index];
        });
      }
      if (dict.steps) {
        document.querySelectorAll('.steps li').forEach((li, index) => {
          if (!dict.steps[index]) return;
          const span = li.querySelector('span');
          if (span) span.textContent = String(index + 1);
          [...li.childNodes].filter((node) => node.nodeType === 3).forEach((node) => node.remove());
          li.appendChild(document.createTextNode(dict.steps[index]));
        });
      }
      text('#authTitle', dict.authTitle);
      text('#authPanel .muted', dict.authMuted);
      placeholder('#password', dict.passwordHint);
      text('label[for="email"]', dict.email);
      text('label[for="password"]', dict.password);
      text('#authSubmit', dict.authSubmit);
      text('#siteTitle', dict.siteTitle);
      text('#sitePanel .muted', dict.siteMuted);
      text('label[for="siteName"]', dict.siteName);
      placeholder('#siteName', dict.siteNamePlaceholder);
      if (dict.templates) {
        document.querySelectorAll('.template').forEach((button, index) => {
          if (!dict.templates[index]) return;
          [...button.childNodes].filter((node) => node.nodeType === 3).forEach((node) => node.remove());
          button.appendChild(document.createTextNode(dict.templates[index]));
        });
      }
      text('#sitePanel h3', dict.template);
      text('#createSite', dict.createSite);
      text('#kbTitle', dict.kbTitle);
      text('#kbPanel .muted', dict.kbMuted);
      text('label[for="kbFile"]', dict.kbFile);
      text('#kbDraft h3', dict.kbDraft);
      text('#kbConfirm .lbl', dict.kbConfirm);
      text('#embedTitle', dict.embedTitle);
      text('#embedPanel .muted', dict.embedMuted);
      text('#copyEmbed .lbl', dict.copy);
      text('#finishOnboarding', dict.finish);
      const standalone = document.querySelector('.standalone');
      if (standalone) {
        const link = standalone.querySelector('#standaloneUrl');
        standalone.firstChild.textContent = dict.standalone + ': ';
        if (link) link.setAttribute('aria-label', dict.standalone);
      }
      document.title = 'NudgeSo — Merchant onboarding';
    } else if (page === 'queue') {
      text('.brand small', dict.queueSubtitle);
      text('.back-link', dict.back);
      text('.page-head h1', dict.queueHeading);
      text('.page-head .muted', dict.queueMuted);
      text('#refreshButton .lbl', dict.refresh);
      text('#emptyState strong', dict.empty);
      text('#emptyState p', dict.emptyHint);
      text('#emptyState a.btn', dict.back);
      text('.footnote', dict.footnote);
      const headers = document.querySelectorAll('.queue-table thead th');
      headers.forEach((th, index) => {
        if (dict.queueHeaders[index]) th.textContent = dict.queueHeaders[index];
      });
      document.title = 'NudgeSo — Escalation queue';
    }
  }

  function addSwitcher() {
    const host = document.querySelector('header') || document.querySelector('.topbar');
    if (!host || document.querySelector('.language-switch')) return;
    const select = document.createElement('select');
    select.className = 'language-switch';
    select.setAttribute('aria-label', 'Language / اللغة / 语言');
    [['zh', 'ZH'], ['zh-CN', 'ZH-CN'], ['zh-TW', 'ZH-TW'], ['en', 'EN'], ['en-AU', 'EN-AU'], ['ar', 'AR'], ['az', 'AZ'], ['bg', 'BG'], ['bn', 'BN'], ['cs', 'CS'], ['da', 'DA'], ['de', 'DE'], ['el', 'EL'], ['es', 'ES'], ['fa', 'FA'], ['fr', 'FR'], ['he', 'HE'], ['hi', 'HI'], ['hr', 'HR'], ['hu', 'HU'], ['id', 'ID'], ['it', 'IT'], ['ja', 'JA'], ['ko', 'KO'], ['ms', 'MS'], ['nl', 'NL'], ['no', 'NO'], ['pl', 'PL'], ['pt-BR', 'PT-BR'], ['pt-PT', 'PT-PT'], ['ro', 'RO'], ['ru', 'RU'], ['sk', 'SK'], ['sv', 'SV'], ['sw', 'SW'], ['th', 'TH'], ['tr', 'TR'], ['uk', 'UK'], ['ur', 'UR'], ['vi', 'VI']].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      if (value === locale) option.selected = true;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      window.localStorage.setItem('relaydesk_locale', select.value);
      const url = new URL(window.location.href);
      url.searchParams.set('lang', select.value);
      window.location.assign(url.toString());
    });
    host.appendChild(select);
  }

  apply(locale);
  window.relaydeskI18n = {
    locale,
    t: (key) => copy[locale]?.[key] || copy[locale.split('-')[0]]?.[key] || key
  };
  addSwitcher();
})();
