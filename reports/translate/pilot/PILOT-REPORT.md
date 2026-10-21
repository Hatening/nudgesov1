# 全球语言 Pilot 翻译报告

- 时间：2026-10-21T12:23:36.562Z
- 本地模型：`qwen3.8-35b-a3b@q5_k_m`（http://192.168.3.227:3679/v1）
- 语言映射：`config/language_mapping.json`（71 种语言）
- 测试卡：3 张
- 测试语种：es-ES(Tier1)、pl-PL(Tier2)、sw-KE(Tier3)、fa-IR(Tier3)

## 结果总览

| 卡片 | 语种 | Tier | 结果 | 失败项 | 字段Key一致 | 译文长度 |
|---|---|---|---|---|---|---|
| kb_607acbe2e77d988… | es-ES | 1 | local_ok | — | ✅ | 609 |
| kb_607acbe2e77d988… | pl-PL | 2 | cloud_retry_pool | ENTITY_MISSING | ✅ | 580 |
| kb_607acbe2e77d988… | sw-KE | 3 | local_needs_cloud_review | — | ✅ | 599 |
| kb_607acbe2e77d988… | fa-IR | 3 | locale_needs_cloud | ENTITY_MISSING | ✅ | 515 |
| kb_2b01d3254a47bb1… | es-ES | 1 | local_ok | — | ✅ | 332 |
| kb_2b01d3254a47bb1… | pl-PL | 2 | cloud_retry_pool | LOCAL_ERROR | ❌ | 0 |
| kb_2b01d3254a47bb1… | sw-KE | 3 | local_needs_cloud_review | — | ✅ | 348 |
| kb_2b01d3254a47bb1… | fa-IR | 3 | local_needs_cloud_review | — | ✅ | 305 |
| kb_wixqa_69ef1e344… | es-ES | 1 | local_ok | — | ✅ | 2381 |
| kb_wixqa_69ef1e344… | pl-PL | 2 | local_ok | — | ✅ | 2255 |
| kb_wixqa_69ef1e344… | sw-KE | 3 | local_needs_cloud_review | — | ✅ | 2257 |
| kb_wixqa_69ef1e344… | fa-IR | 3 | locale_needs_cloud | ENTITY_MISSING | ✅ | 2040 |

## 卡片：服装退货的检验分级为什么不能采用通用标准？

原文（节选）：
```text
服装具有高度主观性和SKU差异性，不同品类、价格带和季节对“可售状态”的定义不同。例如一件120美元的羊绒衫比15美元的基础款T恤需要更严格的检验标准。品牌应支持按SKU、类别和商品状况自定义最多3级检验步骤，确保分级结果与自身质量门槛一致，避免误判导致库存损失或客诉。
```

### pl-PL（Tier 2）— cloud_retry_pool

```json
{
  "id": "kb_607acbe2e77d988a",
  "title": "Dlaczego klasyfikacja kontroli zwrotów odzieży nie może opierać się na uniwersalnych standardach?",
  "content": "Odzież charakteryzuje się wysoką subiektywnością i różnorodnością SKU, a różne kategorie, przedziały cenowe i sezony definiują „stan nadający się do sprzedaży” w odmienny sposób. Na przykład wełniany sweter za 120 USD wymaga bardziej rygorystycznych standardów kontroli niż podstawowy T-shirt za 15 USD. Marki powinny wspierać dostosowanie do maksymalnie trzech poziomów kontroli na podstawie SKU, kategorii i stanu produktu, co zapewnia zgodność wyników klasyfikacji z własnymi progami jakości i zapobiega błędnym ocenom prowadzącym do strat magazynowych lub reklamacji klientów.",
  "tags": [
    "Standardy kontroli jakości",
    "Zarządzanie SKU",
    "Cechy odzieży"
  ],
  "category": "退货与退款"
}
```

### sw-KE（Tier 3）— local_needs_cloud_review

```json
{
  "id": "kb_607acbe2e77d988a",
  "title": "Kwa nini uainishaji wa ukaguzi wa kurudishiwa vazi hauwezi kutumia viwango vya jumla?",
  "content": "Vazi lina ubinafsi mkubwa na tofauti za SKU, na aina tofauti za bidhaa, kanda za bei, na majira ya mwaka hufafanua 'hali inayoweza kuuzwa' kwa njia tofauti. Kwa mfano, nguo moja ya cashmere yenye thamani ya $120 inahitaji viwango vya ukaguzi vilivyokamilika zaidi kuliko T-shati ya msingi yenye thamani ya $15. Chapa zinapaswa kusaidia kubinafsisha hatua za ukaguzi hadi kiwango cha juu cha 3 kulingana na SKU, aina, na hali ya bidhaa, ili kuhakikisha matokeo ya uainishaji yanalingana na viwango vyao vya ubora, na kuepuka makosa ya ukaguzi yanayosababisha hasara ya hazina au malalamiko ya wateja.",
  "tags": [
    "Viwango vya Ukaguzi",
    "Usimamizi wa SKU",
    "Sifa za Vazi"
  ],
  "category": "退货与退款"
}
```

### fa-IR（Tier 3）— locale_needs_cloud

```json
{
  "id": "kb_607acbe2e77d988a",
  "title": "چرا برای رتبه‌بندی بازرسی کالاهای برگشتی پوشاک نمی‌توان از یک استاندارد عمومی استفاده کرد؟",
  "content": "پوشاک دارای ماهیت بسیار ذهنی و تفاوت‌های قابل توجه در سطح SKU است. تعریف «وضعیت فروش‌پذیر» برای دسته‌بندی‌ها، بازه‌های قیمتی و فصل‌های مختلف متفاوت است. به عنوان مثال، یک پلیور پشمی 120 دلاری نسبت به یک تیشرت پایه 15 دلاری نیازمند استانداردهای بازرسی سخت‌گیرانه‌تری است. برندها باید از تعریف تا سه مرحله بازرسی سفارشی بر اساس SKU، دسته و وضعیت کالا پشتیبانی کنند، تا اطمینان حاصل شود که نتایج رتبه‌بندی با آستانه کیفیت خودشان همخوانی دارد و از قضاوت اشتباه که منجر به زیان موجودی یا شکایت مشتری می‌شود، جلوگیری کند.",
  "tags": [
    "استانداردهای بازرسی کیفیت",
    "مدیریت SKU",
    "ویژگی‌های پوشاک"
  ],
  "category": "退货与退款"
}
```

## 卡片：ShipBob的库存放置计划（IPP）如何优化配送？

原文（节选）：
```text
IPP利用销售数据和网络逻辑在美国各履约中心之间平衡库存，从而降低运输成本和缩短交货时间。例如Semaine Health采用后，发货时间缩短了三分之一，每单履约成本降低了超过2美元。
```

### pl-PL（Tier 2）— cloud_retry_pool

失败：LOCAL_ERROR: local HTTP 400: {"error":"terminated"}

### sw-KE（Tier 3）— local_needs_cloud_review

```json
{
  "id": "kb_2b01d3254a47bb16",
  "title": "Programu ya Kuweka Stokini (IPP) ya ShipBob inaboreshaje usafirishaji?",
  "content": "IPP inatumia data ya mauzo na mantiki ya mtandao kusawazisha stokini kati ya vituo vya utekelezaji katika Marekani, hivyo kupunguza gharama za usafirishaji na kurufu muda wa kuwasiliana. Kwa mfano, baada ya Semaine Health kutumia huduma hii, muda wa utumaji ulipungua kwa theluthi moja, na gharama ya utekelezaji kwa kila oda ilipungua zaidi ya $2.",
  "tags": [
    "Usafirishaji",
    "Usimamizi wa Stokini"
  ],
  "category": "物流与配送"
}
```

### fa-IR（Tier 3）— local_needs_cloud_review

```json
{
  "id": "kb_2b01d3254a47bb16",
  "title": "برنامه مکان‌یابی موجودی (IPP) ShipBob چگونه توزیع را بهینه می‌کند؟",
  "content": "IPP با استفاده از داده‌های فروش و منطق شبکه، موجودی را بین مراکز انجام سفارش در سراسر ایالات متحده متعادل می‌کند که این امر هزینه حمل‌ونقل را کاهش داده و زمان تحویل را کوتاه می‌کند. به عنوان مثال، پس از پذیرش توسط Semaine Health، زمان ارسال یک سوم کاهش یافت و هزینه انجام هر سفارش بیش از 2$ کاهش پیدا کرد.",
  "tags": [
    "لجستیک",
    "مدیریت موجودی"
  ],
  "category": "物流与配送"
}
```

## 卡片：What are some red flags to watch out for when accepting card payments to prevent fraud?

原文（节选）：
```text
Q: What are some red flags to watch out for when accepting card payments to prevent fraud?
A: To minimize risks and possible chargebacks while accepting online orders, be wary of the following potential red flags:

- **Bulk orders**: Large orders on goods that have high resale value (sneakers, electronics, designers’ handbags, etc). Large repeated orders on such items also pose a high risk.
- **Card processing behaviors:** Multiple lost or stolen declines, or multiple attempts from different car
```

### pl-PL（Tier 2）— local_ok

```json
{
  "id": "kb_wixqa_69ef1e34495848e4",
  "title": "Jakie są niektóre czerwone flagi, na które należy zwrócić uwagę przy przyjmowaniu płatności kartą, aby zapobiec oszustwom?",
  "content": "Q: Jakie są niektóre czerwone flagi, na które należy zwrócić uwagę przy przyjmowaniu płatności kartą, aby zapobiec oszustwom?\nA: Aby zminimalizować ryzyko i potencjalne chargebacki podczas przyjmowania zamówień online, zachowaj ostrożność wobec następujących potencjalnych czerwonych flag:\n\n- **Zamówienia hurtowe**: Duże zamówienia na towary o wysokiej wartości odsprzedaży (buty sportowe, elektronika, torebki projektantów itp.). Powtarzające się duże zamówienia na takie przedmioty również stanowią wysokie ryzyko.\n- **Zachowania przy przetwarzaniu kart:** Wielokrotne odrzucenia z powodu zgubionych lub skradzionych kart lub wielokrotne próby z różnych kart. Niewiarygodne jest, aby jeden klient miał 6 lub więcej kart. Podobnie zachowaj ostrożność w przypadkach, gdy klienci proszą o podział płatności na 2 lub więcej rat, zwłaszcza przy użyciu różnych kart.\n- **Nietypowe zachowania wysyłkowe:** Zachowaj ostrożność, jeśli koszt wysyłki jest zawyżony w porównaniu do wartości towaru; jeśli klient nalega na opcję ekspresowej wysyłki bez dostawy pod drzwi; lub jeśli wysyłka kierowana jest do firm pośredniczących, które zapewniają ponowną wysyłkę do „krajów trzecich”.\n- **Żądania płatności przez strony trzecie:** Unikaj żądań zapłaty za specjalne usługi „vendor”, których nie oferujesz (takie jak dostawa pod drzwi, niestandardowa wysyłka, catering lub organizacja wydarzeń). Mogą to być żądania przelewów Western Union, Zelle, Cash App lub podobnych. Żądania od stron trzecich często wskazują na oszustwo. Pamiętaj, że takie płatności są ostateczne. Podobnie nie wystawiaj żądań zwrotu środków za pomocą tych metod płatności. Używaj oryginalnej metody płatności podanej przez klienta.\n\nJeśli napotkasz którąkolwiek z tych czerwonych flag, zalecamy dodatkowe weryfikacje kupującego. Mogą one obejmować żądanie dokumentu tożsamości wydawanego przez rząd, połączenie telefoniczne lub weryfikację przez Zoom. Upewnij się również, że typ zamówienia, który obsługujesz, koreluje z Twoimi regularnymi praktykami biznesowymi. Zawsze masz możliwość anulowania zamówienia i zwrotu początkowej płatności, jeśli zauważysz zachowanie, które może zostać uznane za oszustwo.\n\nSource: https://support.wix.com/en/article/best-practices-for-accepting-card-payments",
  "tags": [
    "wixqa_sztuczny",
    "wixqa"
  ],
  "category": "平台规则"
}
```

### sw-KE（Tier 3）— local_needs_cloud_review

```json
{
  "id": "kb_wixqa_69ef1e34495848e4",
  "title": "Ni alama gani za hatari zinazopaswa kutazamwa wakati wa kukubali malipo ya kadi ili kuizuia udanganyifu?",
  "content": "SWALI: Ni alama gani za hatari zinazopaswa kutazamwa wakati wa kukubali malipo ya kadi ili kuizuia udanganyifu?\nMAJIBO: Ili kupunguza hatari na marejesho ya malipo yanayoweza kutokea wakati wa kukubali maagizo ya mtandaoni, kuwa makini kwa alama zifuatazo za hatari zinazowezekana:\n\n- **Maagizo makubwa**: Maagizo makubwa ya bidhaa zenye thamani kubwa ya kuuzwa tena (vifaa vya miguu, vifaa vya elektroniki, mikufu ya wabunifu, n.k.). Maagizo makubwa yanayorudiwa mara kwa mara ya bidhaa hizo pia yana hatari kubwa.\n- **Tabia za usindikaji wa kadi**: Kukataa mara nyingi kwa sababu ya kadi iliyopotea au kuibiwa, au majaribio mengi kutoka kwenye kadi tofauti. Ni vigumu kwamba mteja mmoja atakuwa na kadi 6 au zaidi. Vilevile, epuka hali ambapo wateja wanauliza kugawanya malipo katika sehemu 2 au zaidi, hasa kwa kutumia kadi tofauti.\n- **Tabia ya usafirishaji isiyo ya kawaida**: Kuwa makini ikiwa gharama za usafirishaji ni kubwa zaidi ikilinganishwa na thamani ya bidhaa; ikiwa mteja wako anadumisha chaguo la usafirishaji wa haraka bila uthibitisho wa kupokea; au usafirishaji kwa kampuni za uhamisho zinazotoa upya usafirishaji hadi \"nchi za tatu\".\n- **Maombi ya malipo kutoka kwa wadau wa tatu**: Epuka maombi ya kulipa huduma maalum za \"muuzaji\" ambazo hutoi (kama vile usafirishaji hadi mlango, usafirishaji wa kibinafsi, huduma za chakula au mpangilio wa matukio). Hizi zinaweza kuwa maombi ya Western Union, Zelle, Cash App au malipo yanayofanana. Maombi yoyote ya wadau wa tatu mara nyingi yanaashiria udanganyifu. Tafadhali kumbuka kwamba malipo hayo ni ya mwisho. Vilevile, usitoe maombi ya marejesho kupitia njia hizi za malipo. Tumia njia asilia ya malipo iliyotolewa na mteja wako.\n\nIkiwa utakuta alama yoyote ya hatari hizi, tunapendekeza baadhi ya uchunguzi wa ziada wa uthibitishaji wa mnunuzi. Hizi zinaweza kujumuisha ombi la kitambulisho kilichotolewa na serikali, simu ya simu, au uchunguzi kupitia Zoom. Pia, hakikisha kwamba aina ya maagizo unayoshughulikia inalingana na mazoea yako ya kawaida ya biashara. Kuna chaguo daima la kughairi maagizo na kurudisha malipo ya awali ikiwa utagundua tabia ambayo inaweza kuchukuliwa kuwa ya udanganyifu.\n\nChanzo: https://support.wix.com/en/article/best-practices-for-accepting-card-payments",
  "tags": [
    "wixqa_synthetic",
    "wixqa"
  ],
  "category": "平台规则"
}
```

### fa-IR（Tier 3）— locale_needs_cloud

```json
{
  "id": "kb_wixqa_69ef1e34495848e4",
  "title": "هنگام پذیرش پرداخت‌های کارت برای جلوگیری از کلاهبرداری، چه نشانه‌هایی را باید به عنوان پرچم قرمز در نظر گرفت و مراقب آن‌ها بود؟",
  "content": "سوال: هنگام پذیرش پرداخت‌های کارت برای جلوگیری از کلاهبرداری، چه نشانه‌هایی را باید به عنوان پرچم قرمز در نظر گرفت و مراقب آن‌ها بود؟\nپاسخ: برای کاهش ریسک‌ها و احتمال بازگشت وجه (chargeback) هنگام پذیرش سفارشات آنلاین، نسبت به نشانه‌های هشداردهنده احتمالی زیر هوشیار باشید:\n\n- **سفارشات عمده**: سفارشات بزرگ برای کالاهایی که ارزش فروش مجدد بالایی دارند (کفش‌های ورزشی، لوازم الکترونیکی، کیف‌های دستی طراحان و غیره). سفارشات تکراری بزرگ روی این اقلام نیز ریسک بالایی ایجاد می‌کنند.\n- **رفتارهای پردازش کارت**: چندین رد شدن به دلیل گم‌شدن یا دزدیده‌شدن، یا چندین تلاش از کارت‌های مختلف. بعید است که یک مشتری ۶ کارت یا بیشتر داشته باشد. همچنین مراقب مواردی باشید که مشتریان درخواست تقسیم پرداخت به ۲ قسط یا بیشتر می‌کنند، به‌ویژه اگر از کارت‌های متفاوت استفاده شود.\n- **رفتارهای غیرعادی ارسال**: اگر هزینه ارسال نسبت به ارزش کالاها بیش‌ازحد بالا باشد، یا مشتری اصرار بر گزینه ارسال فوری بدون تحویل در محل داشته باشد، یا کالا به شرکت‌های واسطه ارسال شود که امکان ارسال مجدد به «کشورهای ثالث» را فراهم می‌کنند، هوشیار باشید.\n- **درخواست‌های پرداخت شخص ثالث**: از درخواست‌هایی برای پرداخت خدمات ویژه «فروشنده» که ارائه نمی‌کنید (مانند تحویل درب منزل، ارسال سفارشی، کترینگ یا برنامه‌ریزی رویداد) خودداری کنید. این موارد ممکن است Western Union، Zelle، Cash App یا درخواست‌های مشابه انتقال وجه باشند. هرگونه درخواست شخص ثالث اغلب نشانه‌ای از کلاهبرداری است. لطفاً توجه داشته باشید که چنین پرداخت‌هایی قطعی هستند. همچنین، از طریق این روش‌های پرداخت درخواست بازگشت وجه صادر نکنید. از روش پرداخت اصلی ارائه‌شده توسط مشتری استفاده کنید.\n\nاگر با هر یک از این نشانه‌های هشداردهنده مواجه شدید، توصیه می‌کنیم برخی بررسی‌های تأییدیه اضافی برای خریدار انجام دهید. این موارد می‌توانند شامل درخواست شناسنامه رسمی (government-issued ID)، تماس تلفنی یا بررسی از طریق Zoom باشند. همچنین مطمئن شوید که نوع سفارشی که مدیریت می‌کنید با روش‌های معمول کسب‌وکار شما همخوانی دارد. همیشه گزینه لغو سفارش و بازگشت وجه اولیه را دارید اگر رفتاری مشاهده کنید که ممکن است کلاهبرداری تلقی شود.\n\nمنبع: https://support.wix.com/en/article/best-practices-for-accepting-card-payments",
  "tags": [
    "wixqa_synthetic",
    "wixqa"
  ],
  "category": "平台规则"
}
```

## locale_needs_cloud 队列

以下 Tier 3 结果未通过本地物理校验，已标记 `locale_needs_cloud`，等待云端 DeepSeek 复核：

- kb_607acbe2e77d988a · fa-IR · ENTITY_MISSING
- kb_wixqa_69ef1e34495848e4 · fa-IR · ENTITY_MISSING

